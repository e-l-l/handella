import { randomUUID } from 'node:crypto'

import {
  canTransition,
  canonicalBranchForRound,
  defaultBaseBranch,
  isSettledJobState,
  isRepairable,
  isTerminalJobState,
  settledJobStates,
  orderQueue,
  maxImplementationAttempts,
  type Attempt,
  type AttemptOutcome,
  type AttentionItem,
  type AttentionItemKind,
  type BaseBranchSuggestions,
  type CreateJob,
  type DomainEvent,
  type IntakeChoices,
  type Job,
  type JobSource,
  type JobState,
  type JobSuspension,
  type JobTransitionRecord,
  type ImplementationReport,
  type Milestone,
  type MilestoneKind,
  type CreateRepository,
  type CreateRunbookVersion,
  type PlanContent,
  type PlanVersion,
  type Repository,
  type ReviewRound,
  type RunbookSnapshot,
  type RunbookVersion,
  type TransitionActor,
  type UpdateRepository,
} from '@handella/contracts'
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNull,
  max,
  ne,
  notInArray,
  sql,
  type SQL,
} from 'drizzle-orm'
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core'

import type { HandellaDatabase } from '../database/database.js'
import type { Broadcaster } from '../events/broadcaster.js'
import {
  attemptNotFound,
  attentionItemNotFound,
  canonicalBranchClaimed,
  codexSessionMissing,
  dispatchNeedsLinearIssue,
  dispatchNeedsRepository,
  illegalTransition,
  jobNotFound,
  linearIssueAlreadyLinked,
  planVersionNotFound,
  repositoryInUse,
  repositoryNotFound,
  runbookVersionNotFound,
  stateConflict,
  suspensionNotAllowed,
  transitionGuardFailed,
} from './errors.js'
import { attemptLogPathFor } from './attempt-log.js'
import { parseImplementationReport } from './implementation-report.js'
import { assertPlanContent, parsePlanContent } from './plan-content.js'
import {
  attentionItems,
  implementationAttempts,
  jobTransitions,
  jobs,
  milestones,
  planVersions,
  repositories,
  reviewRounds,
  runbookSnapshots,
  runbookVersions,
} from '../database/schema.js'

type JobRow = typeof jobs.$inferSelect
type RepositoryRow = typeof repositories.$inferSelect
type AttentionRow = typeof attentionItems.$inferSelect
type TransitionRow = typeof jobTransitions.$inferSelect
type PlanRow = typeof planVersions.$inferSelect
type RunbookRow = typeof runbookSnapshots.$inferSelect
type RunbookVersionRow = typeof runbookVersions.$inferSelect
type ReviewRow = typeof reviewRounds.$inferSelect
type AttemptRow = typeof implementationAttempts.$inferSelect
type MilestoneRow = typeof milestones.$inferSelect
type Transaction = Parameters<Parameters<HandellaDatabase['transaction']>[0]>[0]
/** Whatever a read can run on: the connection outside a unit of work, the transaction inside one. */
type Executor = HandellaDatabase | Transaction
/** Every table hanging off a job, which is what `listForJob` can read. */
type ChildTable = SQLiteTable & { jobId: SQLiteColumn }

export interface TransitionJobInput {
  actor: TransitionActor
  /** Optimistic lock. When given, the move only applies if the job is still here. */
  expectedState?: JobState | undefined
  jobId: string
  reason?: string | undefined
  to: JobState
}

/** What a job needs from Linear to be dispatchable, and nothing more. */
export interface LinearIssueLink {
  branchName: string
  id: string
  identifier: string
  title: string
  url: string
}

export interface CreateJobForLinearIssueInput extends IntakeChoices {
  issue: LinearIssueLink
  /**
   * Where the request came from, not whether the job has a Linear issue: an ad
   * hoc job has one too, because that is what makes it dispatchable. Phase 4
   * must key dispatch on the canonical branch and the issue id, never on this.
   */
  source: JobSource
}

/** What the local service already knows about a Linear issue Intake is offering. */
export interface IssueIntakeFacts {
  /** The live Job holding this issue, or null while it is free. */
  heldByJobId: string | null
  /**
   * Which round the next Job for this issue would be. Counts settled Jobs too,
   * so a cancelled one never frees its branch name for reuse (ADR 0004).
   */
  nextRound: number
}

/**
 * Dispatch in one transaction: the Canonical Branch is recomputed from the name
 * Linear holds now, checked against every live claim, and fixed — all before
 * anything touches git. ADR 0004 has this computed twice over a Job's life, and
 * this is the second and final time.
 */
export interface ClaimForDispatchInput {
  /** Linear's current branch name for the issue, unsuffixed. */
  branchName: string
  jobId: string
}

export interface DispatchClaim {
  job: Job
  repository: Repository
}

export interface SuspendJobInput {
  jobId: string
  reason?: string | undefined
  suspension: JobSuspension
}

export interface ApprovePlanInput {
  expectedState?: JobState | undefined
  jobId: string
  planVersionId: string
}

export interface RequestPlanChangesInput extends ApprovePlanInput {
  feedback: string
}

export interface StartAttemptInput {
  jobId: string
  /** The root the turn's log path is composed under. */
  logRoot: string
  sessionId: string
}

export interface FinishAttemptInput {
  attemptId: string
  failureReason: string | null
  outcome: AttemptOutcome
  report: ImplementationReport | null
}

export interface RecordMilestoneInput {
  attemptId: string
  detail: string | null
  exitCode: number | null
  jobId: string
  kind: MilestoneKind
  summary: string
}

