import { execFileSync } from 'node:child_process'
import { chmodSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { codexIdleMs } from '@handella/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type {
  CodexAdapter,
  ImplementationRequest,
  MilestoneInput,
} from '../src/adapters/codex.js'
import { createRedactor } from '../src/domain/redact.js'
import {
  aPlanContent,
  aTemporaryDirectory,
  cleanupTestContexts,
  aLinearIssue,
} from './helpers.js'

const originalPath = process.env.PATH

afterEach(async () => {
  process.env.PATH = originalPath
  vi.useRealTimers()
  await cleanupTestContexts()
})

/**
 * A `codex` on PATH that does exactly what a scenario needs. The adapter's own
 * behaviour — the argv it builds, the JSONL it reads, the redaction it applies,
 * the clocks it stops on — is the thing under test, and none of it needs the
 * real binary to be exercised. `codex-cli.test.ts` is where the real one runs.
 */
const aStubCodex = (body: string): { argvPath: string; directory: string } => {
  const directory = aTemporaryDirectory('handella-stub-codex-')
  const argvPath = join(directory, 'argv.txt')
  const stub = join(directory, 'codex')

  writeFileSync(
    stub,
    [
      '#!/bin/bash',
      'out=""',
      'prev=""',
      'for a in "$@"; do',
      `  printf '%s\\n' "$a" >> ${JSON.stringify(argvPath)}`,
      '  if [ "$prev" = "--output-last-message" ]; then out="$a"; fi',
      '  prev="$a"',
      'done',
      '# The prompt arrives on stdin and has to be drained or the parent blocks.',
      'cat >/dev/null',
      body,
    ].join('\n'),
    { mode: 0o700 },
  )
  chmodSync(stub, 0o700)

  return { argvPath, directory }
}

/**
 * Every process still in a spawned pass's group, by pid.
 *
 * `ps` exits non-zero when the group is empty, which is the answer rather than
 * a failure — the same reason the process adapter does not wrap it in
 * `cliRunner`.
 */
const processesInGroup = (pgid: number): string[] => {
  try {
    return execFileSync('ps', ['-o', 'pid=', '-g', String(pgid)], {
      encoding: 'utf8',
    })
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '')
  } catch {
    return []
  }
}

/**
 * Imported after PATH is set, because the adapter builds the environment it
 * spawns with once at load. Resetting the module registry is what lets a test
 * decide which `codex` it is talking to.
 */
const anAdapter = async (
  directory: string,
  secrets: readonly string[] = [],
): Promise<CodexAdapter> => {
  process.env.PATH = `${directory}:${originalPath ?? ''}`
  vi.resetModules()
  const { createCodexAdapter } = await import('../src/adapters/codex-cli.js')
  return createCodexAdapter({ redact: createRedactor(secrets) })
}

const aRequest = (
  overrides: Partial<ImplementationRequest> = {},
): ImplementationRequest & {
  milestones: MilestoneInput[]
  lines: string[]
  pids: number[]
} => {
  const milestones: MilestoneInput[] = []
  const lines: string[] = []
  const pids: number[] = []

  return {
    attempt: 1,
    issue: aLinearIssue({ identifier: 'ENG-142' }),
    job: {
      baseBranch: 'dev',
      canonicalBranch: 'ell/eng-142',
    } as ImplementationRequest['job'],
    lines,
    milestones,
    pids,
    onLine: (text) => lines.push(text),
    onMilestone: (milestone) => milestones.push(milestone),
    onSpawn: (pid) => pids.push(pid),
    plan: aPlanContent(),
    round: 1,
    runbook: '# runbook',
    sessionId: 'session-7',
    signal: new AbortController().signal,
    unresolved: [],
    worktreePath: aTemporaryDirectory('handella-worktree-'),
    ...overrides,
  }
}

const aReportBody = (report: Record<string, unknown>): string =>
  `printf '%s' ${JSON.stringify(JSON.stringify(report))} > "$out"`

const completedReport = {
  outcome: 'completed',
  summary: 'Done.',
  committed: true,
  pullRequestUrl: 'https://github.com/acme/monorepo/pull/41',
  checks: [{ command: 'npm test', passed: true, note: '' }],
  unresolved: [],
  planDeviations: [],
}

