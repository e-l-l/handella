/**
 * How often Session Watch reads the rollout files of the Jobs it follows.
 * Seconds rather than the minutes Reconciliation waits between merge checks: a
 * Handler who has just told Codex to go is looking at the dashboard now, and
 * what a pass costs is one `stat` per followed Job (docs/adr/0015).
 */
export const sessionWatchIntervalMs = 3_000

/**
 * How long a Job's rollout may be missing before Handella says it cannot
 * follow the session. Long enough for Codex to create the file after a fresh
 * interactive session opens, and for a Handler to move one they archived.
 */
export const rolloutSearchGraceMs = 10 * 60_000

/**
 * Where a watch stands: looking for the session the Handler opened in a held
 * worktree, following a rollout by byte offset, or unable to find the file it
 * was following.
 */
export const sessionWatchStatuses = [
  'discovering',
  'following',
  'lost',
] as const

export type SessionWatchStatus = (typeof sessionWatchStatuses)[number]

/**
 * What a session id may look like before it is allowed to become text.
 *
 * Two places hand one to the operating system: the terminal opener writes it
 * into a file that `codex resume "$session"` reads back, and Session Watch
 * turns it into the suffix of a filename it looks for. Neither is escaping —
 * a newline makes the launcher's file two lines and the read keeps only the
 * first, a leading dash reaches `codex resume` as a flag, and a slash makes
 * the rollout search a different directory. The id comes from Codex's own
 * `thread.started` event and is a UUID or a `thr_`-style name, so the shape is
 * narrow and worth insisting on rather than patching around: an id outside it
 * is Codex having changed, not a string to quote.
 */
export const codexSessionIdShape = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
