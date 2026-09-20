import { maxImplementationAttempts } from '@handella/contracts'

import type {
  Attempt,
  AttemptOutcome,
  AttentionItemKind,
  Job,
  JobSource,
  JobState,
  JobSuspension,
  LinearPriority,
  MilestoneKind,
  PlanApprovalState,
  StatusResponse,
  WorkClass,
} from '@handella/contracts'

export const stateLabels: Record<JobState, string> = {
  intake: 'Intake',
  queued: 'Queued',
  planning: 'Planning',
  planReview: 'Plan review',
  approved: 'Approved',
  implementing: 'Implementing',
  prOpen: 'PR open',
  reviewing: 'Reviewing',
  merged: 'Merged',
  archived: 'Archived',
  cancelled: 'Cancelled',
}

/**
 * How a job is named in a list: the Linear issue it came from, or the words
 * for one that has none. An absent key is a fact about the job rather than
 * missing data, so it is spelled once rather than at every surface that shows
 * a job.
 */
export const issueKeyLabel = (
  job: Pick<Job, 'linearIssueKey'> | undefined,
): string => job?.linearIssueKey ?? 'ad hoc'

/** A job is suspended or it is not; the state says nothing about that. */
export const suspensionLabels: Record<JobSuspension, string> = {
  stoppedByHandler: 'Suspended — you stopped this job',
  stoppedBySystem: 'Suspended — Handella stopped this job',
  interrupted: 'Suspended — interrupted by a restart',
}

export const workClassLabels: Record<WorkClass, string> = {
  feature: 'Feature',
  routine: 'Routine',
}

/** Where the request came from, rather than what the wire calls that place. */
export const sourceLabels: Record<JobSource, string> = {
  linear: 'Assigned to you in Linear',
  slack: 'Forwarded from Slack',
  adhoc: 'Written by you',
}

/** Every revision is kept, so a revision the Handler has not read is a state. */
export const planApprovalStateLabels: Record<PlanApprovalState, string> = {
  pending: 'Waiting on you',
  approved: 'Approved',
  changesRequested: 'Changes requested',
}

/** Linear's scale, which runs the opposite way to most: 0 is no priority. */
export const linearPriorityLabels: Record<LinearPriority, string> = {
  0: 'No priority',
  1: 'Urgent',
  2: 'High',
  3: 'Medium',
  4: 'Low',
}

export const attentionKindLabels: Record<AttentionItemKind, string> = {
  planApproval: 'Plan approval',
  blocker: 'Blocker',
  disputedReview: 'Disputed review',
  conflictProposal: 'Conflict proposal',
  readyPr: 'Ready pull request',
  failure: 'Failure',
}

export const databaseStatusLabels: Record<
  StatusResponse['database']['status'],
  string
> = {
  ok: 'Healthy',
}

/**
 * One formatter for every timestamp the dashboard shows, built once: a fresh
 * `Intl.DateTimeFormat` costs far more than formatting with an existing one,
 * and a locale decision belongs in a single place.
 */
const timestampFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
})

export const formatTimestamp = (value: string): string =>
  timestampFormat.format(new Date(value))

export const attemptOutcomeLabels: Record<AttemptOutcome, string> = {
  reportedDone: 'reported done',
  reportedBlocked: 'plan was wrong',
  failed: 'failed',
  timedOut: 'timed out',
  stopped: 'stopped',
  interrupted: 'interrupted',
}

/**
 * Which turn this is, and its round once a Handler resume has started another.
 * `noun` because the job page starts a line with it and the inbox continues
 * one; only the capital differs, and it is not worth two spellings of the rest.
 */
export const attemptLabel = (attempt: Attempt, noun = 'attempt'): string =>
  `${noun} ${attempt.attempt} of ${maxImplementationAttempts}${
    attempt.round > 1 ? ` · round ${attempt.round}` : ''
  }`

export const milestoneKindLabels: Record<MilestoneKind, string> = {
  command: 'ran',
  fileChange: 'changed',
  narration: 'said',
  todoList: 'todo',
}

/**
 * How long a turn took, in the same compact spelling as `formatAge`. A turn
 * that has not ended is measured against now, because the number a Handler
 * watching one wants is how long it has been going.
 */
export const formatDuration = (
  startedAt: string,
  endedAt: string | null,
  now: number = Date.now(),
): string => {
  const end = endedAt === null ? now : new Date(endedAt).getTime()
  const minutes = Math.max(
    0,
    Math.floor((end - new Date(startedAt).getTime()) / 60_000),
  )
  if (minutes < 1) return 'under a minute'
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

/**
 * How long something has been waiting, in the handoff's compact spelling: 18m,
 * 2h, 3d. Ages are read at a glance beside a title, where a full timestamp
 * would be read as data rather than as pressure.
 *
 * Hours stop at a day rather than running to 48, so nothing that happened
 * yesterday is still counted in hours the Handler has to divide themselves.
 */
export const formatAge = (value: string, now: number = Date.now()): string => {
  const minutes = Math.floor((now - new Date(value).getTime()) / 60_000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}
