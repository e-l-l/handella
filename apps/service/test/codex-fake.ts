import type { ImplementationReport } from '@handella/contracts'

import type {
  CodexAdapter,
  ImplementationRequest,
  ImplementationResult,
  PlanningRequest,
  PlanningResult,
} from '../src/adapters/codex.js'

export const aReport = (
  overrides: Partial<ImplementationReport> = {},
): ImplementationReport => ({
  outcome: 'completed',
  summary: 'Awaited the session cookie and the login test settled.',
  committed: true,
  pullRequestUrl: 'https://github.com/acme/monorepo/pull/41',
  checks: [{ command: 'npm test', passed: true, note: '' }],
  unresolved: [],
  planDeviations: [],
  ...overrides,
})

export interface FakeCodexAdapter extends CodexAdapter {
  /** Every pass asked for, in order, so a test can assert what was sent. */
  readonly calls: PlanningRequest[]
  /**
   * The pid each pass reported, in order. Reported at all because the store
   * keeps a row per live Codex process and the reap reads those rows: a fake
   * that spawned nothing would leave every recovery test with nothing to
   * recover.
   */
  readonly pids: number[]
  /** Every implementation turn asked for, in order. */
  readonly implementations: ImplementationRequest[]
  /** One armed failure, spent by whichever pass reaches it first. */
  failNextWith(error: Error): void
  /**
   * What the next turn answers with. Queued rather than set, so a test can
   * line up a repair cycle as the sequence of endings it actually is.
   */
  answerWith(...results: ImplementationResult[]): void
  /** Milestones every turn emits before it ends. */
  emits(
    ...milestones: { kind: 'command' | 'narration'; summary: string }[]
  ): void
}

/**
 * Records what it was asked and answers with a session. The real behaviour —
 * the process, its flags, the JSONL — is proven against the real binary in
 * `codex-cli.test.ts`; what a fake is for here is the ordering around a pass.
 */
export const createFakeCodexAdapter = (
  options: { firstPid?: number; sessionId?: string } = {},
): FakeCodexAdapter => {
  const calls: PlanningRequest[] = []
  const implementations: ImplementationRequest[] = []
  const answers: ImplementationResult[] = []
  const pids: number[] = []
  let emitted: { kind: 'command' | 'narration'; summary: string }[] = []
  let nextFailure: Error | undefined
  let nextPid = options.firstPid ?? 40_000

  /** A distinct pid per pass, so two live passes are two rows. */
  const spawn = (request: { onSpawn(pid: number): void }): void => {
    const pid = nextPid
    nextPid += 1
    pids.push(pid)
    request.onSpawn(pid)
  }

  return {
    calls,
    configured: true,
    implementations,
    pids,
    answerWith(...results) {
      answers.push(...results)
    },
    emits(...milestones) {
      emitted = milestones
    },
    failNextWith(error) {
      nextFailure = error
    },
    implement(request): Promise<ImplementationResult> {
      implementations.push(request)
      spawn(request)

      for (const milestone of emitted) {
        request.onLine(JSON.stringify({ type: 'item.completed' }))
        request.onMilestone({
          detail: null,
          exitCode: null,
          kind: milestone.kind,
          summary: milestone.summary,
        })
      }

      if (nextFailure !== undefined) {
        const failure = nextFailure
        nextFailure = undefined
        return Promise.reject(failure)
      }

      // The queue is what a repair cycle is written as; once it runs out the
      // fake keeps answering with its last word rather than changing behaviour.
      const answer = answers.length > 1 ? answers.shift() : answers[0]
      return Promise.resolve(
        answer ?? {
          failureReason: null,
          outcome: 'reportedDone',
          report: aReport(),
        },
      )
    },
    plan(request): Promise<PlanningResult> {
      calls.push(request)
      spawn(request)
      const sessionId = options.sessionId ?? 'session-1'

      // Announced before anything else, the way the real adapter announces it:
      // Codex opens the thread and then reasons, so a pass that fails has still
      // told its caller which session it failed in.
      request.onSessionId(sessionId)

      if (nextFailure !== undefined) {
        const failure = nextFailure
        nextFailure = undefined
        return Promise.reject(failure)
      }

      return Promise.resolve({ sessionId })
    },
  }
}

/** A pass the test decides when to finish, for watching a slot while it is held. */
export const aHeldCodex = () => {
  let release: () => void = () => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })

  // Only the waiting is this fake's own; what it answers with is the ordinary
  // fake's answer, so a held pass and a prompt one are the same pass.
  const inner = createFakeCodexAdapter()
  const codex: FakeCodexAdapter = {
    ...inner,
    implement: async (request) => {
      await held
      return inner.implement(request)
    },
    plan: async (request) => {
      // Announced before the wait rather than after it. The real adapter has a
      // session id seconds in and an answer minutes later, and a held pass is
      // how a test looks at a job during that stretch.
      request.onSessionId('session-1')
      await held
      return inner.plan({ ...request, onSessionId: () => {} })
    },
  }

  return { codex, release: () => release() }
}

/**
 * A pass that never finishes on its own, so a test can prove that stopping it
 * is what ends it. Resolves nothing; it rejects when its signal aborts.
 */
export const anAbortableCodex = () => {
  let started: () => void = () => {}
  const running = new Promise<void>((resolve) => {
    started = resolve
  })

  const codex: CodexAdapter = {
    configured: true,
    // The real adapter resolves a stopped turn rather than rejecting it: a stop
    // is an ending the scheduler has something to do about, not an exception.
    implement: (request) =>
      new Promise((resolve) => {
        started()
        request.signal.addEventListener(
          'abort',
          () =>
            resolve({
              failureReason: 'Implementation was stopped',
              outcome: 'stopped',
              report: null,
            }),
          { once: true },
        )
      }),
    plan: (request) =>
      new Promise((_resolve, reject) => {
        started()
        request.signal.addEventListener(
          'abort',
          () => reject(new Error('Planning was stopped')),
          { once: true },
        )
      }),
  }

  return { codex, whenStarted: running }
}

export const aFailingCodex = (
  message = 'Codex could not plan',
): CodexAdapter => ({
  configured: true,
  implement: () =>
    Promise.resolve({
      failureReason: message,
      outcome: 'failed',
      report: null,
    }),
  plan: () => Promise.reject(new Error(message)),
})
