import { Type, type Static } from 'typebox'

import type { Job } from './job.js'
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
 * How often Reconciliation asks GitHub whether the pull requests it is
 * watching have been merged.
 *
 * A timer rather than an event, because the thing being waited for happens
 * somewhere Handella cannot hear: only the Handler may merge, and they do it
 * on github.com. Minutes rather than seconds, because nothing downstream is
 * urgent — the Job is already `prOpen` and what the merge releases is a
 * worktree — and because every pass spends a `gh` invocation per watched Job.
 * The Handler who has just merged and wants it now presses "Check merge".
 */
export const mergeCheckIntervalMs = 5 * 60_000

/**
 * A slot is held by a Handella pass and by nothing else: the Job whose row
 * says a pass of Handella's is claiming it. A Job the Handler is driving from
 * their own terminal holds none — the machine it occupies is theirs — and a
 * Job held for the Handler to plan holds none either (docs/adr/0015). A
 * suspended job holds nothing: its pass is aborted and its worktree kept.
 */
export const isRunning = (job: Job): boolean =>
  job.suspension === null && job.codexPass !== null

/**
 * Codex is working in the Job's worktree, whoever is driving it — Handella's
 * pass or the Handler's terminal. What a list of work in flight shows, as
 * against what `isRunning` counts against the ceiling.
 */
export const isInFlight = (job: Job): boolean =>
  job.suspension === null &&
  (job.state === 'planning' || job.state === 'implementing')

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
 * A Job whose pull request is open and whose merge Handella is therefore
 * waiting for. Both states count: `reviewing` is a Job answering comments on
 * the same pull request, and the Handler may merge it at any point in either.
 *
 * Suspension is asked about for the reason the scheduler asks it: a stopped
 * Job is one the Handler is holding, and quietly removing its worktree because
 * the pull request happened to land is the opposite of what a stop means.
 *
 * Shared rather than private to Reconciliation because the dashboard offers
 * "Check merge" on exactly these Jobs, and a button that appears where the
 * check would do nothing is a promise Handella cannot keep.
 */
export const isAwaitingMerge = (job: Job): boolean =>
  job.suspension === null &&
  (job.state === 'prOpen' || job.state === 'reviewing')

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
