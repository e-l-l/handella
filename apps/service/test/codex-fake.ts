import type { ImplementationReport, PlanContent } from '@handella/contracts'

import type {
  CodexAdapter,
  ImplementationRequest,
  ImplementationResult,
  PlanningRequest,
  PlanningResult,
} from '../src/adapters/codex.js'

export const aPlanContent = (
  overrides: Partial<PlanContent> = {},
): PlanContent => ({
  summary: 'Make the login test wait for the session cookie.',
  steps: [
    {
      id: 'await-cookie',
      title: 'Await the session cookie before asserting',
      detail:
        'The assertion races the redirect, so it fails about one run in ten.',
      files: ['test/login.test.ts'],
      required: true,
    },
  ],
  verification: ['npm test -- login'],
  risks: ['The same race may exist in the signup test.'],
  outOfScope: ['Rewriting the auth fixture.'],
  ...overrides,
})

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
 * Records what it was asked and answers with a plan. The real behaviour — the
 * process, its flags, the JSONL — is proven against the real binary in
 * `codex-cli.test.ts`; what a fake is for here is the ordering around a pass.
 */
export const createFakeCodexAdapter = (
  options: { sessionId?: string } = {},
): FakeCodexAdapter => {
  const calls: PlanningRequest[] = []
  const implementations: ImplementationRequest[] = []
  const answers: ImplementationResult[] = []
  let emitted: { kind: 'command' | 'narration'; summary: string }[] = []
  let nextFailure: Error | undefined

  return {
    calls,
    configured: true,
    implementations,
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
      const sessionId = request.sessionId ?? options.sessionId ?? 'session-1'

      // Announced before anything else, the way the real adapter announces it:
      // Codex opens the thread and then reasons, so a pass that fails has still
      // told its caller which session it failed in.
      request.onSessionId(sessionId)

      if (nextFailure !== undefined) {
        const failure = nextFailure
        nextFailure = undefined
        return Promise.reject(failure)
      }

      return Promise.resolve({
        content: aPlanContent(),
        // A resumed pass stays in the session it resumed, which is what makes
        // "the revision ran in the same session" assertable.
        sessionId,
      })
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
      request.onSessionId(request.sessionId ?? 'session-1')
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
