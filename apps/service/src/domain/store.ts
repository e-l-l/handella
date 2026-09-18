import { randomUUID } from 'node:crypto'

import {
  canTransition,
  canonicalBranchForRound,
  defaultBaseBranch,
  isSettledJobState,
  isTerminalJobState,
  settledJobStates,
  orderQueue,
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
  type CreateRepository,
  type PlanVersion,
  type Repository,
  type ReviewRound,
  type RunbookSnapshot,
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
  attentionItemNotFound,
  canonicalBranchClaimed,
  dispatchNeedsLinearIssue,
  dispatchNeedsRepository,
  illegalTransition,
  jobNotFound,
  linearIssueAlreadyLinked,
  repositoryInUse,
  repositoryNotFound,
  stateConflict,
  suspensionNotAllowed,
  transitionGuardFailed,
} from './errors.js'
import {
  attentionItems,
  jobTransitions,
  jobs,
  planVersions,
  repositories,
  reviewRounds,
  runbookSnapshots,
} from '../database/schema.js'

type JobRow = typeof jobs.$inferSelect
type RepositoryRow = typeof repositories.$inferSelect
type AttentionRow = typeof attentionItems.$inferSelect
type TransitionRow = typeof jobTransitions.$inferSelect
type PlanRow = typeof planVersions.$inferSelect
type RunbookRow = typeof runbookSnapshots.$inferSelect
type ReviewRow = typeof reviewRounds.$inferSelect
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

export interface Store {
  /** The compensating write: git failed, so the claim is given back. */
  abandonDispatch(input: { jobId: string; reason: string }): Job
  claimForDispatch(input: ClaimForDispatchInput): DispatchClaim
  createJob(input: CreateJob): Job
  /** Phase 5 owns the content's shape; this only keeps the revisions in order. */
  createPlanVersion(input: { content: string; jobId: string }): PlanVersion
  createRepository(input: CreateRepository): Repository
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
  listReviewRounds(jobId: string): ReviewRound[]
  listRunbookSnapshots(jobId: string): RunbookSnapshot[]
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
const suspensionKinds = kindsOf(suspensionAttention)

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
  content: row.content,
  feedback: row.feedback ?? null,
  approvalState: row.approvalState,
  approvedAt: row.approvedAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
})

const toRunbookSnapshot = (row: RunbookRow): RunbookSnapshot => ({
  id: row.id,
  jobId: row.jobId,
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

        const row: PlanRow = {
          id: newId(),
          jobId: input.jobId,
          revision,
          content: input.content,
          feedback: null,
          approvalState: 'pending',
          approvedAt: null,
          createdAt: now,
        }

        tx.insert(planVersions).values(row).run()
        events.push(jobChanged(toJob(job)))
        return toPlanVersion(row)
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
     * Phase 4 owns Git, so until then the help on offer is what this
     * installation has actually used. The default is reported on its own field
     * and excluded in SQL rather than after the limit, so asking for ten
     * suggestions never answers with nine.
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

    listRunbookSnapshots: listForJob(
      runbookSnapshots,
      asc(runbookSnapshots.createdAt),
      toRunbookSnapshot,
    ),

    listReviewRounds: listForJob(
      reviewRounds,
      asc(reviewRounds.roundNumber),
      toReviewRound,
    ),

    transitionJob(input) {
      return commit((tx, events, now) => {
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

        // CONTEXT.md: the canonical branch is authoritative and a job cannot be
        // dispatched without it. Detecting that the branch is already owned by
        // an unknown job needs Git, and waits for Phase 4.
        if (input.to === 'queued' && current.canonicalBranch === null) {
          throw transitionGuardFailed(
            'A job cannot be queued until Linear has provided its canonical branch name',
          )
        }

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
      })
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

        tx.update(jobs)
          .set({ suspension: input.suspension, updatedAt: now })
          .where(eq(jobs.id, input.jobId))
          .run()

        const rule = suspensionAttention[input.suspension]
        if (rule !== undefined) {
          raiseItem(
            tx,
            openItemsOfKinds(tx, input.jobId, [rule.kind]),
            { body: input.reason ?? null, jobId: input.jobId, rule },
            now,
            events,
          )
        }

        const job = toJob({
          ...current,
          suspension: input.suspension,
          updatedAt: now,
        })
        events.push(jobChanged(job))
        return job
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
          openItemsOfKinds(tx, jobId, suspensionKinds),
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
