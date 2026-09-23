import {
  isRunning,
  isTerminalJobState,
  type Job,
  type JobState,
} from '@handella/contracts'

import type { Tone } from './components/Tag.tsx'
import { suspensionConsequences, suspensionHeadings } from './labels.ts'

/**
 * The handoff's single rule, in one place: a Job's state "drives the group a
 * row falls into, its status tag, and its single action".
 *
 * It lives here rather than in the Jobs page because Home and the job page
 * make the same three decisions about the same Job, and three screens deciding
 * separately is how a job ends up tagged `RUNNING` on one and `SUSPENDED` on
 * another.
 *
 * The handoff writes seven states and Handella has eleven plus an orthogonal
 * Suspension (ADR 0003), so this is also where the two vocabularies meet.
 * Suspension wins every time it is set: "not moving, and here is why" is the
 * more urgent fact than wherever the Job happens to have stopped.
 */

/** Which mono rule a row sits under, in the order the handoff draws them. */
export type JobGroup = 'needsYou' | 'running' | 'waiting' | 'finished'

/** Which filter pill a Job answers to, which is coarser than its group. */
export type JobLane = 'active' | 'cancelled' | 'done'

/**
 * The one action a row offers, by name rather than by weight: the weight is the
 * caller's, because the same action is a primary on Home's attention card and a
 * secondary in a Jobs row.
 *
 * `reviewPlan` and `view` navigate; the rest act.
 */
export type JobActionKind =
  | 'dispatch'
  | 'open'
  | 'openSession'
  | 'resume'
  | 'reviewPlan'
  | 'reviewPr'
  | 'view'

/**
 * Where each state lands before a Suspension is considered. A record rather
 * than a chain of tests so a twelfth state fails to compile here instead of
 * falling quietly into whichever group the chain happened to end on.
 *
 * Approved and queued are both "dispatched, waiting for a Slot to open";
 * intake is waiting for the Handler to dispatch it.
 */
const groupByState: Record<JobState, JobGroup> = {
  approved: 'waiting',
  archived: 'finished',
  cancelled: 'finished',
  implementing: 'running',
  intake: 'waiting',
  merged: 'finished',
  planReview: 'needsYou',
  planning: 'running',
  prOpen: 'needsYou',
  queued: 'waiting',
  reviewing: 'needsYou',
}

export const jobGroup = (job: Job): JobGroup => {
  const group = groupByState[job.state]
  if (group === 'finished') return group
  // Before the state's own group: a suspended job in `implementing` is not
  // running, and the whole point of the group is what it needs from you.
  return job.suspension === null ? group : 'needsYou'
}

export const jobLane = (job: Job): JobLane => {
  if (job.state === 'cancelled') return 'cancelled'
  if (job.state === 'merged' || job.state === 'archived') return 'done'
  return 'active'
}

/**
 * The uppercase mono label a status tag carries, which is not the same set of
 * words as `stateLabels`: those are written to sit in a sentence, and these are
 * written to sit in an eight-character rectangle.
 */
const stateTags: Record<JobState, { label: string; tone: Tone }> = {
  intake: { label: 'not dispatched', tone: 'neutral' },
  queued: { label: 'queued', tone: 'neutral' },
  planning: { label: 'planning', tone: 'mint' },
  planReview: { label: 'plan review', tone: 'amber' },
  approved: { label: 'approved', tone: 'neutral' },
  implementing: { label: 'running', tone: 'mint' },
  prOpen: { label: 'pr ready', tone: 'mint' },
  reviewing: { label: 'in review', tone: 'amber' },
  merged: { label: 'merged', tone: 'mintDim' },
  archived: { label: 'archived', tone: 'mintDim' },
  cancelled: { label: 'cancelled', tone: 'neutral' },
}

/**
 * One tag per Job, never two.
 *
 * The old badge drew the state and the suspension as two pills of equal weight,
 * which is the specific thing the handoff calls out on the Jobs list: "two
 * status pills of equal weight". A stopped job says `SUSPENDED` and nothing
 * else, and where it stopped is read from the timeline — or, in a list, from
 * the explanation line the row carries underneath itself.
 */
export const jobTag = (job: Job): { label: string; tone: Tone } =>
  job.suspension === null
    ? stateTags[job.state]
    : { label: 'suspended', tone: 'red' }

/**
 * Why this row is under `NEEDS YOU`, in one sentence that says what is being
 * held and what resuming or reviewing will do. Null for a Job that needs
 * nothing: the handoff only draws this line where there is a decision to make.
 */
