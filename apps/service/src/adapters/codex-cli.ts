import { spawn } from 'node:child_process'
import {
  accessSync,
  constants,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { createInterface } from 'node:readline'

import { PlanContentSchema, planningTimeoutMs } from '@handella/contracts'

import { codexPlanningFailed, codexUnavailable } from '../domain/errors.js'
import { parsePlanContent } from '../domain/plan-content.js'
import type { CodexAdapter, PlanningRequest, PlanningResult } from './codex.js'

const binary = 'codex'

/** How long a stopped pass is given to exit before it is killed outright. */
const graceMs = 5_000

/**
 * The overrides that make an unattended pass safe, applied on every
 * invocation. `codex exec resume` accepts no `--sandbox` and no `--cd`, only
 * `-c`, so the sandbox is set this way rather than by flag on both paths: one
 * spelling, and no chance of a revision running under weaker isolation than
 * the pass it revises.
 *
 * - `sandbox_mode`: the Handler's own config is `workspace-write`. Planning
 *   reads; a planner that can write has already started implementing.
 * - `approval_policy`: their config is `on-request`, and there is nobody here
 *   to ask. Never, so a command that needs approval fails rather than hangs.
 * - `notify`: their config fires a desktop notifier when a turn ends. Handella
 *   runs turns on its own schedule, and three jobs would mean three pop-ups
 *   for work the Handler did not just do.
 */
const safetyOverrides: readonly string[] = [
  '-c',
  'sandbox_mode="read-only"',
  '-c',
  'approval_policy="never"',
  '-c',
  'notify=[]',
]

/**
 * Whether the binary is there, asked the way a shell asks. Codex is a local
 * binary rather than a credential, so there is no key to check and nothing to
 * be unconfigured about beyond it not being installed.
 */
const onPath = (name: string): boolean => {
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    if (directory === '') continue
    try {
      accessSync(join(directory, name), constants.X_OK)
      return true
    } catch {
      // Not here; the next entry is not an error either.
    }
  }
  return false
}

const describeIssue = (input: PlanningRequest): string =>
  [
    `Issue: ${input.issue.identifier} — ${input.issue.title}`,
    `Linear: ${input.issue.url}`,
    '',
    input.issue.description ?? '(The issue has no description.)',
  ].join('\n')

/**
 * A first pass has to say everything. A revision says almost nothing, because
 * it is a turn in the session that produced the plan it answers: restating the
 * brief there would invite the planner to start over rather than to revise.
 */
const planningPrompt = (input: PlanningRequest): string => {
  if (input.sessionId !== undefined) {
    return [
      'The Handler reviewed your plan and asked for changes:',
      '',
      input.feedback ?? '(No feedback was recorded.)',
      '',
      'Revise the plan to answer that. Investigate again where the feedback',
      'implies you got something wrong, rather than only rewording. Reply with',
      'the complete revised plan as JSON matching the schema — not a diff, and',
      'not only the parts that changed.',
    ].join('\n')
  }

  return [
    'You are planning a change to this repository. Plan it; do not make it.',
    'You are running read-only and cannot write, so investigate as much as you',
    'need to and propose the work rather than starting it.',
    '',
    describeIssue(input),
    '',
    'The plan you produce will be implemented by another agent following this',
    'runbook. Plan the work itself; do not restate the procedure below.',
    '',
    '--- runbook ---',
    input.runbook,
    '--- end runbook ---',
    '',
    `The work will be committed on the branch ${input.job.canonicalBranch ?? '(unknown)'},`,
    `cut from ${input.job.baseBranch}.`,
    '',
    'Read the repository before you plan. Name real files and real symbols;',
    'a step that names a file that does not exist is worse than a vague one.',
    'Mark a step required when the change is wrong without it, and optional',
    'when it is an improvement that could be dropped under pressure.',
    '',
    'Reply with JSON matching the schema you were given, and nothing else.',
  ].join('\n')
}

// Built once for the reason `git-cli.ts` builds its own once: a full copy of
// the environment, identical on every invocation. `LC_ALL` so a failure's text
// is the text the error mapping was written against.
const codexEnv = { ...process.env, LC_ALL: 'C' }

/**
 * One `codex exec` invocation, read as it goes, resolving with the session it
 * ran in. `spawn` with a line reader rather than `execFile` like the git
 * adapter, because `--json` emits an event per reasoning step and a buffered
 * read would truncate a long pass at `maxBuffer` — and Phase 6 needs this
 * stream live in any case.
 */
