import type { PlanContent } from '@handella/contracts'

import type {
  CodexAdapter,
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

export interface FakeCodexAdapter extends CodexAdapter {
  /** Every pass asked for, in order, so a test can assert what was sent. */
  readonly calls: PlanningRequest[]
  /** One armed failure, spent by whichever pass reaches it first. */
  failNextWith(error: Error): void
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
  let nextFailure: Error | undefined

  return {
    calls,
    configured: true,
    failNextWith(error) {
      nextFailure = error
    },
    plan(request): Promise<PlanningResult> {
      calls.push(request)

      if (nextFailure !== undefined) {
        const failure = nextFailure
        nextFailure = undefined
        return Promise.reject(failure)
      }

      return Promise.resolve({
        content: aPlanContent(),
        // A resumed pass stays in the session it resumed, which is what makes
        // "the revision ran in the same session" assertable.
        sessionId: request.sessionId ?? options.sessionId ?? 'session-1',
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
    plan: async (request) => {
      await held
      return inner.plan(request)
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
  plan: () => Promise.reject(new Error(message)),
})
