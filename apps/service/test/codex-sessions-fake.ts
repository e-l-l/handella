import type {
  CodexSessions,
  DiscoverSessionsInput,
  DiscoveredSession,
  RolloutChunk,
} from '../src/adapters/codex-sessions.js'

/**
 * Rollouts held in memory, on the same terms the real files are read: byte
 * offsets, complete lines only, and a tail that is not handed over until it
 * has a newline. What the watcher depends on is those semantics rather than
 * the filesystem, and `codex-sessions-fs.test.ts` is where the filesystem
 * itself is proven.
 */
export interface FakeCodexSessions extends CodexSessions {
  /** Whether rollouts exist at all, for the Codex that keeps none. */
  available: boolean
  /** Appends lines to a session's rollout, creating it if it is the first. */
  append(sessionId: string, ...lines: string[]): void
  /** Makes a session findable by `discoverSessions`, as the Handler opening one. */
  discoverable(session: {
    cwd: string
    sessionId: string
    startedAt: Date
  }): void
  /** Takes a rollout out of reach, as an archive or a delete would. */
  hide(sessionId: string): void
  /** Every session read from, in order, so a test can prove one was skipped. */
  readonly reads: string[]
}

/** Codex's own naming, which is what `locateRollout` answers with. */
const pathFor = (sessionId: string): string =>
  `/sessions/2026/09/24/rollout-2026-09-24T00-00-00-${sessionId}.jsonl`

export const createFakeCodexSessions = (): FakeCodexSessions => {
  const rollouts = new Map<string, string>()
  const hidden = new Set<string>()
  const discoveries: DiscoveredSession[] = []
  const reads: string[] = []

  const sessionOf = (path: string): string | undefined =>
    [...rollouts.keys()].find((sessionId) => pathFor(sessionId) === path)

  const fake: FakeCodexSessions = {
    available: true,
    reads,

    append(sessionId, ...lines) {
      const existing = rollouts.get(sessionId) ?? ''
      rollouts.set(
        sessionId,
        existing + lines.map((line) => `${line}\n`).join(''),
      )
    },

    discoverable(session) {
      discoveries.push({
        cwd: session.cwd,
        path: pathFor(session.sessionId),
        sessionId: session.sessionId,
        startedAt: session.startedAt,
      })
    },

    hide(sessionId) {
      hidden.add(sessionId)
    },

    locateRollout(sessionId) {
      if (!fake.available) return Promise.resolve(null)
      if (hidden.has(sessionId) || !rollouts.has(sessionId)) {
        return Promise.resolve(null)
      }
      return Promise.resolve(pathFor(sessionId))
    },

    readFrom(path, offset): Promise<RolloutChunk> {
      const sessionId = sessionOf(path)
      if (sessionId !== undefined) reads.push(sessionId)

      const text =
        sessionId === undefined ? '' : (rollouts.get(sessionId) ?? '')
      const size = Buffer.byteLength(text, 'utf8')

      if (size < offset) {
        return Promise.resolve({ lines: [], nextOffset: 0, truncated: true })
      }

      const rest = Buffer.from(text, 'utf8').subarray(offset).toString('utf8')
      const lastNewline = rest.lastIndexOf('\n')
      if (lastNewline === -1) {
        return Promise.resolve({
          lines: [],
          nextOffset: offset,
          truncated: false,
        })
      }

      const complete = rest.slice(0, lastNewline)
      return Promise.resolve({
        lines: complete.split('\n').filter((line) => line !== ''),
        nextOffset: offset + Buffer.byteLength(complete, 'utf8') + 1,
        truncated: false,
      })
    },

    discoverSessions(input: DiscoverSessionsInput) {
      return Promise.resolve(
        discoveries.filter(
          (session) =>
            session.cwd === input.cwd &&
            session.startedAt.getTime() > input.since.getTime(),
        ),
      )
    },
  }

  return fake
}

/** The lines Codex writes, spelled the way the rollout spells them. */
export const rolloutLines = {
  fileChanged: (turnId = 'turn-1') =>
    JSON.stringify({
      payload: {
        item: { type: 'FileChange' },
        turn_id: turnId,
        type: 'item_completed',
      },
      type: 'event_msg',
    }),
  turnCompleted: (turnId = 'turn-1', lastAgentMessage = 'Done.') =>
    JSON.stringify({
      payload: {
        last_agent_message: lastAgentMessage,
        turn_id: turnId,
        type: 'task_complete',
      },
      type: 'event_msg',
    }),
  turnStarted: (turnId = 'turn-1') =>
    JSON.stringify({
      payload: { turn_id: turnId, type: 'task_started' },
      type: 'event_msg',
    }),
  userMessage: (turnId = 'turn-1') =>
    JSON.stringify({
      payload: {
        item: { type: 'UserMessage' },
        turn_id: turnId,
        type: 'item_completed',
      },
      type: 'event_msg',
    }),
}
