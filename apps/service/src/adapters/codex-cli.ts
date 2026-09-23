import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

import {
  ImplementationReportSchema,
  codexIdleMs,
  codexTerminationGraceMs,
  implementationTimeoutMs,
  planningTimeoutMs,
} from '@handella/contracts'

import { codexPlanningFailed, codexUnavailable } from '../domain/errors.js'
import { DomainError } from '../domain/errors.js'
import { parseImplementationReport } from '../domain/implementation-report.js'
import {
  implementationPrompt,
  planningPrompt,
  repairPrompt,
} from '../domain/prompts.js'
import type { Redactor } from '../domain/redact.js'
import { commandEnv, onPath } from './command.js'
import { signalProcessGroup } from './processes-ps.js'
import type {
  CodexAdapter,
  CodexAdapterOptions,
  ImplementationRequest,
  ImplementationResult,
  MilestoneInput,
  PlanningRequest,
  PlanningResult,
} from './codex.js'

const binary = 'codex'

/** A milestone is a line in a list, so its summary is one line and a short one. */
const longestSummary = 200

/**
 * How much of a command's output a milestone keeps. A fresh worktree's `npm
 * install` alone is tens of kilobytes, and the milestone list is re-served in
 * full every time a running job announces progress — about once a second. The
 * whole of it is in the Attempt's raw log, which has an endpoint of its own.
 */
const longestDetail = 4_000

const tailOf = (text: string): string =>
  text.length <= longestDetail ? text : `…${text.slice(-longestDetail)}`

/**
 * The overrides every pass runs under, applied by `-c` rather than by flag
 * because `codex exec resume` accepts no `--sandbox` and no `--cd`. One
 * spelling on both paths, and no chance of a resumed turn running under weaker
 * isolation than the one it continues.
 *
 * Everything else — the sandbox mode above all — is inherited from the
 * Handler's own `~/.codex/config.toml`, because the session Handella opens is
 * the session the Handler goes on to drive from their terminal, and two
 * sandboxes for one conversation is a fact nobody would be told
 * (docs/adr/0016).
 *
 * - `approval_policy`: the Handler's config is `on-request`, and there is
 *   nobody here to ask. Never, so a command that needs approval fails rather
 *   than hangs.
 * - `notify`: their config fires a desktop notifier when a turn ends. Handella
 *   runs turns on its own schedule, and three jobs would mean three pop-ups for
 *   work the Handler did not just do.
 * - `network_access`: a worktree is a fresh checkout holding no dependencies,
 *   so the runbook's "run the repository's test suite" step has to install
 *   them before it can run anything — and once the network is open the agent
 *   can also push and open its own pull request, which is a better one than
 *   Handella could write from outside the diff. What that costs, and how
 *   Handella verifies the result rather than trusting it, is docs/adr/0010.
 *   Only read under `workspace-write`; under any other mode it is inert.
 *   `danger-full-access` is set nowhere.
 */
const sharedOverrides: readonly string[] = [
  '-c',
  'approval_policy="never"',
  '-c',
  'notify=[]',
  '-c',
  'sandbox_workspace_write.network_access=true',
]

