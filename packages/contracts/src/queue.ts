import { Type, type Static } from 'typebox'

import type { Job, JobState } from './job.js'
import { UuidSchema } from './primitives.js'

/** The masterplan's ceiling: three jobs may hold a Codex slot at once. */
export const maxConcurrency = 3

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

/**
 * What the scheduler may actually start. Narrower than `isQueued`, which is
 * about holding a position: a job whose worktree is still being cut has a
 * position but nowhere for Codex to run, and starting it would point the agent
 * at a directory that is not there yet.
 */
export const isStartable = (job: Job): boolean =>
  isQueued(job) && job.worktreePath !== null

/**
 * The order the queue is read in: the priority the Handler set, then arrival.
 * Jobs with no priority sort last rather than first, so an unordered job never
 * jumps an ordered one.
 */
export const orderQueue = (jobs: Job[]): Job[] =>
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
