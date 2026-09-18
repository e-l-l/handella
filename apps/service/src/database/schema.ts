import {
  attentionItemKinds,
  jobSources,
  jobStates,
  jobSuspensions,
  planApprovalStates,
  settledJobStates,
  transitionActors,
  workClasses,
} from '@handella/contracts'
import { sql, type SQL } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core'

/**
 * Drizzle's `enum` option is a TypeScript-only narrowing and emits no
 * constraint, so every enumerated column also carries a CHECK built from the
 * same contracts tuple. A value can then never be legal in the database and
 * illegal on the wire, or the reverse.
 */
const oneOf = (column: AnySQLiteColumn, values: readonly string[]): SQL =>
  sql`${column} in (${sql.raw(values.map((value) => `'${value}'`).join(', '))})`

const nullOrOneOf = (column: AnySQLiteColumn, values: readonly string[]): SQL =>
  sql`${column} is null or ${oneOf(column, values)}`

export const appInstallation = sqliteTable(
  'app_installation',
  {
    singletonKey: integer('singleton_key').primaryKey().default(1),
    installationId: text('installation_id').notNull().unique(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    lastStartedAt: integer('last_started_at', {
      mode: 'timestamp_ms',
    }).notNull(),
  },
  (table) => [
    check(
      'app_installation_singleton_key_check',
      sql`${table.singletonKey} = 1`,
    ),
  ],
)

/**
 * The Linear columns and `canonical_branch` are nullable because a job can be
 * created without an issue: `POST /api/jobs` is the Handler's recovery path
 * when intake itself is unavailable, and such a job cannot be queued.
 *
 * `linear_issue_id` rather than `linear_issue_key` is what a job is looked up
 * by: Linear reassigns the identifier when an issue moves team.
 *
 * `state` and `suspension` are orthogonal. See
 * docs/adr/0003-orthogonal-job-state-and-suspension.md.
 */
export const jobs = sqliteTable(
  'jobs',
  {
    id: text('id').primaryKey(),
    source: text('source', { enum: jobSources }).notNull(),
    title: text('title').notNull(),
    workClass: text('work_class', { enum: workClasses }).notNull(),
    state: text('state', { enum: jobStates }).notNull(),
    suspension: text('suspension', { enum: jobSuspensions }),
    linearIssueKey: text('linear_issue_key'),
    linearIssueId: text('linear_issue_id'),
    linearIssueUrl: text('linear_issue_url'),
    canonicalBranch: text('canonical_branch'),
    baseBranch: text('base_branch').notNull(),
    queuePriority: integer('queue_priority'),
    worktreePath: text('worktree_path'),
    codexSessionId: text('codex_session_id'),
    originalPrUrl: text('original_pr_url'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    check('jobs_source_check', oneOf(table.source, jobSources)),
    check('jobs_work_class_check', oneOf(table.workClass, workClasses)),
    check('jobs_state_check', oneOf(table.state, jobStates)),
    check(
      'jobs_suspension_check',
      nullOrOneOf(table.suspension, jobSuspensions),
    ),
    /**
     * A Linear issue belongs to at most one job that is still alive. Partial
     * on two counts: a job may have no Linear issue at all, and a settled job
     * gives its issue back so the Handler can take it again after the issue
     * is reopened. The store checks the same thing first, so the Handler gets
     * a typed conflict rather than a constraint violation; this is only the
     * backstop.
     */
    uniqueIndex('jobs_live_linear_issue_id_unique')
      .on(table.linearIssueId)
      .where(
        sql`${table.linearIssueId} is not null and ${table.state} not in (${sql.raw(
          settledJobStates.map((state) => `'${state}'`).join(', '),
        )})`,
      ),
    index('jobs_state_suspension_idx').on(table.state, table.suspension),
    index('jobs_created_at_idx').on(table.createdAt),
    index('jobs_linear_issue_key_idx').on(table.linearIssueKey),
  ],
)

/** Append-only. The durable history behind a job, and the audit trail SSE is not. */
export const jobTransitions = sqliteTable(
  'job_transitions',
  {
    id: text('id').primaryKey(),
    jobId: text('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    fromState: text('from_state', { enum: jobStates }).notNull(),
    toState: text('to_state', { enum: jobStates }).notNull(),
    actor: text('actor', { enum: transitionActors }).notNull(),
    reason: text('reason'),
    occurredAt: integer('occurred_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    check(
      'job_transitions_from_state_check',
      oneOf(table.fromState, jobStates),
    ),
    check('job_transitions_to_state_check', oneOf(table.toState, jobStates)),
    check('job_transitions_actor_check', oneOf(table.actor, transitionActors)),
    index('job_transitions_job_id_occurred_at_idx').on(
      table.jobId,
      table.occurredAt,
    ),
  ],
)

/** `job_id` is nullable: not every decision the Handler owes belongs to a job. */
export const attentionItems = sqliteTable(
  'attention_items',
  {
    id: text('id').primaryKey(),
    jobId: text('job_id').references(() => jobs.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: attentionItemKinds }).notNull(),
    title: text('title').notNull(),
    body: text('body'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    resolvedAt: integer('resolved_at', { mode: 'timestamp_ms' }),
  },
  (table) => [
    check('attention_items_kind_check', oneOf(table.kind, attentionItemKinds)),
    index('attention_items_resolved_at_idx').on(
      table.resolvedAt,
      table.createdAt,
    ),
    index('attention_items_job_id_idx').on(table.jobId),
  ],
)

/** `content` holds the structured plan verbatim; Phase 5 owns its inner shape. */
export const planVersions = sqliteTable(
  'plan_versions',
  {
    id: text('id').primaryKey(),
    jobId: text('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    revision: integer('revision').notNull(),
    content: text('content').notNull(),
    feedback: text('feedback'),
    approvalState: text('approval_state', {
      enum: planApprovalStates,
    }).notNull(),
    approvedAt: integer('approved_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    check(
      'plan_versions_approval_state_check',
      oneOf(table.approvalState, planApprovalStates),
    ),
    check('plan_versions_revision_check', sql`${table.revision} >= 1`),
    uniqueIndex('plan_versions_job_id_revision_unique').on(
      table.jobId,
      table.revision,
    ),
  ],
)

/**
 * Immutable: nothing updates a snapshot, and re-approving a plan takes another
 * one. `content` is the runbook verbatim, on the same terms as
 * `plan_versions.content` — Phase 5 owns its inner shape.
 */
export const runbookSnapshots = sqliteTable(
  'runbook_snapshots',
  {
    id: text('id').primaryKey(),
    jobId: text('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [index('runbook_snapshots_job_id_idx').on(table.jobId)],
)

/**
 * `comments` and `verdicts` hold their payloads verbatim; Phase 11 evaluates
 * reviews and owns their inner shape. `verdicts`, `child_branch` and
 * `child_pr_url` are null until that evaluation has run and accepted feedback
 * has somewhere to land.
 */
export const reviewRounds = sqliteTable(
  'review_rounds',
  {
    id: text('id').primaryKey(),
    jobId: text('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    roundNumber: integer('round_number').notNull(),
    comments: text('comments').notNull(),
    verdicts: text('verdicts'),
    childBranch: text('child_branch'),
    childPrUrl: text('child_pr_url'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    check('review_rounds_round_number_check', sql`${table.roundNumber} >= 1`),
    uniqueIndex('review_rounds_job_id_round_number_unique').on(
      table.jobId,
      table.roundNumber,
    ),
  ],
)