const oneLine = (text: string): string => {
  const first = text.trim().split('\n')[0] ?? ''
  return first.length > longestSummary
    ? `${first.slice(0, longestSummary - 1)}…`
    : first
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined

const stringOr = (value: unknown, fallback: string): string =>
  typeof value === 'string' ? value : fallback

/** The records in a list Codex sent, skipping whatever in it was not one. */
const records = (value: unknown): Record<string, unknown>[] =>
  (Array.isArray(value) ? value : [])
    .map((entry) => asRecord(entry))
    .filter((entry) => entry !== undefined)

/**
 * The readable subset of a thread item, or nothing.
 *
 * Reasoning, partial updates, web searches and tool calls all return undefined:
 * they are the log's, not the spine's. An item whose shape is not what this
 * expects also returns undefined rather than a half-filled row — Codex owns
 * this format and is free to add to it.
 */
const milestoneFrom = (
  item: Record<string, unknown>,
): MilestoneInput | undefined => {
  switch (item['type']) {
    case 'agent_message': {
      const text = stringOr(item['text'], '').trim()
      if (text === '') return undefined
      return {
        detail: text.includes('\n') ? text : null,
        exitCode: null,
        kind: 'narration',
        summary: oneLine(text),
      }
    }

    case 'command_execution': {
      const command = stringOr(item['command'], '').trim()
      if (command === '') return undefined
      const output = stringOr(item['aggregated_output'], '').trim()
      const exitCode = item['exit_code']
      return {
        detail: output === '' ? null : tailOf(output),
        exitCode: typeof exitCode === 'number' ? exitCode : null,
        kind: 'command',
        summary: oneLine(command),
      }
    }

    case 'file_change': {
      const described = records(item['changes']).map(
        (change) =>
          `${stringOr(change['kind'], 'change')} ${stringOr(change['path'], '?')}`,
      )
      if (described.length === 0) return undefined
      return {
        detail: described.join('\n'),
        exitCode: null,
        kind: 'fileChange',
        summary: `Changed ${described.length} file${described.length === 1 ? '' : 's'}`,
      }
    }

    case 'todo_list': {
      const entries = records(item['items'])
      if (entries.length === 0) return undefined
      const done = entries.filter((entry) => entry['completed'] === true).length
      return {
        detail: entries
          .map(
            (entry) =>
              `${entry['completed'] === true ? '[x]' : '[ ]'} ${stringOr(entry['text'], '?')}`,
          )
          .join('\n'),
        exitCode: null,
        kind: 'todoList',
        summary: `${done} of ${entries.length} done`,
      }
    }

    default:
      return undefined
  }
}

const codexEnv = commandEnv()

interface PassRequest {
  args: readonly string[]
  cwd: string
  /** What the wall clock is called when it fires, for the Handler to read. */
  label: string
  onLine?: ((text: string) => void) | undefined
  onMilestone?: ((milestone: MilestoneInput) => void) | undefined
  /** Told the moment Codex opens the thread, rather than when the pass ends. */
  onSessionId?: ((sessionId: string) => void) | undefined
  /**
   * Told the pid the moment the process exists, and required rather than
   * optional: a pass whose pid was never recorded is one no restart can find
   * again, and every caller has somewhere to put it.
   */
  onSpawn: (pid: number) => void
  prompt: string
  redact: Redactor
  signal: AbortSignal
  timeoutMs: number
}

/**
 * How a pass ended, classified once.
 *
 * Planning turns this into a rejection and implementation into an Attempt
 * outcome, because the same ending means different things to each — but they
 * were deciding *which* ending it was in the same three steps. Only the saying
 * differs, so only the saying is left to them.
 */
type PassEnding =
  | { ok: true; sessionId: string | undefined }
  | {
      kind: 'failed' | 'stopped' | 'timedOut'
      ok: false
      reason: string
      /** Kept beside the reason for the caller that wants it as a `cause`. */
      stderr: string
    }

/**
 * One `codex exec` invocation, read as it goes. `spawn` with a line reader
 * rather than `execFile` like the git adapter, because `--json` emits an event
 * per reasoning step and a buffered read would truncate a long pass at
 * `maxBuffer` — and implementation needs this stream live in any case.
 *
 * Rejects only when Codex could not be run. Every other ending is a resolved
 * `PassOutcome`: a pass that ran and failed is something its caller has to
 * describe, not an exception.
 */
const runPass = (request: PassRequest): Promise<PassEnding> =>
  new Promise<PassEnding>((resolve, reject) => {
    const child = spawn(binary, request.args, {
      cwd: request.cwd,
      // Codex leads its own process group, so both this pass and a later
      // reap can signal the commands it starts and not only Codex itself
      // (docs/adr/0012). Deliberately not `unref`ed: this pass still waits
      // for it.
      detached: true,
      env: codexEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let sessionId: string | undefined
    let failure: string | undefined
    let stopped: { byClock: boolean; reason: string } | undefined
    let stderr = ''
    let killer: NodeJS.Timeout | undefined

    // Reported before anything is awaited, so the row that says how to find
    // this process exists for as long as the process does. A pass whose pid
    // reached nobody is one a restart could not reap.
    if (child.pid !== undefined) request.onSpawn(child.pid)

    /**
     * The whole group rather than Codex alone, which would leave the `npm
     * install` or test run it is waiting on holding the worktree — and holding
     * the slot the stop was meant to free.
     *
     * Every failure is swallowed, unlike the reap's use of the same function.
     * A pass has nowhere to put one: it is already ending, the ending it
     * reports is the one it was stopped for, and a signal the operating system
     * would not deliver does not change what the Handler is told.
     */
    const signalGroup = (signal: NodeJS.Signals): void => {
      if (child.pid === undefined) return
      try {
        signalProcessGroup(child.pid, signal)
      } catch {
        // Nothing a pass can do with it.
      }
    }

    const stop = (reason: string, byClock = false): void => {
      if (stopped !== undefined) return
      stopped = { byClock, reason }
      signalGroup('SIGTERM')
      // Codex owns a session file and child processes of its own, so it is
      // asked to stop before it is made to.
      killer = setTimeout(() => signalGroup('SIGKILL'), codexTerminationGraceMs)
      killer.unref()
    }

    const timer = setTimeout(
      () =>
        stop(`${request.label} ran longer than ${request.timeoutMs}ms`, true),
      request.timeoutMs,
    )
    timer.unref()

    // A wall clock only catches a wedged pass once its whole budget is gone.
    // Silence catches the same pass in minutes, and a pass that is working is
    // never silent: it reports every command it runs.
    let idle: NodeJS.Timeout | undefined
    const resetIdle = (): void => {
      clearTimeout(idle)
      idle = setTimeout(
        () => stop(`${request.label} said nothing for ${codexIdleMs}ms`, true),
        codexIdleMs,
      )
      idle.unref()
    }
    resetIdle()

    const onAbort = (): void => stop(`${request.label} was stopped`)
    request.signal.addEventListener('abort', onAbort, { once: true })

    // Everything this pass holds open, let go of in one place. Only ever
    // called from the child's terminal events, by which time `lines` is set.
    const settle = (): void => {
      clearTimeout(timer)
      clearTimeout(idle)
      clearTimeout(killer)
      request.signal.removeEventListener('abort', onAbort)
      lines.close()
    }

    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      // A pass that is only complaining is still a pass that is alive.
      resetIdle()
      // Bounded: a failing pass can be noisy, and only the tail says why.
      // Kept raw and redacted once at the end rather than per chunk: a secret
      // split across two reads matches neither half.
      stderr = `${stderr}${chunk}`.slice(-4_000)
    })

    const lines = createInterface({ crlfDelay: Infinity, input: child.stdout })
    lines.on('line', (raw) => {
      resetIdle()

      // Redacted here and nowhere else. Everything downstream — the log file,
      // the milestone rows, the failure text on the attempt — reads what this
      // produced, so a secret has one place it could escape and this is it.
      const line = request.redact(raw)
      request.onLine?.(line)

      let event: unknown
      try {
        event = JSON.parse(line)
      } catch {
        // Not every line is an event, and a line Handella cannot read is not a
        // reason to stop a pass that Codex is still running.
        return
      }

      const record = asRecord(event)
      if (record === undefined) return

      if (record['type'] === 'thread.started') {
        const id = record['thread_id']
        // Announced as well as kept. Codex sends this within seconds and then
        // reasons for minutes, and a caller holding the id for that whole
        // stretch is what lets a Handler open the session while it is running
        // rather than once it has stopped.
        if (typeof id === 'string') {
          sessionId = id
          request.onSessionId?.(id)
        }
        return
      }

      if (record['type'] === 'item.completed') {
        const item = asRecord(record['item'])
        if (item === undefined || request.onMilestone === undefined) return
        const milestone = milestoneFrom(item)
        if (milestone !== undefined) request.onMilestone(milestone)
        return
      }

      if (record['type'] === 'turn.failed') {
        const error = asRecord(record['error'])
        const message = error?.['message']
        failure = typeof message === 'string' ? message : 'The turn failed'
        return
      }

      if (record['type'] === 'error') {
        const message = record['message']
        failure =
          typeof message === 'string' ? message : 'Codex reported an error'
      }
    })

    child.on('error', (error: NodeJS.ErrnoException) => {
      settle()
      reject(
        error.code === 'ENOENT'
          ? codexUnavailable('codex is not installed or is not on PATH', error)
          : codexUnavailable('codex could not be started', error),
      )
    })

    child.on('close', (code, signal) => {
      settle()
      const said = request.redact(stderr).trim()

      if (stopped !== undefined) {
        resolve({
          kind: stopped.byClock ? 'timedOut' : 'stopped',
          ok: false,
          reason: stopped.reason,
          stderr: said,
        })
        return
      }
      if (failure !== undefined) {
        resolve({ kind: 'failed', ok: false, reason: failure, stderr: said })
        return
      }
      if (code !== 0) {
        resolve({
          kind: 'failed',
          ok: false,
          reason: `codex exec exited with ${signal ?? code}${
            said === '' ? '' : `: ${said}`
          }`,
          stderr: said,
        })
        return
      }

      resolve({ ok: true, sessionId })
    })

    child.stdin.on('error', () => {
      // The child can exit before the prompt is written; `close` reports why.
    })
    child.stdin.end(request.prompt)
  })

/** A scratch directory whose files are readable only by this account. */
const withScratch = async <Result>(
  prefix: string,
  body: (directory: string) => Promise<Result>,
): Promise<Result> => {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  try {
    return await body(directory)
  } finally {
    rmSync(directory, { force: true, recursive: true })
  }
}

export const createCodexAdapter = (
  options: CodexAdapterOptions,
): CodexAdapter => ({
  // Asked each time rather than once at startup: a Handler who installs Codex
  // because the status page told them to should not have to restart Handella
  // to be told they succeeded.
  get configured(): boolean {
    return onPath(binary)
  },

  async implement(input: ImplementationRequest): Promise<ImplementationResult> {
    return withScratch('handella-implement-', async (directory) => {
      const schemaPath = join(directory, 'report-schema.json')
      const messagePath = join(directory, 'report.json')
      writeFileSync(schemaPath, JSON.stringify(ImplementationReportSchema), {
        mode: 0o600,
      })

      // Always a resume: implementation happens in the session that planned.
      // `resume` takes no `--cd`, so the cwd is what pins the worktree, and it
      // is also what `workspace-write` confines writes to.
      const ending = await runPass({
        args: [
          'exec',
          'resume',
          input.sessionId,
          ...sharedOverrides,
          '--json',
          '--output-schema',
          schemaPath,
          '--output-last-message',
          messagePath,
          '-',
        ],
        cwd: input.worktreePath,
        label: 'Implementation',
        onLine: input.onLine,
        onMilestone: input.onMilestone,
        onSpawn: input.onSpawn,
        prompt:
          input.attempt > 1 || input.round > 1
            ? repairPrompt(input.unresolved)
            : implementationPrompt(input),
        redact: options.redact,
        signal: input.signal,
        timeoutMs: implementationTimeoutMs,
      })

      const failed = (
        reason: string,
        as: ImplementationResult['outcome'] = 'failed',
      ): ImplementationResult => ({
        failureReason: options.redact(reason),
        outcome: as,
        report: null,
      })

      if (!ending.ok) {
        return ending.kind === 'failed'
          ? failed(`Codex could not implement: ${ending.reason}`)
          : failed(ending.reason, ending.kind)
      }

      let message: string
      try {
        message = readFileSync(messagePath, 'utf8')
      } catch {
        return failed('Codex finished without writing a completion report')
      }

      // An unusable report is a turn that did not finish, not a broken
      // Handella: the repair cycle is exactly the right answer to it.
      let report
      try {
        report = parseImplementationReport(
          options.redact(message),
          "Codex's completion report",
        )
      } catch (error) {
        return failed(
          error instanceof DomainError
            ? error.message
            : 'The completion report could not be read',
        )
      }

      return {
        failureReason: null,
        outcome:
          report.outcome === 'blocked' ? 'reportedBlocked' : 'reportedDone',
        report,
      }
    })
  },

  async plan(input: PlanningRequest): Promise<PlanningResult> {
    // Always a fresh session, and never a schema: the plan is prose the
    // Handler reads and answers in their terminal, so there is nothing for
    // Handella to resume into and nothing for it to parse. `--cd` pins the
    // worktree; the sandbox is whatever the Handler's config says.
    const ending = await runPass({
      args: [
        'exec',
        ...sharedOverrides,
        '--cd',
        input.worktreePath,
        '--json',
        // `-` is the prompt, and means stdin. Passing it as an argument would
        // put an issue description into a process listing.
        '-',
      ],
      cwd: input.worktreePath,
      label: 'Planning',
      onSessionId: input.onSessionId,
      onSpawn: input.onSpawn,
      prompt: planningPrompt(input),
      redact: options.redact,
      signal: input.signal,
      timeoutMs: planningTimeoutMs,
    })

    if (!ending.ok) {
      throw codexPlanningFailed(
        ending.kind === 'failed'
          ? `Codex could not plan: ${ending.reason}`
          : ending.reason,
        new Error(ending.stderr || 'codex wrote nothing to stderr'),
      )
    }

    if (ending.sessionId === undefined) {
      throw codexPlanningFailed('Codex finished without reporting a session id')
    }

    return { sessionId: ending.sessionId }
  },
})