export interface Store {
  /** The compensating write: git failed, so the claim is given back. */
  abandonDispatch(input: { jobId: string; reason: string }): Job
  /**
   * The other compensating write: a pass ended without producing a plan, so
   * the slot is given back. Stopped and re-queued together, the way a restart
   * does it — `planning` is not a state the scheduler starts from, so a job
   * left there once its pass has ended holds a third of the machine for as
   * long as it sits, and lifting its suspension would not hand that back.
   *
   * A job the Handler had already stopped keeps their suspension and their
   * reason, and is re-queued on the same terms. A job that has already left
   * `planning` is returned untouched.
   */
  abandonPlanningPass(input: { jobId: string; reason: string }): Job
  /**
   * Approval in one transaction: the revision is marked, the Runbook in force
   * is copied against the job, and only then does the job move. The guard on
   * `approved` reads both of those writes, so doing them separately would be a
   * job that is approved with nothing to execute.
   */
  approvePlan(input: ApprovePlanInput): Job
  /**
   * Opens the next implementation turn and numbers it. Joins the open round
   * while that round has turns left and its last one ended in a way Handella
   * may answer by itself; otherwise opens a new round, which only a Handler
   * resume can reach.
   */
  startAttempt(input: StartAttemptInput): Attempt
  /** Closes the turn with how it ended. The row is never written to again. */
  finishAttempt(input: FinishAttemptInput): Attempt
  /**
   * One beat of a running turn. Raises no event: a turn produces these faster
   * than a dashboard should refetch, so the pass coalesces its own announcing.
   */
  recordMilestone(input: RecordMilestoneInput): Milestone
  listAttempts(jobId: string): Attempt[]
  /**
   * The job's newest turn. Named for the reason `latestPlanVersion` is: the
   * ordering that makes `listAttempts().at(-1)` the right row lives in the
   * query, and a caller should not have to know it — or read every earlier
   * turn's report to reach the last one.
   */
  latestAttempt(jobId: string): Attempt | undefined
  listMilestones(jobId: string): Milestone[]
  /** Where a turn's raw stream was written, for the endpoint that serves it. */
  attemptLogPath(input: { attemptId: string; jobId: string }): string
  /**
   * The pull request Handella found on the job's branch — found, rather than
   * reported: the url the agent claimed is kept on the attempt and this is the
   * one GitHub actually answered with.
   *
   * Recording it and moving the job are one write. Two would let a job reach
   * `prOpen` carrying no url, or hold a url while the orphan rule started
   * another ninety-minute turn against the pull request it names.
   */
  openPullRequest(input: { jobId: string; url: string }): Job
  /**
   * An implementation with nowhere left to go. Suspended by the system with a
   * failure item carrying the reason, and left exactly where it is: the job is
   * still mid-implementation, and its worktree still holds the work.
   */
  failImplementation(input: { body: string; jobId: string }): Job
  claimForDispatch(input: ClaimForDispatchInput): DispatchClaim
  createJob(input: CreateJob): Job
  /** Numbering is per job and every revision is kept, approved or not. */
  createPlanVersion(input: { content: PlanContent; jobId: string }): PlanVersion
  createRepository(input: CreateRepository): Repository
  /** Append-only: the new version becomes the active one by being the highest. */
  createRunbookVersion(input: CreateRunbookVersion): RunbookVersion
  deleteRepository(repositoryId: string): void
  getRepository(repositoryId: string): Repository
  listRepositories(): Repository[]
  updateRepository(repositoryId: string, input: UpdateRepository): Repository
  createJobForLinearIssue(input: CreateJobForLinearIssueInput): Job
  describeIssuesForIntake(
    issueIds: readonly string[],
  ): Map<string, IssueIntakeFacts>
  getJob(jobId: string): Job
  listBaseBranchSuggestions(options?: { limit?: number }): BaseBranchSuggestions
  listAttentionItems(options?: { includeResolved?: boolean }): AttentionItem[]
  listJobTransitions(jobId: string): JobTransitionRecord[]
  listJobs(): Job[]
  listPlanVersions(jobId: string): PlanVersion[]
  /**
   * The newest revision on its own, for the callers that only ever want that
   * one. ADR 0007 puts no ceiling on how many a job accumulates, so reading
   * the whole history to look at the end of it grows without bound.
   */
  latestPlanVersion(jobId: string): PlanVersion | undefined
  listReviewRounds(jobId: string): ReviewRound[]
  listRunbookSnapshots(jobId: string): RunbookSnapshot[]
  /** The snapshot a job approved against: its newest, and the only one a pass wants. */
  latestRunbookSnapshot(jobId: string): RunbookSnapshot | undefined
  listRunbookVersions(): RunbookVersion[]
  /** The Runbook a plan approved now would execute: the highest version. */
  activeRunbook(): RunbookVersion
  /**
   * Nothing this process started is still running, so anything the database
   * says is planning or implementing was cut off mid-pass.
   *
   * A planning job is returned to the queue and suspended rather than left
   * where it was: `planning` holds a slot, and after three restarts mid-plan an
   * untouched installation would never start a job again.
   *
   * An implementing job is suspended where it stands. It is not re-queued: its
   * worktree holds work, and queueing it would ask Handella to plan a job it
   * has already approved. Suspending it is also what stops the scheduler
   * treating it as a turn that merely lost its pass and starting another —
   * masterplan.md has an interrupted job wait for the Handler.
   */
  markInterrupted(): Job[]
  recordCodexSession(input: { jobId: string; sessionId: string }): Job
  /** The Handler's feedback, and the job back to the queue to answer it. */
  requestPlanChanges(input: RequestPlanChangesInput): Job
  recordWorktree(input: { jobId: string; worktreePath: string }): Job
  /**
   * The whole order in one write, so two jobs can never share a position.
   * Answers with the queue as it now stands; only the rows that actually
   * changed are announced.
   */
  reorderQueue(jobIds: readonly string[]): Job[]
  resolveAttentionItem(attentionItemId: string): AttentionItem
  resumeJob(jobId: string): Job
  suspendJob(input: SuspendJobInput): Job
  transitionJob(input: TransitionJobInput): Job
}

interface CreateStoreOptions {
  broadcaster: Broadcaster
  database: HandellaDatabase
  idFactory?: () => string
  now?: () => Date
}

interface AttentionRule {
  kind: AttentionItemKind
  title: string
}

/**
 * Lifecycle attention items follow the state rather than being raised by hand:
 * arriving somewhere the Handler must act creates one, leaving resolves it.
 * Everything else (blockers, failures) is raised by whatever caused it.
 */
const attentionOnEnter: Partial<Record<JobState, AttentionRule>> = {
  planReview: { kind: 'planApproval', title: 'Plan is waiting for approval' },
  prOpen: { kind: 'readyPr', title: 'Pull request is ready for review' },
}

/**
 * A suspension the Handler chose needs no item; they already know, so
 * `stoppedByHandler` carries no rule. The other two are decisions waiting on
 * them, which is what a blocker is — neither is a failure, because an
 * interrupted job has not failed, it has stopped.
 */
const suspensionAttention: Partial<Record<JobSuspension, AttentionRule>> = {
  stoppedBySystem: {
    kind: 'blocker',
    title: 'Job stopped and needs a decision',
  },
  interrupted: {
    kind: 'blocker',
    title: 'Job was interrupted and needs a resume',
  },
}

/**
 * What an implementation that has run out of repair turns raises, instead of
 * the generic blocker `stoppedBySystem` would otherwise carry. The Handler
 * already knows the job stopped; what they need is why, and a failure item is
 * where the reason goes.
 */
const implementationFailure: AttentionRule = {
  kind: 'failure',
  title: 'Implementation could not finish',
}

/** Derived, so leaving a rule table always clears exactly what entering it can raise. */
const kindsOf = (
  rules: Readonly<Record<string, AttentionRule | undefined>>,
): readonly AttentionItemKind[] => [
  ...new Set(
    Object.values(rules)
      .filter((rule) => rule !== undefined)
      .map((rule) => rule.kind),
  ),
]

const lifecycleKinds = kindsOf(attentionOnEnter)

/**
 * What a resume answers: derived from the same rules that raise it, so a new
 * reason to suspend cannot be left unanswerable. The failure item joins the
 * suspension items because a Handler who resumes a job has read the failure and
 * decided what to do about it; leaving it open would ask them to answer it
 * twice.
 */
const resumableKinds = kindsOf({
  ...suspensionAttention,
  implementation: implementationFailure,
})

/**
 * What has to be true of a job before it may enter a state, asked on every
 * path into it. A table rather than a run of `if`s in the transition, because
 * the semantic endpoints are not the only way a job moves: the Handler can
 * drive a transition by hand, the scheduler drives its own, and a rule that
 * only the polite caller honours is not a rule.
 */
type TransitionGuard = (tx: Transaction, job: JobRow) => void

/** CONTEXT.md: the canonical branch is authoritative and Dispatch fixes it. */
const requiresCanonicalBranch: TransitionGuard = (_tx, job) => {
  if (job.canonicalBranch === null) {
    throw transitionGuardFailed(
      'A job cannot be queued until Linear has provided its canonical branch name',
    )
  }
}

/**
 * Approved means "ready to implement, and here is exactly what will be
 * implemented and how". Both halves are records, so both are checked: a job
 * that reached this state without them would hand Phase 6 nothing to execute.
 */
