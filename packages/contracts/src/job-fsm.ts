import { jobStates, type JobState } from './job.js'
import { isOneOf } from './primitives.js'

/**
 * The complete v1 lifecycle. Later phases attach triggers to these edges rather
 * than adding new ones, so the dashboard can derive its actions from this table
 * today and stay correct as the integrations land.
 *
 * Named for the state machine rather than the storage table of the same shape
 * (`jobTransitions` in the service schema), so a module can import both.
 *
 * `prOpen -> implementing` is the bounded CI repair cycle (Phase 10);
 * `reviewing -> implementing` is accepted-review child-PR work (Phase 11).
 *
 * Both edges back to `queued` exist so a job that needs planning again goes
 * through the scheduler rather than around it: a restart re-queues what it
 * interrupted, and a Handler who wants the plan made again sends it back.
 * Either way the slot is granted by `availableSlots` and never by whoever
 * asked. There is deliberately no `planReview -> planning`: it would be a way
 * into a state that holds a slot with nothing running in it.
 *
 * `planReview -> implementing` is the Handler approving in the terminal rather
 * than in the dashboard — Handella sees the session begin to write and follows
 * it (docs/adr/0015). It carries the same runbook-snapshot guard as
 * `approved`, so neither way in reaches implementation without a record of the
 * procedure it runs by.
 */
export const jobStateTransitions: Record<JobState, readonly JobState[]> = {
  intake: ['queued', 'cancelled'],
  queued: ['planning', 'cancelled'],
  planning: ['planReview', 'queued', 'cancelled'],
  planReview: ['queued', 'approved', 'implementing', 'cancelled'],
  approved: ['implementing', 'cancelled'],
  implementing: ['prOpen', 'cancelled'],
  prOpen: ['implementing', 'reviewing', 'merged', 'cancelled'],
  reviewing: ['implementing', 'prOpen', 'merged', 'cancelled'],
  merged: ['archived'],
  archived: [],
  cancelled: [],
}

/** States a job can never leave. */
export const terminalJobStates = jobStates.filter(
  (state) => jobStateTransitions[state].length === 0,
)

/**
 * States with nothing left to supervise: a merged job is still movable (to
 * archived) but the work behind it is done, which is why this is wider than
 * `terminalJobStates`.
 */
export const settledJobStates: readonly JobState[] = [
  ...terminalJobStates,
  'merged',
]

export const isJobState = isOneOf(jobStates)

export const isTerminalJobState = (state: JobState): boolean =>
  jobStateTransitions[state].length === 0

export const isSettledJobState = (state: JobState): boolean =>
  settledJobStates.includes(state)

/**
 * Accepts strings rather than `JobState` so it can guard values arriving from
 * the database or the wire without a cast at every call site.
 */
export const canTransition = (from: string, to: string): boolean =>
  isJobState(from) && isJobState(to) && jobStateTransitions[from].includes(to)

export const legalTransitionsFrom = (from: string): readonly JobState[] =>
  isJobState(from) ? jobStateTransitions[from] : []
