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