const requiresApprovedPlanAndSnapshot: TransitionGuard = (tx, job) => {
  const approved = tx
    .select({ id: planVersions.id })
    .from(planVersions)
    .where(
      and(
        eq(planVersions.jobId, job.id),
        eq(planVersions.approvalState, 'approved'),
      ),
    )
    .get()

  if (approved === undefined) {
    throw transitionGuardFailed(
      'A job cannot be approved until one of its plan revisions has been',
    )
  }

  const snapshot = tx
    .select({ id: runbookSnapshots.id })
    .from(runbookSnapshots)
    .where(eq(runbookSnapshots.jobId, job.id))
    .get()

  if (snapshot === undefined) {
    throw transitionGuardFailed(
      'A job cannot be approved without a runbook snapshot to execute',
    )
  }
}

const transitionGuards: Partial<Record<JobState, TransitionGuard>> = {
  queued: requiresCanonicalBranch,
  approved: requiresApprovedPlanAndSnapshot,
}

const toJob = (row: JobRow): Job => ({
  id: row.id,
  source: row.source,
  title: row.title,
  workClass: row.workClass,
  state: row.state,
  suspension: row.suspension ?? null,
  linearIssueKey: row.linearIssueKey ?? null,
  linearIssueId: row.linearIssueId ?? null,
  linearIssueUrl: row.linearIssueUrl ?? null,
  canonicalBranch: row.canonicalBranch ?? null,
  repositoryId: row.repositoryId ?? null,
  baseBranch: row.baseBranch,
  queuePriority: row.queuePriority ?? null,
  worktreePath: row.worktreePath ?? null,
  codexSessionId: row.codexSessionId ?? null,
  originalPrUrl: row.originalPrUrl ?? null,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
})

const toRepository = (row: RepositoryRow): Repository => ({
  id: row.id,
  name: row.name,
  path: row.path,
  defaultBaseBranch: row.defaultBaseBranch,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
})

const toAttentionItem = (row: AttentionRow): AttentionItem => ({
  id: row.id,
  jobId: row.jobId ?? null,
  kind: row.kind,
  title: row.title,
  body: row.body ?? null,
  createdAt: row.createdAt.toISOString(),
  resolvedAt: row.resolvedAt?.toISOString() ?? null,
})

const toTransition = (row: TransitionRow): JobTransitionRecord => ({
  id: row.id,
  jobId: row.jobId,
  fromState: row.fromState,
  toState: row.toState,
  actor: row.actor,
  reason: row.reason ?? null,
  occurredAt: row.occurredAt.toISOString(),
})

const toPlanVersion = (row: PlanRow): PlanVersion => ({
  id: row.id,
  jobId: row.jobId,
  revision: row.revision,
  content: parsePlanContent(row.content, 'A stored plan'),
  feedback: row.feedback ?? null,
  approvalState: row.approvalState,
  approvedAt: row.approvedAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
})

/**
 * A report as it was stored, or nothing.
 *
 * Read defensively rather than asserted: the schema a report was written under
 * is the schema of the day it was written, and a field added to
 * `ImplementationReportSchema` later would otherwise turn every historical row
 * into a failed read — of an endpoint the job page and the inbox both call. The
 * row still says a turn happened and how it ended, which is what the spine
 * draws; the report is the part that may age out.
 */
const storedReport = (raw: string | null): ImplementationReport | null => {
  if (raw === null) return null
  try {
    return parseImplementationReport(raw, 'A stored completion report')
  } catch {
    return null
  }
}

const toAttempt = (row: AttemptRow): Attempt => ({
  id: row.id,
  jobId: row.jobId,
  round: row.round,
  attempt: row.attempt,
  codexSessionId: row.codexSessionId,
  startedAt: row.startedAt.toISOString(),
  endedAt: row.endedAt?.toISOString() ?? null,
  outcome: row.outcome ?? null,
  report: storedReport(row.report),
  failureReason: row.failureReason ?? null,
})

const toMilestone = (row: MilestoneRow): Milestone => ({
  id: row.id,
  jobId: row.jobId,
  attemptId: row.attemptId,
  seq: row.seq,
  kind: row.kind,
  summary: row.summary,
  detail: row.detail ?? null,
  exitCode: row.exitCode ?? null,
  occurredAt: row.occurredAt.toISOString(),
})

const toRunbookSnapshot = (row: RunbookRow): RunbookSnapshot => ({
  id: row.id,
  jobId: row.jobId,
  runbookVersionId: row.runbookVersionId,
  content: row.content,
  createdAt: row.createdAt.toISOString(),
})

const toRunbookVersion = (row: RunbookVersionRow): RunbookVersion => ({
  id: row.id,
  version: row.version,
  content: row.content,
  createdAt: row.createdAt.toISOString(),
})

const toReviewRound = (row: ReviewRow): ReviewRound => ({
  id: row.id,
  jobId: row.jobId,
  roundNumber: row.roundNumber,
  comments: row.comments,
  verdicts: row.verdicts ?? null,
  childBranch: row.childBranch ?? null,
  childPrUrl: row.childPrUrl ?? null,
  createdAt: row.createdAt.toISOString(),
})

const jobChanged = (job: Job): DomainEvent => ({
  name: 'job.changed',
  data: { jobId: job.id, state: job.state, suspension: job.suspension },
})

const attentionChanged = (item: AttentionItem): DomainEvent => ({
  name: 'attention.changed',
  data: { attentionItemId: item.id, jobId: item.jobId },
})

