import type {
  AttemptOutcome,
  ImplementationReport,
  Job,
  LinearIssueSummary,
  MilestoneKind,
} from '@handella/contracts'

import type { Redactor } from '../domain/redact.js'

export interface PlanningRequest {
  /**
   * The issue as Linear holds it now, not as the job recorded it at intake.
   * Read at the last moment for the reason Dispatch re-reads it: Linear is
   * authoritative and the Handler may have rewritten the issue since.
   */
  issue: LinearIssueSummary
  job: Job
  /**
   * The session, the moment Codex opens it rather than when the pass ends.
   *
   * A first pass reports its id within seconds of starting and then reasons
   * for minutes, so a caller that waits for the result has nothing to offer a
   * Handler for the whole of the pass they most want to look inside. It is
   * also what makes a session survive a pass that fails: without this, a
   * planning pass that dies takes its conversation with it and the retry
   * starts a fresh one.
   *
   * Called once per pass, and not at all by a pass that never got that far.
   */
  onSessionId(sessionId: string): void
  /**
   * Told the pid of the Codex process the moment it exists.
   *
   * Every pass reports one, because a pid nobody wrote down is a process no
   * restart can find again: the pass that started it is the only thing holding
   * a handle, and a crash takes that handle with it. What the caller does with
   * it is keep a row until the pass ends, so Reconciliation can reap what this
   * process left behind (docs/adr/0012).
   */
  onSpawn(pid: number): void
  /** The procedure the plan will be executed by, so it can be planned against. */
  runbook: string
  /** Aborted on shutdown, on a stop, and when the pass outruns its timeout. */
  signal: AbortSignal
  /**
   * Where Codex runs, under whatever sandbox the Handler's own configuration
   * says. The worktree exists before this is called.
   */
  worktreePath: string
}

/**
 * Nothing but the session: the plan itself is prose in that conversation, read
 * by the Handler in their terminal rather than stored here (docs/adr/0015).
 */
export interface PlanningResult {
  /**
   * The session this pass opened. The same id `onSessionId` already reported:
   * it is repeated here so a caller that only wants the ending does not have
   * to have been watching.
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
  /**
   * Told the pid of the Codex process the moment it exists.
   *
   * Every pass reports one, because a pid nobody wrote down is a process no
   * restart can find again: the pass that started it is the only thing holding
   * a handle, and a crash takes that handle with it. What the caller does with
   * it is keep a row until the pass ends, so Reconciliation can reap what this
   * process left behind (docs/adr/0012).
   */
  onSpawn(pid: number): void
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
