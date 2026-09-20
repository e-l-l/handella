import type {
  AttemptOutcome,
  ImplementationReport,
  Job,
  LinearIssueSummary,
  MilestoneKind,
  PlanContent,
} from '@handella/contracts'

import type { Redactor } from '../domain/redact.js'

export interface PlanningRequest {
  /**
   * What the Handler asked to be changed, present only on a revision. It
   * arrives with `sessionId`: together they are the turn being taken, not a
   * fresh brief. The plan it answers is not passed, because it is already in
   * the session the revision resumes.
   */
  feedback?: string | undefined
  /**
   * The issue as Linear holds it now, not as the job recorded it at intake.
   * Read at the last moment for the reason Dispatch re-reads it: Linear is
   * authoritative and the Handler may have rewritten the issue since.
   */
  issue: LinearIssueSummary
  job: Job
  /** The procedure the plan will be executed by, so it can be planned against. */
  runbook: string
  /**
   * The session to continue. Required whenever the job has one: a revision is
   * answered in the conversation that produced what it answers.
   */
  sessionId?: string | undefined
  /** Aborted on shutdown, on a stop, and when the pass outruns its timeout. */
  signal: AbortSignal
  /** Codex runs read-only in here. The worktree exists before this is called. */
  worktreePath: string
}

export interface PlanningResult {
  content: PlanContent
  /**
   * The session this pass ran in, new or continued. Recorded against the job,
   * because the next revision and Phase 6's implementation both resume it.
   */
  sessionId: string
}

/**
 * A beat of an Attempt on its way to the spine, before it is a row: the store
 * supplies the ids, the sequence and the clock.
 */
export interface MilestoneInput {
  detail: string | null
  exitCode: number | null
  kind: MilestoneKind
  summary: string
}

export interface ImplementationRequest {
  /** Which turn of this round, 1 for the first and 2 or 3 for a repair. */
  attempt: number
  /** Which run of the budget. Above 1 only after the Handler resumed the job. */
  round: number
  issue: LinearIssueSummary
  job: Job
  /**
   * Every line Codex wrote, already redacted, in the order it wrote it. The
   * caller appends these to the Attempt's log; the adapter keeps no file.
   */
  onLine(text: string): void
  /** The readable subset of that stream, as it happens rather than at the end. */
  onMilestone(milestone: MilestoneInput): void
  /** The plan the Handler approved, quoted into the first turn's brief. */
  plan: PlanContent
  /** The Runbook Snapshot's text — what this job approved against, not today's. */
  runbook: string
  /** Always set: implementation happens in the session that planned. */
  sessionId: string
  signal: AbortSignal
  /**
   * What the previous turn left broken, and the whole of a repair turn's brief.
   * Empty on the first attempt.
   */
  unresolved: readonly string[]
  /** Codex writes here, and nowhere else. */
  worktreePath: string
}

/**
 * How the turn ended, in the Attempt's own vocabulary.
 *
 * `implement` resolves for every ending a turn can reach, including the ones
 * that went badly, because each is something the scheduler does a different
 * thing about. It rejects only when Codex could not be run at all, which is not
 * an ending but an absence.
 *
 * `interrupted` is excluded: only a restart can decide a turn was interrupted,
 * and by then nothing is here to say so.
 */
export interface ImplementationResult {
  failureReason: string | null
  outcome: Exclude<AttemptOutcome, 'interrupted'>
  report: ImplementationReport | null
}

/** The two passes Handella asks Codex to take, and nothing else. */
export interface CodexAdapter {
  /** Whether a real Codex is behind this, so status can say so. */
  readonly configured: boolean
  implement(input: ImplementationRequest): Promise<ImplementationResult>
  plan(input: PlanningRequest): Promise<PlanningResult>
}

export interface CodexAdapterOptions {
  /**
   * Applied to every line and every message this adapter produces. Injected
   * here rather than called by each consumer, so there is one place redaction
   * can be forgotten and it is this one.
   */
  redact: Redactor
}
