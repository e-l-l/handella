import type {
  AttentionItemKind,
  JobState,
  JobSuspension,
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

/** A job is suspended or it is not; the state says nothing about that. */
export const suspensionLabels: Record<JobSuspension, string> = {
  stoppedByHandler: 'Suspended — you stopped this job',
  stoppedBySystem: 'Suspended — Handella stopped this job',
  interrupted: 'Suspended — interrupted by a restart',
}

export const attentionKindLabels: Record<AttentionItemKind, string> = {
  planApproval: 'Plan approval',
  blocker: 'Blocker',
  disputedReview: 'Disputed review',
  conflictProposal: 'Conflict proposal',
  readyPr: 'Ready pull request',
  failure: 'Failure',
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