const runPass = (
  args: readonly string[],
  prompt: string,
  input: PlanningRequest,
): Promise<string> =>
  new Promise<string>((resolve, reject) => {
    const child = spawn(binary, args, {
      cwd: input.worktreePath,
      env: codexEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let sessionId: string | undefined
    let failure: string | undefined
    let stopped: string | undefined
    let stderr = ''
    let killer: NodeJS.Timeout | undefined

    const stop = (reason: string): void => {
      if (stopped !== undefined) return
      stopped = reason
      child.kill('SIGTERM')
      // Codex owns a session file and child processes of its own, so it is
      // asked to stop before it is made to.
      killer = setTimeout(() => child.kill('SIGKILL'), graceMs)
      killer.unref()
    }

    const timer = setTimeout(
      () => stop(`Planning ran longer than ${planningTimeoutMs}ms`),
      planningTimeoutMs,
    )
    timer.unref()

    const onAbort = (): void => stop('Planning was stopped')
    input.signal.addEventListener('abort', onAbort, { once: true })

    // Everything this pass holds open, let go of in one place. Only ever
    // called from the child's terminal events, by which time `lines` is set.
    const settle = (): void => {
      clearTimeout(timer)
      clearTimeout(killer)
      input.signal.removeEventListener('abort', onAbort)
      lines.close()
    }

    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      // Bounded: a failing pass can be noisy, and only the tail says why.
      stderr = `${stderr}${chunk}`.slice(-4_000)
    })

    const lines = createInterface({ crlfDelay: Infinity, input: child.stdout })
    lines.on('line', (line) => {
      let event: unknown
      try {
        event = JSON.parse(line)
      } catch {
        // Not every line is an event, and a line Handella cannot read is not a
        // reason to stop a pass that Codex is still running.
        return
      }

      if (typeof event !== 'object' || event === null) return
      const record = event as Record<string, unknown>

      if (record['type'] === 'thread.started') {
        const id = record['thread_id']
        if (typeof id === 'string') sessionId = id
        return
      }

      if (record['type'] === 'turn.failed') {
        const error = record['error']
        const message =
          typeof error === 'object' && error !== null
            ? (error as Record<string, unknown>)['message']
            : undefined
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

      if (stopped !== undefined) {
        reject(codexPlanningFailed(stopped))
        return
      }

      if (failure !== undefined) {
        reject(codexPlanningFailed(`Codex could not plan: ${failure}`))
        return
      }

      if (code !== 0) {
        reject(
          codexPlanningFailed(
            `codex exec exited with ${signal ?? code}`,
            new Error(stderr.trim() || 'codex wrote nothing to stderr'),
          ),
        )
        return
      }

      if (sessionId === undefined) {
        reject(
          codexPlanningFailed('Codex finished without reporting a session id'),
        )
        return
      }

      resolve(sessionId)
    })

    child.stdin.on('error', () => {
      // The child can exit before the prompt is written; `close` reports why.
    })
    child.stdin.end(prompt)
  })

export const createCodexAdapter = (): CodexAdapter => ({
  // Asked each time rather than once at startup: a Handler who installs Codex
  // because the status page told them to should not have to restart Handella
  // to be told they succeeded.
  get configured(): boolean {
    return onPath(binary)
  },

  async plan(input: PlanningRequest): Promise<PlanningResult> {
    const directory = mkdtempSync(join(tmpdir(), 'handella-plan-'))

    try {
      const schemaPath = join(directory, 'plan-schema.json')
      const messagePath = join(directory, 'plan.json')
      // The schema the model is held to is the schema the store validates
      // against, written out of the same definition rather than restated.
      writeFileSync(schemaPath, JSON.stringify(PlanContentSchema), {
        mode: 0o600,
      })

      // Tested on the value rather than through a `resuming` flag, because
      // narrowing does not survive the round trip through a boolean and the
      // difference is one unchecked cast.
      const args = [
        'exec',
        ...(input.sessionId === undefined ? [] : ['resume', input.sessionId]),
        ...safetyOverrides,
        ...(input.sessionId === undefined
          ? ['--sandbox', 'read-only', '--cd', input.worktreePath]
          : []),
        '--json',
        '--output-schema',
        schemaPath,
        '--output-last-message',
        messagePath,
        // `-` is the prompt, and means stdin. Passing it as an argument would
        // put an issue description into a process listing.
        '-',
      ]

      const sessionId = await runPass(args, planningPrompt(input), input)

      let message: string
      try {
        message = readFileSync(messagePath, 'utf8')
      } catch (error) {
        throw codexPlanningFailed(
          'Codex finished without writing a plan',
          error,
        )
      }

      return {
        content: parsePlanContent(message, "Codex's plan"),
        sessionId,
      }
    } finally {
      rmSync(directory, { force: true, recursive: true })
    }
  },
})