export function createStore(options: CreateStoreOptions): Store {
  const { broadcaster, database } = options
  const newId = options.idFactory ?? randomUUID
  const clock = options.now ?? (() => new Date())

  const readJob = (executor: Executor, jobId: string): JobRow => {
    const row = executor.select().from(jobs).where(eq(jobs.id, jobId)).get()
    if (row === undefined) {
      throw jobNotFound(jobId)
    }
    return row
  }

  /**
   * Every child list is the same read, so the existence check that makes a
   * missing job a 404 rather than an empty array lives here once.
   */
  const listForJob =
    <Table extends ChildTable, Result>(
      table: Table,
      orderBy: SQL | SQLiteColumn,
      map: (row: Table['$inferSelect']) => Result,
    ) =>
    (jobId: string): Result[] => {
      readJob(database, jobId)
      return database
        .select()
        .from(table)
        .where(eq(table.jobId, jobId))
        .orderBy(orderBy)
        .all()
        .map(map)
    }

  const openItemsOfKinds = (
    tx: Transaction,
    jobId: string,
    kinds: readonly AttentionItemKind[],
  ): AttentionRow[] =>
    tx
      .select()
      .from(attentionItems)
      .where(
        and(
          eq(attentionItems.jobId, jobId),
          isNull(attentionItems.resolvedAt),
          inArray(attentionItems.kind, [...kinds]),
        ),
      )
      .all()

  const resolveItems = (
    tx: Transaction,
    rows: AttentionRow[],
    now: Date,
    events: DomainEvent[],
  ): void => {
    if (rows.length === 0) {
      return
    }

    tx.update(attentionItems)
      .set({ resolvedAt: now })
      .where(
        inArray(
          attentionItems.id,
          rows.map((row) => row.id),
        ),
      )
      .run()

    for (const row of rows) {
      events.push(
        attentionChanged(toAttentionItem({ ...row, resolvedAt: now })),
      )
    }
  }

  /**
   * Takes the open items the caller has already read rather than re-reading
   * them, so raising is one insert and never a second query.
   */
  const raiseItem = (
    tx: Transaction,
    alreadyOpen: readonly AttentionRow[],
    input: {
      body: string | null
      jobId: string
      rule: AttentionRule
    },
    now: Date,
    events: DomainEvent[],
  ): void => {
    if (alreadyOpen.some((item) => item.kind === input.rule.kind)) {
      return
    }

    const row: AttentionRow = {
      id: newId(),
      jobId: input.jobId,
      kind: input.rule.kind,
      title: input.rule.title,
      body: input.body,
      createdAt: now,
      resolvedAt: null,
    }
    tx.insert(attentionItems).values(row).run()
    events.push(attentionChanged(toAttentionItem(row)))
  }

  /**
   * Stopped where it stands: the suspension, the item it raises, and the
   * announcement, in that order. Three callers did exactly this by hand —
   * `suspendJob`, the held branch of `markInterrupted`, and `failImplementation`
   * — so the next change to how a suspension announces itself is one edit.
   *
   * `rule` overrides the table for the one suspension that says more than
   * "stopped": an implementation out of repair turns raises a failure carrying
   * why, rather than the generic blocker.
   */
  const suspendInPlace = (
    tx: Transaction,
    row: JobRow,
    input: {
      body: string | null
      rule?: AttentionRule
      suspension: JobSuspension
    },
    now: Date,
    events: DomainEvent[],
  ): Job => {
    tx.update(jobs)
      .set({ suspension: input.suspension, updatedAt: now })
      .where(eq(jobs.id, row.id))
      .run()

    const rule = input.rule ?? suspensionAttention[input.suspension]
    if (rule !== undefined) {
      raiseItem(
        tx,
        openItemsOfKinds(tx, row.id, [rule.kind]),
        { body: input.body, jobId: row.id, rule },
        now,
        events,
      )
    }

    const job = toJob({ ...row, suspension: input.suspension, updatedAt: now })
    events.push(jobChanged(job))
    return job
  }

  /** Keeps the inbox honest about a job that has just moved. */
  const syncLifecycleAttention = (
    tx: Transaction,
    job: JobRow,
    now: Date,
    events: DomainEvent[],
  ): void => {
    const rule = attentionOnEnter[job.state]

    if (isTerminalJobState(job.state)) {
      const everythingOpen = tx
        .select()
        .from(attentionItems)
        .where(
          and(
            eq(attentionItems.jobId, job.id),
            isNull(attentionItems.resolvedAt),
          ),
        )
        .all()
      resolveItems(tx, everythingOpen, now, events)
      return
    }

    const open = openItemsOfKinds(tx, job.id, lifecycleKinds)
    resolveItems(
      tx,
      open.filter((item) => item.kind !== rule?.kind),
      now,
      events,
    )

    if (rule !== undefined) {
      raiseItem(tx, open, { body: null, jobId: job.id, rule }, now, events)
    }
  }

  const readRepository = (
    executor: Executor,
    repositoryId: string,
  ): RepositoryRow => {
    const row = executor
      .select()
      .from(repositories)
      .where(eq(repositories.id, repositoryId))
      .get()

    if (row === undefined) {
      throw repositoryNotFound(repositoryId)
    }

    return row
  }

  /** Both creation paths land here, so a job is only ever born one way. */
  const insertJob = (
    tx: Transaction,
    row: JobRow,
    events: DomainEvent[],
  ): Job => {
    tx.insert(jobs).values(row).run()
    const job = toJob(row)
    events.push(jobChanged(job))
    return job
  }

  /**
   * One move, inside a transaction someone else opened. Separate from
   * `transitionJob` so an operation with writes of its own — approval, a change
   * request, restart reconciliation — can do them and move the job together,
   * and still be refused by the same guards a bare transition is.
   */
  const applyTransition = (
    tx: Transaction,
    input: TransitionJobInput,
    now: Date,
    events: DomainEvent[],
  ): Job => {
    const current = readJob(tx, input.jobId)

    if (
      input.expectedState !== undefined &&
      input.expectedState !== current.state
    ) {
      throw stateConflict(input.expectedState)
    }

    if (!canTransition(current.state, input.to)) {
      throw illegalTransition(current.state, input.to)
    }

    transitionGuards[input.to]?.(tx, current)

    // Guarded so a move applies only to the state it was decided against.
    const updated = tx
      .update(jobs)
      .set({ state: input.to, updatedAt: now })
      .where(and(eq(jobs.id, input.jobId), eq(jobs.state, current.state)))
      .run()

    if (updated.changes === 0) {
      throw stateConflict(current.state)
    }

    tx.insert(jobTransitions)
      .values({
        id: newId(),
        jobId: input.jobId,
        fromState: current.state,
        toState: input.to,
        actor: input.actor,
        reason: input.reason ?? null,
        occurredAt: now,
      })
      .run()

    const next: JobRow = { ...current, state: input.to, updatedAt: now }
    syncLifecycleAttention(tx, next, now, events)

    const job = toJob(next)
    events.push(jobChanged(job))
    return job
  }

  /**
   * The job's newest plan revision, which is the only one the Handler may
   * answer: approving or re-opening an older one would decide against a plan
   * that has already been superseded.
   */
  const readNewestPlan = (
    executor: Executor,
    jobId: string,
  ): PlanRow | undefined =>
    executor
      .select()
      .from(planVersions)
      .where(eq(planVersions.jobId, jobId))
      .orderBy(desc(planVersions.revision))
      .limit(1)
      .get()

  const readLatestPlanVersion = (
    tx: Transaction,
    jobId: string,
    planVersionId: string,
  ): PlanRow => {
    const row = readNewestPlan(tx, jobId)

    if (row === undefined || row.id !== planVersionId) {
      throw planVersionNotFound(planVersionId)
    }

    return row
  }

  const readActiveRunbook = (executor: Executor): RunbookVersionRow => {
    const row = executor
      .select()
      .from(runbookVersions)
      .orderBy(desc(runbookVersions.version))
      .limit(1)
      .get()

    if (row === undefined) {
      throw runbookVersionNotFound()
    }

    return row
  }

  /**
   * Stopped and put back in the queue, in that order: suspending first means
   * the move that follows reads a job that is already stopped, so it announces
   * the stop once rather than twice and never offers the scheduler a startable
   * job on its way past.
   *
   * Both halves are the point. `planning` is not a state the scheduler starts
   * from, so a job left there once its pass has ended holds a slot that nothing
   * is running in — and lifting the suspension later would give that slot to
   * nobody rather than give it back.
   */
  const stopAndRequeue = (
    tx: Transaction,
    row: JobRow,
    input: { body: string | null; reason: string; suspension: JobSuspension },
    now: Date,
    events: DomainEvent[],
  ): Job => {
    tx.update(jobs)
      .set({ suspension: input.suspension, updatedAt: now })
      .where(eq(jobs.id, row.id))
      .run()

    const rule = suspensionAttention[input.suspension]
    if (rule !== undefined) {
      raiseItem(
        tx,
        openItemsOfKinds(tx, row.id, [rule.kind]),
        { body: input.body, jobId: row.id, rule },
        now,
        events,
      )
    }

    return applyTransition(
      tx,
      { actor: 'system', jobId: row.id, reason: input.reason, to: 'queued' },
      now,
      events,
    )
  }

  /**
   * Runs the unit of work, then publishes. Nothing reaches a subscriber until
   * SQLite has committed, so a rolled-back transaction emits nothing.
   */
  const commit = <Result>(
    work: (tx: Transaction, events: DomainEvent[], now: Date) => Result,
  ): Result => {
    const events: DomainEvent[] = []
    const now = clock()
    const result = database.transaction((tx) => work(tx, events, now))

    for (const event of events) {
      broadcaster.publish(event)
    }

    return result
  }

  return {
    createJob(input) {
      return commit((tx, events, now) => {
        const row: JobRow = {
          id: newId(),
          source: input.source,
          title: input.title,
          workClass: input.workClass,
          state: 'intake',
          suspension: null,
          linearIssueKey: input.linearIssueKey ?? null,
          // Never linked: `CreateJob` cannot carry an issue id, so this path
          // can neither collide with an intake job nor skip ADR 0004's suffix.
          linearIssueId: null,
          linearIssueUrl: null,
          canonicalBranch: input.canonicalBranch ?? null,
          // The recovery path names no repository for the same reason it names
          // no issue id: a job it minted can never be dispatched.
          repositoryId: null,
          baseBranch: input.baseBranch,
          queuePriority: null,
          worktreePath: null,
          codexSessionId: null,
          originalPrUrl: null,
          createdAt: now,
          updatedAt: now,
        }

        return insertJob(tx, row, events)
      })
    },

    /**
     * The claim. Everything here is one transaction because the three questions
     * it answers — which round this Job is, whether the name is free, and
     * whether this Job may move — are one question asked of the same rows, and
     * answering them separately is what lets two dispatches both win.
     */
    claimForDispatch(input) {
      return commit((tx, events, now) => {
        const current = readJob(tx, input.jobId)

        if (current.repositoryId === null) throw dispatchNeedsRepository()
        if (current.linearIssueId === null) throw dispatchNeedsLinearIssue()

        if (!canTransition(current.state, 'queued')) {
          throw illegalTransition(current.state, 'queued')
        }

        const repository = readRepository(tx, current.repositoryId)

        // ADR 0004: the round is this Job's position among every Job the issue
        // has ever had, settled ones included. Read rather than taken from
        // Intake, because another Job for the same issue may have started in
        // between.
        //
        // Counted by rowid rather than by `created_at`, which is stored to the
        // millisecond: two Jobs taken in the same tick tie, and a tie broken by
        // a random uuid is not the order they were created in. Insertion order
        // is the thing being asked about, and rowid is what records it.
        const round =
          tx
            .select({ value: count() })
            .from(jobs)
            .where(
              and(
                eq(jobs.linearIssueId, current.linearIssueId),
                sql`rowid <= (select rowid from ${jobs} where ${jobs.id} = ${current.id})`,
              ),
            )
            .get()?.value ?? 1

        const canonicalBranch = canonicalBranchForRound(input.branchName, round)

        // The unique index is the backstop; this is the typed answer. Asked of
        // live Jobs only, for the same reason the index excludes settled ones.
        const held = tx
          .select({ id: jobs.id, state: jobs.state })
          .from(jobs)
          .where(
            and(
              eq(jobs.repositoryId, current.repositoryId),
              eq(jobs.canonicalBranch, canonicalBranch),
              ne(jobs.id, current.id),
            ),
          )
          .all()
          // Agrees with `jobs_claimed_canonical_branch_unique`: a Job still in
          // intake is holding a provisional name, not a claim.
          .find(
            (row) => row.state !== 'intake' && !isSettledJobState(row.state),
          )

        if (held !== undefined) {
          throw canonicalBranchClaimed(canonicalBranch)
        }

        const updated = tx
          .update(jobs)
          .set({ canonicalBranch, state: 'queued', updatedAt: now })
          .where(and(eq(jobs.id, current.id), eq(jobs.state, current.state)))
          .run()

        if (updated.changes === 0) {
          throw stateConflict(current.state)
        }

        tx.insert(jobTransitions)
          .values({
            id: newId(),
            jobId: current.id,
            fromState: current.state,
            toState: 'queued',
            actor: 'handler',
            reason: 'Dispatched',
            occurredAt: now,
          })
          .run()

        const next: JobRow = {
          ...current,
          canonicalBranch,
          state: 'queued',
          updatedAt: now,
        }
        syncLifecycleAttention(tx, next, now, events)

        const job = toJob(next)
        events.push(jobChanged(job))
        return { job, repository: toRepository(repository) }
      })
    },

    reorderQueue(jobIds) {
      return commit((tx, events, now) => {
        const queued = tx
          .select()
          .from(jobs)
          .where(eq(jobs.state, 'queued'))
          .all()

        const byId = new Map(queued.map((row) => [row.id, row]))
        for (const jobId of jobIds) {
          if (!byId.has(jobId)) {
            // Either it is not there or it is not waiting for a slot. Both are
            // the same answer to the Handler: this list is no longer the queue.
            readJob(tx, jobId)
            throw transitionGuardFailed(
              `Job ${jobId} is not in the queue, so it cannot be given a position`,
            )
          }
        }

        // Cleared first, so a job dropped from the list loses its position
        // rather than keeping a stale one that would jump the ordered ones.
        const positions = new Map(
          jobIds.map((jobId, index) => [jobId, index + 1]),
        )

        const reordered: Job[] = []
        for (const row of queued) {
          const queuePriority = positions.get(row.id) ?? null
          const changed = row.queuePriority !== queuePriority

          if (changed) {
            tx.update(jobs)
              .set({ queuePriority, updatedAt: now })
              .where(eq(jobs.id, row.id))
              .run()
          }

          const job = toJob({
            ...row,
            queuePriority,
            updatedAt: changed ? now : row.updatedAt,
          })
          // Announced only when it moved, so a no-op reorder is silent on the
          // event stream rather than invalidating every list in the dashboard.
          if (changed) events.push(jobChanged(job))
          reordered.push(job)
        }

        return orderQueue(reordered)
      })
    },

    recordWorktree(input) {
      return commit((tx, events, now) => {
        const current = readJob(tx, input.jobId)

        tx.update(jobs)
          .set({ worktreePath: input.worktreePath, updatedAt: now })
          .where(eq(jobs.id, input.jobId))
          .run()

        const job = toJob({
          ...current,
          worktreePath: input.worktreePath,
          updatedAt: now,
        })
        events.push(jobChanged(job))
        return job
      })
    },

    /**
     * Git failed after the claim committed, so the claim is given back: the Job
     * returns to intake and releases its branch, and the Handler is told why
     * rather than finding a queued job with no worktree.
     */
    abandonDispatch(input) {
      return commit((tx, events, now) => {
        const current = readJob(tx, input.jobId)

        tx.update(jobs)
          .set({ canonicalBranch: null, state: 'intake', updatedAt: now })
          .where(eq(jobs.id, input.jobId))
          .run()

        tx.insert(jobTransitions)
          .values({
            id: newId(),
            jobId: input.jobId,
            fromState: current.state,
            toState: 'intake',
            actor: 'system',
            reason: input.reason,
            occurredAt: now,
          })
          .run()

        const next: JobRow = {
          ...current,
          canonicalBranch: null,
          state: 'intake',
          updatedAt: now,
        }

        raiseItem(
          tx,
          openItemsOfKinds(tx, input.jobId, ['failure']),
          {
            body: input.reason,
            jobId: input.jobId,
            rule: {
              kind: 'failure',
              title: 'Dispatch could not cut a worktree',
            },
          },
          now,
          events,
        )

        const job = toJob(next)
        events.push(jobChanged(job))
        return job
      })
    },

    createPlanVersion(input) {
      return commit((tx, events, now) => {
        const job = readJob(tx, input.jobId)

        // Revisions are numbered per job and every one is kept, so the next one
        // is read from the highest rather than assumed from whatever the caller
        // last saw.
        const highest =
          tx
            .select({ value: max(planVersions.revision) })
            .from(planVersions)
            .where(eq(planVersions.jobId, input.jobId))
            .get()?.value ?? 0
        const revision = highest + 1

        // Checked here as well as where it arrived, because this is the write
        // that makes the column's promise: everything read back out of it is a
        // plan, without the reader having to ask.
        assertPlanContent(input.content)

        const row: PlanRow = {
          id: newId(),
          jobId: input.jobId,
          revision,
          content: JSON.stringify(input.content),
          feedback: null,
          approvalState: 'pending',
          approvedAt: null,
          createdAt: now,
        }

        tx.insert(planVersions).values(row).run()
        events.push(jobChanged(toJob(job)))
        // The content is already in hand and already checked, so it is handed
        // back rather than serialised and parsed again to get where it was.
        return { ...toPlanVersion(row), content: input.content }
      })
    },

    approvePlan(input) {
      return commit((tx, events, now) => {
        readJob(tx, input.jobId)
        const version = readLatestPlanVersion(
          tx,
          input.jobId,
          input.planVersionId,
        )

        tx.update(planVersions)
          .set({ approvalState: 'approved', approvedAt: now })
          .where(eq(planVersions.id, version.id))
          .run()

        // The text is copied, not referenced: a job has to be able to say what
        // it executed even after the Handler has rewritten settings. The id
        // rides along so two jobs can still be recognised as having run the
        // same procedure.
        const runbook = readActiveRunbook(tx)
        tx.insert(runbookSnapshots)
          .values({
            id: newId(),
            jobId: input.jobId,
            runbookVersionId: runbook.id,
            content: runbook.content,
            createdAt: now,
          })
          .run()

        return applyTransition(
          tx,
          {
            actor: 'handler',
            expectedState: input.expectedState,
            jobId: input.jobId,
            reason: `Approved plan revision ${version.revision}`,
            to: 'approved',
          },
          now,
          events,
        )
      })
    },

    requestPlanChanges(input) {
      return commit((tx, events, now) => {
        const job = readJob(tx, input.jobId)
        const version = readLatestPlanVersion(
          tx,
          input.jobId,
          input.planVersionId,
        )

        // The revision is answered in the session that produced it, so the
        // planner reads the feedback as the next turn rather than as a fresh
        // brief. Refused here rather than left for the pass to discover,
        // because the Handler is still on the page and can be told.
        if (job.codexSessionId === null) {
          throw codexSessionMissing(input.jobId)
        }

        tx.update(planVersions)
          .set({ approvalState: 'changesRequested', feedback: input.feedback })
          .where(eq(planVersions.id, version.id))
          .run()

        // Back to the queue rather than straight back into planning: the slot
        // is the scheduler's to grant, and a job that walked into `planning`
        // on its own would hold one with nothing running in it.
        return applyTransition(
          tx,
          {
            actor: 'handler',
            expectedState: input.expectedState,
            jobId: input.jobId,
            reason: `Changes requested on plan revision ${version.revision}`,
            to: 'queued',
          },
          now,
          events,
        )
      })
    },

    createRunbookVersion(input) {
      return commit((tx, _events, now) => {
        const highest =
          tx
            .select({ value: max(runbookVersions.version) })
            .from(runbookVersions)
            .get()?.value ?? 0

        const row: RunbookVersionRow = {
          id: newId(),
          version: highest + 1,
          content: input.content,
          createdAt: now,
        }

        tx.insert(runbookVersions).values(row).run()
        return toRunbookVersion(row)
      })
    },

    listRunbookVersions() {
      return database
        .select()
        .from(runbookVersions)
        .orderBy(desc(runbookVersions.version))
        .all()
        .map(toRunbookVersion)
    },

    activeRunbook() {
      return toRunbookVersion(readActiveRunbook(database))
    },

    markInterrupted() {
      return commit((tx, events, now) => {
        // Any turn the database still calls open ended when this process did.
        tx.update(implementationAttempts)
          .set({ endedAt: now, outcome: 'interrupted' })
          .where(isNull(implementationAttempts.endedAt))
          .run()

        const planning = tx
          .select()
          .from(jobs)
          .where(and(eq(jobs.state, 'planning'), isNull(jobs.suspension)))
          .all()

        const implementing = tx
          .select()
          .from(jobs)
          .where(and(eq(jobs.state, 'implementing'), isNull(jobs.suspension)))
          .all()

        const requeued = planning.map((row) =>
          stopAndRequeue(
            tx,
            row,
            {
              body: null,
              reason: 'Interrupted by a restart',
              suspension: 'interrupted',
            },
            now,
            events,
          ),
        )

        const held = implementing.map((row) =>
          suspendInPlace(
            tx,
            row,
            { body: null, suspension: 'interrupted' },
            now,
            events,
          ),
        )

        return [...requeued, ...held]
      })
    },

    startAttempt(input) {
      return commit((tx, events, now) => {
        const job = readJob(tx, input.jobId)

        const existing = tx
          .select()
          .from(implementationAttempts)
          .where(eq(implementationAttempts.jobId, input.jobId))
          .orderBy(
            asc(implementationAttempts.round),
            asc(implementationAttempts.attempt),
          )
          .all()

        const last = existing.at(-1)

        // An open row means the turn it stands for was never closed, and the
        // rule below would read that as "not repairable" and open a new round
        // — a fresh budget, every time, for as long as the fault lasts. Refused
        // here rather than guarded in the scheduler, because this is the write
        // that would make it unbounded.
        if (last !== undefined && last.outcome === null) {
          throw transitionGuardFailed(
            `Job ${input.jobId} still has an open implementation attempt`,
          )
        }

        // 0 before the first turn, so the `openRound + 1` below opens round 1
        // without a second arm saying so.
        const openRound = last?.round ?? 0
        const takenInRound = existing.filter(
          (row) => row.round === openRound,
        ).length

        // The rule that makes a resume a fresh budget without a column saying
        // so: a turn Handella may answer by itself continues the round, and
        // anything else can only have been reached by the Handler resuming.
        const continues =
          last !== undefined &&
          takenInRound < maxImplementationAttempts &&
          last.outcome !== null &&
          isRepairable(last.outcome)

        const id = newId()
        const row: AttemptRow = {
          id,
          jobId: input.jobId,
          round: continues ? openRound : openRound + 1,
          attempt: continues ? last.attempt + 1 : 1,
          codexSessionId: input.sessionId,
          startedAt: now,
          endedAt: null,
          outcome: null,
          report: null,
          failureReason: null,
          logPath: attemptLogPathFor(input.logRoot, input.jobId, id),
        }

        tx.insert(implementationAttempts).values(row).run()
        events.push(jobChanged(toJob(job)))
        return toAttempt(row)
      })
    },

    finishAttempt(input) {
      return commit((tx, events, now) => {
        const current = tx
          .select()
          .from(implementationAttempts)
          .where(eq(implementationAttempts.id, input.attemptId))
          .get()

        if (current === undefined) throw attemptNotFound(input.attemptId)

        // Written once and returned from the same object, so the row that
        // comes back cannot drift from the row that was stored.
        const ending = {
          endedAt: current.endedAt ?? now,
          failureReason: input.failureReason,
          outcome: input.outcome,
          report: input.report === null ? null : JSON.stringify(input.report),
        }

        tx.update(implementationAttempts)
          .set(ending)
          .where(eq(implementationAttempts.id, input.attemptId))
          .run()

        // The turn's end is a change to the job as far as a dashboard is
        // concerned, and nothing else announces it.
        const attempt = toAttempt({ ...current, ...ending })
        events.push(jobChanged(toJob(readJob(tx, current.jobId))))
        return attempt
      })
    },

    recordMilestone(input) {
      return commit((tx, _events, now) => {
        // Position within the turn, read rather than counted by the caller: a
        // pass that restarted its stream would otherwise collide on `seq`.
        // Sought on the unique index rather than counted, because this runs
        // once per beat and counting walks every beat before it.
        const highest =
          tx
            .select({ value: max(milestones.seq) })
            .from(milestones)
            .where(eq(milestones.attemptId, input.attemptId))
            .get()?.value ?? null

        const row: MilestoneRow = {
          id: newId(),
          jobId: input.jobId,
          attemptId: input.attemptId,
          seq: highest === null ? 0 : highest + 1,
          kind: input.kind,
          summary: input.summary,
          detail: input.detail,
          exitCode: input.exitCode,
          occurredAt: now,
        }

        tx.insert(milestones).values(row).run()
        return toMilestone(row)
      })
    },

    listAttempts(jobId) {
      return database
        .select()
        .from(implementationAttempts)
        .where(eq(implementationAttempts.jobId, jobId))
        .orderBy(
          asc(implementationAttempts.round),
          asc(implementationAttempts.attempt),
        )
        .all()
        .map(toAttempt)
    },

    latestAttempt(jobId) {
      const row = database
        .select()
        .from(implementationAttempts)
        .where(eq(implementationAttempts.jobId, jobId))
        .orderBy(
          desc(implementationAttempts.round),
          desc(implementationAttempts.attempt),
        )
        .limit(1)
        .get()

      return row === undefined ? undefined : toAttempt(row)
    },

    listMilestones(jobId) {
      return database
        .select()
        .from(milestones)
        .where(eq(milestones.jobId, jobId))
        .orderBy(asc(milestones.occurredAt), asc(milestones.seq))
        .all()
        .map(toMilestone)
    },

    attemptLogPath(input) {
      // The job is asked about as well as the attempt, so a path cannot be
      // reached through a job it does not belong to.
      const row = database
        .select({ logPath: implementationAttempts.logPath })
        .from(implementationAttempts)
        .where(
          and(
            eq(implementationAttempts.id, input.attemptId),
            eq(implementationAttempts.jobId, input.jobId),
          ),
        )
        .get()

      if (row === undefined) throw attemptNotFound(input.attemptId)
      return row.logPath
    },

    openPullRequest(input) {
      return commit((tx, events, now) => {
        // Written before the move, so the transition reads a job that already
        // carries its pull request and announces both at once.
        tx.update(jobs)
          .set({ originalPrUrl: input.url, updatedAt: now })
          .where(eq(jobs.id, input.jobId))
          .run()

        return applyTransition(
          tx,
          {
            actor: 'system',
            expectedState: 'implementing',
            jobId: input.jobId,
            reason: 'The pull request is open and ready for review',
            to: 'prOpen',
          },
          now,
          events,
        )
      })
    },

    failImplementation(input) {
      return commit((tx, events, now) =>
        suspendInPlace(
          tx,
          readJob(tx, input.jobId),
          {
            body: input.body,
            rule: implementationFailure,
            suspension: 'stoppedBySystem',
          },
          now,
          events,
        ),
      )
    },

    abandonPlanningPass(input) {
      return commit((tx, events, now) => {
        const current = readJob(tx, input.jobId)

        // The pass no longer speaks for this job: something else has moved it
        // already, and wherever it moved it to is more current than this.
        if (current.state !== 'planning') return toJob(current)

        // A job the Handler stopped keeps their suspension and their reason —
        // it was their stop that ended the pass, and overwriting it would
        // report the consequence and lose the cause. It is re-queued on the
        // same terms, because the slot is no less idle for the reason.
        if (current.suspension !== null) {
          return applyTransition(
            tx,
            {
              actor: 'system',
              jobId: input.jobId,
              reason: 'Returned to the queue after a planning pass was stopped',
              to: 'queued',
            },
            now,
            events,
          )
        }

        return stopAndRequeue(
          tx,
          current,
          {
            body: input.reason,
            reason: 'Returned to the queue after a planning pass failed',
            suspension: 'stoppedBySystem',
          },
          now,
          events,
        )
      })
    },

    recordCodexSession(input) {
      return commit((tx, events, now) => {
        const current = readJob(tx, input.jobId)

        tx.update(jobs)
          .set({ codexSessionId: input.sessionId, updatedAt: now })
          .where(eq(jobs.id, input.jobId))
          .run()

        const job = toJob({
          ...current,
          codexSessionId: input.sessionId,
          updatedAt: now,
        })
        events.push(jobChanged(job))
        return job
      })
    },

    createRepository(input) {
      return commit((tx, _events, now) => {
        const row: RepositoryRow = {
          id: newId(),
          name: input.name,
          path: input.path,
          defaultBaseBranch: input.defaultBaseBranch,
          createdAt: now,
          updatedAt: now,
        }

        tx.insert(repositories).values(row).run()
        return toRepository(row)
      })
    },

    listRepositories() {
      return database
        .select()
        .from(repositories)
        .orderBy(asc(repositories.name))
        .all()
        .map(toRepository)
    },

    getRepository(repositoryId) {
      return toRepository(readRepository(database, repositoryId))
    },

    updateRepository(repositoryId, input) {
      return commit((tx, _events, now) => {
        const current = readRepository(tx, repositoryId)
        const next: RepositoryRow = {
          ...current,
          name: input.name ?? current.name,
          path: input.path ?? current.path,
          defaultBaseBranch:
            input.defaultBaseBranch ?? current.defaultBaseBranch,
          updatedAt: now,
        }

        tx.update(repositories)
          .set({
            name: next.name,
            path: next.path,
            defaultBaseBranch: next.defaultBaseBranch,
            updatedAt: next.updatedAt,
          })
          .where(eq(repositories.id, repositoryId))
          .run()

        return toRepository(next)
      })
    },

    /**
     * A settled job keeps its history and lets the repository go — the foreign
     * key nulls its column. A live job is still working in a worktree cut from
     * this checkout, so the delete is refused rather than stranding it.
     */
    deleteRepository(repositoryId) {
      commit((tx) => {
        readRepository(tx, repositoryId)

        const live = tx
          .select({ id: jobs.id })
          .from(jobs)
          .where(
            and(
              eq(jobs.repositoryId, repositoryId),
              notInArray(jobs.state, [...settledJobStates]),
            ),
          )
          .limit(1)
          .get()

        if (live !== undefined) {
          throw repositoryInUse(repositoryId, live.id)
        }

        tx.delete(repositories).where(eq(repositories.id, repositoryId)).run()
      })
    },

    createJobForLinearIssue(input) {
      return commit((tx, events, now) => {
        const { issue } = input

        // Read inside the unit of work so a repository removed mid-intake is a
        // typed 404 rather than a foreign key violation surfacing as a 500.
        readRepository(tx, input.repositoryId)

        // Every job this issue has ever had, read once: the live holder and
        // the round are two questions about the same rows, and answering them
        // with two queries is what lets the branch intake shows drift from the
        // branch intake writes. `describeIssuesForIntake` reads them the same
        // way, so the two paths agree by construction.
        //
        // Keyed on the id rather than the identifier or the branch, because
        // Linear rewrites both when an issue is retitled or moved team, and a
        // job that cannot be found is a job that gets created twice.
        const priorJobs = tx
          .select({ id: jobs.id, state: jobs.state })
          .from(jobs)
          .where(eq(jobs.linearIssueId, issue.id))
          .all()

        // One live job per Linear issue.
        const existing = priorJobs.find((row) => !isSettledJobState(row.state))
        if (existing !== undefined) {
          throw linearIssueAlreadyLinked(issue.identifier, existing.id)
        }

        // An issue can be worked more than once: round one merges, the issue
        // is reopened, and the Handler takes it again. Each job owns its own
        // branch, so the second and later ones carry a suffix. Settled jobs
        // are counted too, so a name is never reused after a cancellation.
        const round = priorJobs.length + 1

        // Provisional until Dispatch. ADR 0004 has the name computed here so
        // the Handler sees it before committing, and computed again when the
        // branch is claimed, because another job for this issue may start in
        // between; Dispatch is what fixes it.
        const canonicalBranch = canonicalBranchForRound(issue.branchName, round)

        const row: JobRow = {
          id: newId(),
          source: input.source,
          title: issue.title,
          workClass: input.workClass,
          state: 'intake',
          suspension: null,
          linearIssueKey: issue.identifier,
          linearIssueId: issue.id,
          linearIssueUrl: issue.url,
          canonicalBranch,
          repositoryId: input.repositoryId,
          baseBranch: input.baseBranch,
          queuePriority: null,
          worktreePath: null,
          codexSessionId: null,
          originalPrUrl: null,
          createdAt: now,
          updatedAt: now,
        }

        return insertJob(tx, row, events)
      })
    },

    /**
     * Answers both questions intake asks about an issue it is about to offer,
     * in one read: whether a live job already holds it, and which round the
     * next job for it would be. Here rather than in the dashboard, so the ADR
     * 0004 rule is applied where the jobs are and never re-derived from
     * whatever list a browser happens to be holding.
     */
    describeIssuesForIntake(issueIds) {
      const facts = new Map(
        issueIds.map((issueId) => [
          issueId,
          { heldByJobId: null, nextRound: 1 } as IssueIntakeFacts,
        ]),
      )

      if (issueIds.length === 0) {
        return facts
      }

      const rows = database
        .select({
          id: jobs.id,
          linearIssueId: jobs.linearIssueId,
          state: jobs.state,
        })
        .from(jobs)
        .where(inArray(jobs.linearIssueId, [...issueIds]))
        .all()

      for (const row of rows) {
        const known =
          row.linearIssueId === null ? undefined : facts.get(row.linearIssueId)
        if (known === undefined) {
          continue
        }

        known.nextRound += 1
        if (!isSettledJobState(row.state)) {
          known.heldByJobId = row.id
        }
      }

      return facts
    },

    /**
     * The fallback for a job with no repository chosen yet: what this
     * installation has actually used, since there is no remote to ask. Intake
     * prefers the remote's branches when it has one (`routes/intake.ts`). The
     * default is reported on its own field and excluded in SQL rather than
     * after the limit, so asking for ten suggestions never answers with nine.
     */
    listBaseBranchSuggestions(options) {
      const rows = database
        .select({ baseBranch: jobs.baseBranch })
        .from(jobs)
        .where(ne(jobs.baseBranch, defaultBaseBranch))
        .groupBy(jobs.baseBranch)
        .orderBy(desc(max(jobs.createdAt)))
        .limit(options?.limit ?? 10)
        .all()

      return {
        defaultBranch: defaultBaseBranch,
        recent: rows.map((row) => row.baseBranch),
      }
    },

    getJob(jobId) {
      return toJob(readJob(database, jobId))
    },

    listJobs() {
      return database
        .select()
        .from(jobs)
        .orderBy(desc(jobs.createdAt))
        .all()
        .map(toJob)
    },

    listJobTransitions: listForJob(
      jobTransitions,
      asc(jobTransitions.occurredAt),
      toTransition,
    ),

    listPlanVersions: listForJob(
      planVersions,
      asc(planVersions.revision),
      toPlanVersion,
    ),

    latestPlanVersion(jobId) {
      const row = readNewestPlan(database, jobId)
      return row === undefined ? undefined : toPlanVersion(row)
    },

    listRunbookSnapshots: listForJob(
      runbookSnapshots,
      asc(runbookSnapshots.createdAt),
      toRunbookSnapshot,
    ),

    latestRunbookSnapshot(jobId) {
      const row = database
        .select()
        .from(runbookSnapshots)
        .where(eq(runbookSnapshots.jobId, jobId))
        .orderBy(desc(runbookSnapshots.createdAt))
        .limit(1)
        .get()

      return row === undefined ? undefined : toRunbookSnapshot(row)
    },

    listReviewRounds: listForJob(
      reviewRounds,
      asc(reviewRounds.roundNumber),
      toReviewRound,
    ),

    transitionJob(input) {
      return commit((tx, events, now) =>
        applyTransition(tx, input, now, events),
      )
    },

    suspendJob(input) {
      return commit((tx, events, now) => {
        const current = readJob(tx, input.jobId)

        // A job that has reached the end of its life is not stopped, it is
        // over. Suspending one would also reopen an inbox that reaching the
        // terminal state just emptied.
        if (isTerminalJobState(current.state)) {
          throw suspensionNotAllowed(current.state)
        }

        return suspendInPlace(
          tx,
          current,
          { body: input.reason ?? null, suspension: input.suspension },
          now,
          events,
        )
      })
    },

    resumeJob(jobId) {
      return commit((tx, events, now) => {
        const current = readJob(tx, jobId)

        tx.update(jobs)
          .set({ suspension: null, updatedAt: now })
          .where(eq(jobs.id, jobId))
          .run()

        resolveItems(
          tx,
          openItemsOfKinds(tx, jobId, resumableKinds),
          now,
          events,
        )

        const job = toJob({ ...current, suspension: null, updatedAt: now })
        events.push(jobChanged(job))
        return job
      })
    },

    listAttentionItems(listOptions) {
      return database
        .select()
        .from(attentionItems)
        .where(
          listOptions?.includeResolved === true
            ? undefined
            : isNull(attentionItems.resolvedAt),
        )
        .orderBy(desc(attentionItems.createdAt))
        .all()
        .map(toAttentionItem)
    },

    resolveAttentionItem(attentionItemId) {
      return commit((tx, events, now) => {
        const row = tx
          .select()
          .from(attentionItems)
          .where(eq(attentionItems.id, attentionItemId))
          .get()

        if (row === undefined) {
          throw attentionItemNotFound(attentionItemId)
        }

        if (row.resolvedAt !== null) {
          return toAttentionItem(row)
        }

        tx.update(attentionItems)
          .set({ resolvedAt: now })
          .where(eq(attentionItems.id, attentionItemId))
          .run()

        const item = toAttentionItem({ ...row, resolvedAt: now })
        events.push(attentionChanged(item))
        return item
      })
    },
  }
}
