import type { Job, LinearIssueSummary, PlanContent } from '@handella/contracts'

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

/** The read-only planning pass, and the only thing Handella asks Codex to do. */
export interface CodexAdapter {
  /** Whether a real Codex is behind this, so status can say so. */
  readonly configured: boolean
  plan(input: PlanningRequest): Promise<PlanningResult>
}
