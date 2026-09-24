/**
 * The file Codex writes a session to, read from the outside.
 *
 * Handella starts a session and the Handler goes on to drive it from their own
 * terminal, so the turns they take happen somewhere Handella has no handle on:
 * no child process, no stream, nothing to await. What there is instead is the
 * rollout — the JSONL Codex appends every session to — and reading it is how
 * Handella notices a plan approved in the terminal and a pull request opened
 * there (docs/adr/0015).
 *
 * A port because the format is Codex's, not Handella's: the CLI already ships
 * a `migrate-rollouts` command, and the day rollouts stop being files is the
 * day one implementation is replaced rather than a component rewritten. It is
 * also what lets the watcher's tests be about the watching.
 */
export interface RolloutChunk {
  /**
   * Complete lines only. A read that lands mid-line leaves the remainder for
   * the next one rather than handing over half a record — Codex is appending
   * to this file while it is being read.
   */
  lines: string[]
  /** Where the next read starts: the byte after the last complete line. */
  nextOffset: number
  /**
   * The file is shorter than the offset it was last read to, so it is not the
   * file that offset was measured against.
   */
  truncated: boolean
}

/** An interactive session found in a worktree, by its own first line. */
export interface DiscoveredSession {
  cwd: string
  path: string
  sessionId: string
  startedAt: Date
}

export interface DiscoverSessionsInput {
  cwd: string
  /** Only sessions opened after this, which is when Handella began looking. */
  since: Date
}

export interface CodexSessions {
  /**
   * Whether Codex keeps rollouts where this adapter reads them. Asked each
   * time rather than once at startup, on the same terms as the Codex adapter's
   * own `configured`.
   */
  readonly available: boolean
  /** The rollout for a session, wherever Codex filed it, or null if there is none yet. */
  locateRollout(sessionId: string): Promise<string | null>
  readFrom(path: string, offset: number): Promise<RolloutChunk>
  /**
   * The interactive sessions the Handler started in a worktree since a moment.
   *
   * Only the ones they opened themselves: a session Handella spawned is an
   * `exec` session, and a sub-agent's rollout carries its parent's working
   * directory, so both would otherwise look like the Handler sitting down in
   * that worktree.
   */
  discoverSessions(input: DiscoverSessionsInput): Promise<DiscoveredSession[]>
}

/**
 * What a machine whose Codex keeps no rollouts gets. A null object rather than
 * an absent adapter, for the reason the unconfigured Linear adapter is one:
 * there is one code path, and it ends in a watcher that follows nothing and an
 * attention item saying so, rather than in a branch at every call site.
 */
export const unavailableCodexSessions: CodexSessions = {
  available: false,
  locateRollout: () => Promise.resolve(null),
  readFrom: (_path, offset) =>
    Promise.resolve({ lines: [], nextOffset: offset, truncated: false }),
  discoverSessions: () => Promise.resolve([]),
}
