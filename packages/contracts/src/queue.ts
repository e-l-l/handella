import { Type, type Static } from 'typebox'

import type { Job, JobState } from './job.js'
import { UuidSchema } from './primitives.js'

/** The masterplan's ceiling: three jobs may hold a Codex slot at once. */
export const maxConcurrency = 3

/**
 * How long a planning pass may run before Handella stops waiting for it.
 *
 * A constant rather than a setting, for ADR 0006's reason: the failure a bad
 * value causes is a job stopped too early, which the Handler would read as
 * Codex being unreliable rather than as a number they chose. It is a ceiling
 * on a stuck process, not a budget — a pass that reaches it has stopped making
 * progress, and the slot it holds is worth more than the pass.
 */
export const planningTimeoutMs = 30 * 60_000

/**
 * The same ceiling for an implementation pass, which has more to do: a fresh
 * worktree holds no dependencies, so the runbook's test step installs them
 * before it can run anything.
 */
export const implementationTimeoutMs = 90 * 60_000

/**
 * How long a Codex pass of either kind may say nothing at all. A wall clock
 * only catches a wedged pass once its whole budget is gone; silence catches the
 * same pass in ten minutes, and a pass that is working is never silent — it
 * reports every command it runs and every file it touches.
 */
export const codexIdleMs = 10 * 60_000

/**
 * A slot is held while Codex is working in a job's worktree. Planning counts:
 * it is a read-only Codex pass, and it occupies the machine the same way.
 */
const runningStates: readonly JobState[] = ['planning', 'implementing']

/** A suspended job holds nothing — its worktree is kept, not worked in. */
export const isRunning = (job: Job): boolean =>
  job.suspension === null && runningStates.includes(job.state)

/**
 * In the queue, which only Dispatch puts a job into: a job still in `intake`
 * has been taken but not committed to execution, so it holds no position and
 * is not counted among the jobs waiting for a slot.
 *
 * Suspension is asked about here for the same reason the scheduler asks
 * `suspension IS NULL` (ADR 0003): a stopped job cannot be started from the
 * queue, so showing it holding a position would promise a turn it will not get.
 */
export const isQueued = (job: Job): boolean =>
  job.suspension === null && job.state === 'queued'

/** A job the scheduler has already established it can point Codex at. */
export type StartableJob = Job & { worktreePath: string }

/**
 * What the scheduler may actually start. Narrower than `isQueued`, which is
 * about holding a position: a job whose worktree is still being cut has a
 * position but nowhere for Codex to run, and starting it would point the agent
 * at a directory that is not there yet.
 *
 * Narrows rather than merely answering, so the caller that filtered on this
 * does not have to coerce the very field it filtered on.
 */
export const isStartable = (job: Job): job is StartableJob =>
  isQueued(job) && job.worktreePath !== null

/**
 * What the scheduler may start implementing: a job whose plan the Handler has
 * approved, with a worktree to run in. The same narrowing as `isStartable` and
 * for the same reason — the caller that filtered on it should not have to
 * coerce the field it filtered on.
 */
export const isImplementable = (job: Job): job is StartableJob =>
  job.suspension === null &&
  job.state === 'approved' &&
  job.worktreePath !== null

/**
 * The order the queue is read in: the priority the Handler set, then arrival.
 * Jobs with no priority sort last rather than first, so an unordered job never
 * jumps an ordered one.
 */
export const orderQueue = <JobLike extends Job>(jobs: JobLike[]): JobLike[] =>
  [...jobs].sort((left, right) => {
    const byPriority =
      (left.queuePriority ?? Number.MAX_SAFE_INTEGER) -
      (right.queuePriority ?? Number.MAX_SAFE_INTEGER)
    if (byPriority !== 0) return byPriority
    return left.createdAt.localeCompare(right.createdAt)
  })

/**
 * How many jobs the scheduler may start right now. Shared rather than derived
 * twice, because the dashboard's concurrency chip and the scheduler's own
 * decision have to agree about what "running" means or the UI promises a slot
 * the scheduler will not give.
 */
export const availableSlots = (jobs: Job[]): number =>
  Math.max(0, maxConcurrency - jobs.filter(isRunning).length)

/**
 * The whole order in one write rather than a priority per job, so reordering
 * is a single transaction and two jobs can never end up holding the same
 * position. Positions are rewritten 1..n from this list; any queued job left
 * out keeps a null priority and sorts after the ordered ones.
 */
export const QueueOrderRequestSchema = Type.Object(
  {
    jobIds: Type.Array(UuidSchema, { minItems: 1 }),
  },
  { additionalProperties: false, $id: 'QueueOrderRequest' },
)

export type QueueOrderRequest = Static<typeof QueueOrderRequestSchema>
