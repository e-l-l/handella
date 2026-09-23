import { maxImplementationAttempts } from '@handella/contracts'

import type {
  Attempt,
  AttemptOutcome,
  Job,
  JobSource,
  JobState,
  JobSuspension,
  LinearPriority,
  MilestoneKind,
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

/**
 * The heading the job page's state banner carries. A job is suspended or it
 * is not, and the state says nothing about that, so the word "Suspended" is
 * spent on the tag beside it instead. The handoff writes "Paused — interrupted by a restart"; CONTEXT.md
 * rules out "pause" as a name for this concept, so the banner says what
 * happened rather than renaming the state.
 */
export const suspensionHeadings: Record<JobSuspension, string> = {
  stoppedByHandler: 'Stopped — you suspended this job',
  stoppedBySystem: 'Stopped — Handella suspended this job',
  interrupted: 'Stopped — interrupted by a restart',
}

/**
 * What is being held while a job is suspended, and what resuming will do.
 *
 * The handoff's rule for every blocked state: say the consequence, not the
 * condition. A Handler reading "interrupted" wants to know whether the branch
 * survived, and all three of these say so, because in all three cases it did —
 * a Suspension keeps the Worktree rather than working in it.
 */
export const suspensionConsequences: Record<JobSuspension, string> = {
  stoppedByHandler:
    'You stopped this job. The worktree and branch are kept as they were, and resuming continues from the last milestone.',
  stoppedBySystem:
    'Handella stopped this job. The worktree and branch are kept as they were; the timeline says what happened before it stopped.',
  interrupted:
    'A restart interrupted this job. The worktree and branch are intact, and resuming reopens the same Codex session where it left off.',
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

/** Linear's scale, which runs the opposite way to most: 0 is no priority. */
export const linearPriorityLabels: Record<LinearPriority, string> = {
  0: 'No priority',
  1: 'Urgent',
  2: 'High',
  3: 'Medium',
  4: 'Low',
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

/**
 * The time alone, for the job page's timeline, where the handoff right-aligns
 * `13:02` beside each entry. A spine read top to bottom does not need the date
 * on every line — the entries are minutes apart — and a full timestamp there
 * reads as data rather than as the sequence it is.
 */
const clockFormat = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' })

export const formatClock = (value: string): string =>
  clockFormat.format(new Date(value))

/**
 * How long the local service has been up, in the health strip's compact
 * spelling. Seconds are only shown while there is nothing longer to say: "up
 * 4h" is the fact, and "4h 12m 8s" is a stopwatch nobody asked for.
 */
export const formatUptime = (value: number): string => {
  // `Math.max(0, NaN)` is NaN, so a missing number is caught before it.
  const seconds = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

/**
 * A path shown at the width a meta row has for it, elided from the left: the
 * end of a worktree path is the part that identifies it, and the hundred and
 * forty characters in front of it are the same for every job on the machine.
 * `CopyButton` is what puts the whole thing back.
 */
export const elidePath = (path: string, width = 34): string => {
  if (path.length <= width) return path
  // The ellipsis is one of the characters, so the result is `width` long.
  const keep = Math.max(1, width - 1)
  return `…${path.slice(-keep)}`
}

const attemptOutcomeLabels: Record<AttemptOutcome, string> = {
  reportedDone: 'reported done',
  reportedBlocked: 'plan was wrong',
  failed: 'failed',
  timedOut: 'timed out',
  stopped: 'stopped',
  interrupted: 'interrupted',
}

/** How a turn ended, or that it has not yet. */
export const attemptOutcomeLabel = (attempt: Attempt): string =>
  attempt.outcome === null ? 'running' : attemptOutcomeLabels[attempt.outcome]

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

/**
 * `formatAge` in a sentence: "3m ago", or "just now" inside the first minute,
 * where "now ago" would not read.
 */
export const formatAgo = (value: string, now: number = Date.now()): string => {
  const age = formatAge(value, now)
  return age === 'now' ? 'just now' : `${age} ago`
}

/**
 * What a free Slot means for the next Job, which is the only reason the
 * Handler is reading the count: a dispatch either starts now or waits. Home's
 * Capacity card says this underneath the segments, because the segments have
 * already given the number.
 */
export const capacityConsequence = (free: number): string => {
  if (free === 0)
    return 'Every slot is busy. The next job you dispatch waits in the queue until one frees up.'
  if (free === 1)
    return 'One slot is free. The next job you dispatch starts immediately instead of queueing.'
  return `${free} slots free. The next job you dispatch starts immediately instead of queueing.`
}
