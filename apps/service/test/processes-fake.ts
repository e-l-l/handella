import type {
  ProcessDescription,
  ProcessInspector,
} from '../src/adapters/processes.js'

export interface FakeProcessInspector extends ProcessInspector {
  /** Every signal this fake was asked to send, in order. */
  readonly terminated: { pid: number; signal: NodeJS.Signals }[]
  /** Every pid it was asked about, so a test can assert what was inspected. */
  readonly inspected: number[]
  /**
   * What holds each pid. Mutable so a test can have a process exit between the
   * SIGTERM and the SIGKILL, which is the ordinary case rather than the
   * exception.
   */
  readonly processes: Map<number, ProcessDescription>
  /** What the next `describe` should fail with, for the unavailable-`ps` path. */
  failNextWith: Error | undefined
  /**
   * Pids this fake will not signal, the way the operating system refuses one
   * that is not this user's. Keyed by pid, because a refusal is about one
   * process and the pass has to carry on past it.
   */
  readonly refusals: Map<number, Error>
}

interface FakeProcessOptions {
  processes?: Record<number, ProcessDescription>
}

/**
 * Enough of the operating system for the reap, which is about deciding rather
 * than about signalling: what `ps` prints and what `kill` does are proven
 * against the real thing by running Handella, and there is no test here that
 * could safely assert a signal reached a real process.
 *
 * Records rather than performs, deliberately. The whole point of the suite
 * that uses this is the cases where nothing must be signalled at all, and a
 * fake that actually killed things could not express them.
 */
export function createFakeProcessInspector(
  options: FakeProcessOptions = {},
): FakeProcessInspector {
  const terminated: { pid: number; signal: NodeJS.Signals }[] = []
  const inspected: number[] = []
  const refusals = new Map<number, Error>()
  const processes = new Map<number, ProcessDescription>(
    Object.entries(options.processes ?? {}).map(([pid, description]) => [
      Number(pid),
      description,
    ]),
  )

  const fake: FakeProcessInspector = {
    failNextWith: undefined,
    inspected,
    processes,
    refusals,
    terminated,

    async describe(pid) {
      inspected.push(pid)

      const failure = fake.failNextWith
      if (failure !== undefined) {
        fake.failNextWith = undefined
        throw failure
      }

      return processes.get(pid) ?? null
    },

    terminateGroup(pid, signal) {
      // Recorded only when it would have been delivered: a refused signal
      // reached nothing, and a test that counted it would be asserting the
      // opposite of what happened.
      const refusal = refusals.get(pid)
      if (refusal !== undefined) throw refusal

      terminated.push({ pid, signal })
    },
  }

  return fake
}

/**
 * A live Codex, as `ps` would describe one. `startedAt` defaults to now
 * because that is what a row written by a pass this test just ran will hold.
 */
export const aCodexProcess = (
  overrides: Partial<ProcessDescription> = {},
): ProcessDescription => ({
  command: '/Users/handler/.local/bin/codex exec resume session-7 --json',
  startedAt: new Date(),
  ...overrides,
})