export const needsYouReason = (job: Job): string | null => {
  if (job.suspension !== null) return suspensionConsequences[job.suspension]
  // Taken but not committed to execution. It holds its issue and nothing else,
  // which is the one thing about this state a Handler has to be told.
  if (job.state === 'intake')
    return 'This job holds its issue but has claimed no branch and cut no worktree. Dispatching claims the canonical branch, cuts the worktree and puts it in the queue.'
  if (job.state === 'planReview')
    return 'The plan is in the Codex session. Open the session to read it and approve here when it is right; nothing is written to the branch until you do.'
  if (job.state === 'prOpen')
    return 'The pull request is open and every runbook step passed. Handella never merges — reviewing and merging stay with you.'
  if (job.state === 'reviewing')
    return 'Handella has answered the review comments. The pull request is still yours to merge.'
  return null
}

/**
 * The heading the job page's state banner carries: the same fact as
 * `needsYouReason` in one line, because the banner is the first thing read on
 * the screen and a Handler should know what they are being asked before they
 * read why.
 */
export const needsYouHeading = (job: Job): string | null => {
  if (job.suspension !== null) return suspensionHeadings[job.suspension]
  if (job.state === 'intake') return 'Not dispatched yet'
  if (job.state === 'planReview')
    return 'Waiting on you — the plan needs an answer'
  if (job.state === 'prOpen') return 'Waiting on you — the pull request is open'
  if (job.state === 'reviewing')
    return 'Waiting on you — Handella has answered the review'
  return null
}

/**
 * What the timeline's newest node says about the wait.
 *
 * Shorter than `needsYouReason` and deliberately not the same sentence: the
 * banner above the spine has already explained the consequence, and a node
 * repeating it word for word would be the same paragraph twice on one screen.
 * This one says where on the spine the job stopped and what picks it up.
 */
export const waitingSince = (job: Job): string | null => {
  if (job.suspension !== null)
    return 'Stopped here. Resuming picks up from this point in the same worktree.'
  if (job.state === 'intake')
    return 'Taken, and not yet dispatched. Dispatching cuts the worktree and queues it.'
  if (job.state === 'planReview')
    return 'The plan is in the Codex session, waiting for your answer.'
  if (job.state === 'prOpen')
    return 'The pull request is open and merging is yours.'
  if (job.state === 'reviewing')
    return 'The review comments are answered and merging is yours.'
  return null
}

/**
 * The single action a row offers. Ordered by urgency rather than by state, so
 * a suspended job whose pull request happens to be open offers the resume
 * rather than the review: it is stopped, and the review is not what unsticks it.
 */
export const jobAction = (job: Job): JobActionKind => {
  if (job.suspension !== null) return 'resume'
  if (job.state === 'intake') return 'dispatch'
  if (job.state === 'planReview') return 'reviewPlan'
  if (job.state === 'prOpen' || job.state === 'reviewing') return 'reviewPr'
  if (isRunning(job)) return 'openSession'
  if (isTerminalJobState(job.state) || job.state === 'merged') return 'view'
  return 'open'
}

export const actionLabels: Record<JobActionKind, string> = {
  dispatch: 'Dispatch',
  open: 'Open',
  openSession: 'Open session',
  resume: 'Resume',
  reviewPlan: 'Review plan',
  reviewPr: 'Review pull request',
  view: 'View',
}

/**
 * The mono rule each group sits under, and the tint of the hairline beside it.
 * `count` is appended by the caller, because the label is the constant and the
 * number is not.
 */
export const groupRules: Record<
  JobGroup,
  { label: string; rule: string; text: string }
> = {
  needsYou: {
    label: 'NEEDS YOU',
    rule: 'bg-red/[0.16]',
    text: 'text-red',
  },
  running: {
    label: 'RUNNING',
    rule: 'bg-mint/[0.14]',
    text: 'text-mint',
  },
  waiting: {
    label: 'WAITING',
    rule: 'bg-line',
    text: 'text-ink-5',
  },
  finished: {
    label: 'FINISHED',
    rule: 'bg-line',
    text: 'text-ink-5',
  },
}

/** The order the handoff draws the groups in: most urgent first. */
export const groupOrder: readonly JobGroup[] = [
  'needsYou',
  'running',
  'waiting',
  'finished',
]

/**
 * A row's surface and border. The finished group drops to the muted card value
 * rather than merely dimming its text, because the handoff de-emphasises the
 * whole row and not only what it says.
 */
export const groupRowClasses: Record<JobGroup, string> = {
  needsYou: 'border border-red/[0.22] bg-raised hover:bg-raised-hover',
  running: 'border border-line bg-raised hover:bg-raised-hover',
  waiting: 'border border-line bg-raised hover:bg-raised-hover',
  finished:
    'border border-mint-soft/[0.06] bg-raised-muted hover:bg-raised-muted-hover',
}