describe('the implementation pass', () => {
  it('resumes the session under a writable sandbox with network access', async () => {
    const stub = aStubCodex(aReportBody(completedReport))
    const codex = await anAdapter(stub.directory)

    await codex.implement(aRequest())

    const argv = readFileSync(stub.argvPath, 'utf8').split('\n')
    expect(argv.slice(0, 3)).toEqual(['exec', 'resume', 'session-7'])
    expect(argv).toContain('sandbox_mode="workspace-write"')
    expect(argv).toContain('sandbox_workspace_write.network_access=true')
    expect(argv).toContain('approval_policy="never"')
    expect(argv).not.toContain('sandbox_mode="danger-full-access"')
    // The prompt is stdin, never an argument: an issue description must not
    // reach a process listing.
    expect(argv).toContain('-')
  })

  it('turns the readable items into milestones and drops the rest', async () => {
    const stub = aStubCodex(
      [
        `printf '%s\\n' '{"type":"thread.started","thread_id":"session-7"}'`,
        `printf '%s\\n' '{"type":"item.completed","item":{"id":"i1","type":"command_execution","command":"npm test","aggregated_output":"2 failing","exit_code":1,"status":"completed"}}'`,
        `printf '%s\\n' '{"type":"item.completed","item":{"id":"i2","type":"agent_message","text":"Two suites fail."}}'`,
        `printf '%s\\n' '{"type":"item.completed","item":{"id":"i3","type":"reasoning","text":"I should look at the parser."}}'`,
        `printf '%s\\n' 'not json at all'`,
        aReportBody(completedReport),
      ].join('\n'),
    )
    const codex = await anAdapter(stub.directory)
    const request = aRequest()

    const result = await codex.implement(request)

    expect(request.milestones).toEqual([
      {
        detail: '2 failing',
        exitCode: 1,
        kind: 'command',
        summary: 'npm test',
      },
      {
        detail: null,
        exitCode: null,
        kind: 'narration',
        summary: 'Two suites fail.',
      },
    ])
    // Every line reaches the log, including the ones the spine ignores.
    expect(request.lines).toHaveLength(5)
    expect(result.outcome).toBe('reportedDone')
  })

  it('redacts a secret before anything downstream can see it', async () => {
    const secret = 'lin_api_9f2c4d6e8a0b2c4d'
    const stub = aStubCodex(
      [
        `printf '%s\\n' '{"type":"item.completed","item":{"id":"i1","type":"command_execution","command":"curl -H auth:${secret}","aggregated_output":"${secret} rejected","exit_code":1,"status":"completed"}}'`,
        aReportBody({ ...completedReport, summary: `used ${secret}` }),
      ].join('\n'),
    )
    const codex = await anAdapter(stub.directory, [secret])
    const request = aRequest()

    const result = await codex.implement(request)

    expect(request.lines.join('\n')).not.toContain(secret)
    expect(request.milestones[0]?.summary).not.toContain(secret)
    expect(request.milestones[0]?.detail).not.toContain(secret)
    expect(result.report?.summary).toBe('used [redacted]')
  })

  it('reads a blocked report as the ending it is', async () => {
    const stub = aStubCodex(
      aReportBody({
        ...completedReport,
        outcome: 'blocked',
        committed: false,
        pullRequestUrl: '',
        planDeviations: ['src/date.ts does not exist'],
      }),
    )
    const codex = await anAdapter(stub.directory)

    const result = await codex.implement(aRequest())

    expect(result.outcome).toBe('reportedBlocked')
    expect(result.report?.planDeviations).toEqual([
      'src/date.ts does not exist',
    ])
  })

  it('calls a non-zero exit a failure rather than throwing', async () => {
    const stub = aStubCodex('exit 3')
    const codex = await anAdapter(stub.directory)

    const result = await codex.implement(aRequest())

    expect(result.outcome).toBe('failed')
    expect(result.failureReason).toContain('exited with 3')
    expect(result.report).toBeNull()
  })

  it('calls a report it cannot read a failure, so the turn can be repaired', async () => {
    const stub = aStubCodex(`printf '%s' '{"outcome":"maybe"}' > "$out"`)
    const codex = await anAdapter(stub.directory)

    const result = await codex.implement(aRequest())

    expect(result.outcome).toBe('failed')
    expect(result.failureReason).toContain('report schema')
  })

  it('stops a turn that has gone silent', async () => {
    const stub = aStubCodex(
      [
        `printf '%s\\n' '{"type":"thread.started","thread_id":"session-7"}'`,
        'sleep 120',
      ].join('\n'),
    )
    const codex = await anAdapter(stub.directory)
    // Only the clocks are faked; the child, its pipes and its death are real.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    const pending = codex.implement(aRequest())
    await vi.advanceTimersByTimeAsync(codexIdleMs + 1_000)
    const result = await pending

    expect(result.outcome).toBe('timedOut')
    expect(result.failureReason).toContain('said nothing')
  })

  it('reports a stop as a stop', async () => {
    const stub = aStubCodex('sleep 120')
    const codex = await anAdapter(stub.directory)
    const abort = new AbortController()

    const pending = codex.implement(aRequest({ signal: abort.signal }))
    abort.abort()
    const result = await pending

    expect(result.outcome).toBe('stopped')
  })

  it('reports the pid of the process it started', async () => {
    const stub = aStubCodex(aReportBody(completedReport))
    const codex = await anAdapter(stub.directory)
    const request = aRequest()

    await codex.implement(request)

    // Recorded by the caller for as long as the pass runs, because a pid
    // nobody wrote down is a process no restart can find again.
    expect(request.pids).toHaveLength(1)
    expect(request.pids[0]).toBeGreaterThan(0)
  })

  it('takes the commands Codex started down with it', async () => {
    // A Runbook has the agent install dependencies and run its tests, so a
    // pass being stopped is usually waiting on a child of its own. Signalling
    // Codex alone leaves that child holding the worktree — and the slot the
    // stop was meant to free (docs/adr/0012).
    const stub = aStubCodex('sleep 120')
    const codex = await anAdapter(stub.directory)
    const abort = new AbortController()
    const request = aRequest({ signal: abort.signal })

    const pending = codex.implement(request)
    await vi.waitFor(() => expect(request.pids).toHaveLength(1))
    const pid = request.pids[0] ?? 0
    // The stub and the `sleep` it is waiting on, which is the shape being
    // asserted: two processes, one group.
    await vi.waitFor(() => expect(processesInGroup(pid).length).toBe(2))

    abort.abort()
    expect((await pending).outcome).toBe('stopped')

    await vi.waitFor(() => expect(processesInGroup(pid)).toEqual([]), {
      timeout: 5_000,
    })
  })
})
