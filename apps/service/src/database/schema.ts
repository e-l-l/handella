import {
  attemptOutcomes,
  attentionItemKinds,
  codexPassKinds,
  jobHolds,
  jobSources,
  jobStates,
  jobSuspensions,
  milestoneKinds,
  sessionWatchStatuses,
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

/** States in which a Job holds no claim on its Canonical Branch. */
const unclaimedJobStates: readonly string[] = ['intake', ...settledJobStates]

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
 * A checkout the Handler already has. Handella adopts it rather than cloning
 * it, so the Handler's ssh and gh credentials stay theirs and Handella never
 * handles a secret to reach a remote.
 *
 * masterplan.md:97 has V1 managing one primary repository. This is a table
 * rather than a setting so the second one is a row instead of a migration.
 * Distinct from `AppConfig.repositoryRoot`, which is Handella's own checkout.
 *
 * `path` is absolute because a worktree outlives the process that cut it, and
 * a path resolved against a working directory is a path that moves.
 */
export const repositories = sqliteTable(
  'repositories',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    path: text('path').notNull().unique(),
    defaultBaseBranch: text('default_base_branch').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    check('repositories_path_absolute_check', sql`${table.path} like '/%'`),
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
    /**
     * Enumerated in TypeScript only, with no CHECK, unlike every other column
     * here: a CHECK added to this table recreates it, and inside the
     * migrator's single transaction `PRAGMA foreign_keys=OFF` is a no-op, so
     * the DROP behind the recreate cascades through every child table. The
     * store is the only writer and writes the contracts tuple.
     */
    hold: text('hold', { enum: jobHolds }),
    codexPass: text('codex_pass', { enum: codexPassKinds }),
    linearIssueKey: text('linear_issue_key'),
    linearIssueId: text('linear_issue_id'),
    linearIssueUrl: text('linear_issue_url'),
    canonicalBranch: text('canonical_branch'),
    /**
     * Set to null rather than blocking when a repository is removed: a settled
     * job keeps its history, and the store refuses the delete outright while a
     * live job still references it.
     */
    repositoryId: text('repository_id').references(() => repositories.id, {
      onDelete: 'set null',
    }),
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
    /**
     * A Canonical Branch belongs to at most one job that has claimed it, which
     * is what lets Dispatch claim in one transaction rather than reading and
     * then writing: two dispatches racing for the same name, one wins here.
     *
     * `intake` is excluded as well as the settled states, because a Job that
     * has not been dispatched has not claimed anything. ADR 0004 has Intake
     * compute the name so the Handler sees it, and Dispatch fix it; two Jobs
     * may sit in intake holding the same provisional guess, and only one of
     * them can go on to own it.
     */
    uniqueIndex('jobs_claimed_canonical_branch_unique')
      .on(table.repositoryId, table.canonicalBranch)
      .where(
        sql`${table.repositoryId} is not null and ${table.canonicalBranch} is not null and ${table.state} not in (${sql.raw(
          unclaimedJobStates.map((state) => `'${state}'`).join(', '),
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

/**
 * The Runbook the Handler maintains, one row per version. Append-only: nothing
 * updates a row, because jobs have approved against what it said. The active
 * version is the highest, so a rollback is the old text saved again.
 */
export const runbookVersions = sqliteTable(
  'runbook_versions',
  {
    id: text('id').primaryKey(),
    version: integer('version').notNull(),
    content: text('content').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    check('runbook_versions_version_check', sql`${table.version} >= 1`),
    uniqueIndex('runbook_versions_version_unique').on(table.version),
  ],
)

/**
 * Immutable: nothing updates a snapshot, and re-approving a plan takes another
 * one. `content` is the runbook verbatim rather than only a reference, so a
 * job can still say what it ran after the version it came from is rewritten;
 * `runbook_version_id` is kept alongside so two jobs can be recognised as
 * having executed the same procedure.
 */
export const runbookSnapshots = sqliteTable(
  'runbook_snapshots',
  {
    id: text('id').primaryKey(),
    jobId: text('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    runbookVersionId: text('runbook_version_id')
      .notNull()
      .references(() => runbookVersions.id),
    content: text('content').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [index('runbook_snapshots_job_id_idx').on(table.jobId)],
)

/**
 * One turn of implementation Codex took on a Job, spawned by Handella.
 *
 * Ordinarily one per Job. The bound on autonomous repair that these rows used
 * to count is gone: a turn that ends without a pull request hands the Job to
 * the Handler's terminal rather than to another turn (docs/adr/0015), so a
 * second row appears only when the Handler sends a Job back through the queue
 * and approves it again. The milestones and the log hang off the row.
 *
 * `outcome` and `ended_at` are null exactly while the turn is still running, so
 * a row with a null `ended_at` after a restart is a turn that was interrupted.
 */
export const implementationAttempts = sqliteTable(
  'implementation_attempts',
  {
    id: text('id').primaryKey(),
    jobId: text('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    codexSessionId: text('codex_session_id').notNull(),
    startedAt: integer('started_at', { mode: 'timestamp_ms' }).notNull(),
    endedAt: integer('ended_at', { mode: 'timestamp_ms' }),
    outcome: text('outcome', { enum: attemptOutcomes }),
    failureReason: text('failure_reason'),
    /**
     * Where this turn's raw stream was written. A path rather than the bytes:
     * a long turn is megabytes of JSONL, which is the wrong shape for a row and
     * for the write-ahead log behind it. Phase 12 deletes the file and keeps
     * this row as the metadata that says a turn happened.
     */
    logPath: text('log_path').notNull(),
  },
  (table) => [
    check(
      'implementation_attempts_outcome_check',
      nullOrOneOf(table.outcome, attemptOutcomes),
    ),
    /** What `listAttempts` reads by and orders by; SQLite indexes no foreign key on its own. */
    index('implementation_attempts_job_id_started_at_idx').on(
      table.jobId,
      table.startedAt,
    ),
  ],
)

/**
 * One readable beat of an Attempt. The rest of Codex's stream — its reasoning,
 * its partial updates — is in the log file and nowhere else, which is what
 * keeps this a spine rather than a second copy of the log.
 *
 * `seq` orders within the Attempt rather than by clock, because two events in
 * the same millisecond still happened in an order and a Handler reading a
 * failed turn needs it.
 */
export const milestones = sqliteTable(
  'milestones',
  {
    id: text('id').primaryKey(),
    jobId: text('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    attemptId: text('attempt_id')
      .notNull()
      .references(() => implementationAttempts.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    kind: text('kind', { enum: milestoneKinds }).notNull(),
    summary: text('summary').notNull(),
    detail: text('detail'),
    exitCode: integer('exit_code'),
    occurredAt: integer('occurred_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    check('milestones_kind_check', oneOf(table.kind, milestoneKinds)),
    check('milestones_seq_check', sql`${table.seq} >= 0`),
    uniqueIndex('milestones_attempt_id_seq_unique').on(
      table.attemptId,
      table.seq,
    ),
    index('milestones_job_id_occurred_at_idx').on(
      table.jobId,
      table.occurredAt,
    ),
  ],
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

/**
 * One Codex process Handella started, and whether it believes it is still
 * running.
 *
 * A row exists so that a process can be found again after the process that
 * spawned it is gone. Nothing else in the database survives that: an Attempt
 * says a turn was open, but not what to signal, and a planning pass has no
 * Attempt at all — which is why this hangs off the Job rather than off
 * `implementation_attempts`.
 *
 * `pid` is the process group's leader, because Codex is spawned detached and
 * its own children — the installs and test runners the Runbook asks for — are
 * in that group too. Signalling the group is the only way to reach them
 * (docs/adr/0012).
 *
 * `ended_at` is null exactly while Handella believes the process is alive, so
 * a null row after a restart is one to reap. Believes, not knows: the pid may
 * have been reused since, which is what `started_at` is compared against
 * before anything is signalled.
 */
export const codexProcesses = sqliteTable(
  'codex_processes',
  {
    id: text('id').primaryKey(),
    jobId: text('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: codexPassKinds }).notNull(),
    pid: integer('pid').notNull(),
    startedAt: integer('started_at', { mode: 'timestamp_ms' }).notNull(),
    endedAt: integer('ended_at', { mode: 'timestamp_ms' }),
  },
  (table) => [
    check('codex_processes_kind_check', oneOf(table.kind, codexPassKinds)),
    check('codex_processes_pid_check', sql`${table.pid} > 0`),
    index('codex_processes_job_id_idx').on(table.jobId),
    /**
     * What every reap reads, and the only query this table is asked. Partial
     * so it stays the size of what is running rather than of everything that
     * ever ran.
     */
    index('codex_processes_live_idx')
      .on(table.startedAt)
      .where(sql`${table.endedAt} is null`),
  ],
)

/**
 * Where Session Watch stands on a Job's Codex session (docs/adr/0015).
 *
 * Its own table rather than columns on `jobs`, because `byte_offset` is
 * written every few seconds while a session is followed, and every write to a
 * Job's row bumps `updated_at` and publishes a `job.changed` that every open
 * dashboard refetches on. One row per Job, so the Job's id is the key.
 *
 * `rollout_path` is null until the file has been found. `missing_since` is set
 * on the first pass that could not find it and cleared when it reappears;
 * `status` turns to `lost` once it has been missing for the grace period.
 * `last_turn_id` is the turn the last "needs you" item was raised for, so an
 * idle session raises one item rather than one per pass.
 */
export const sessionWatches = sqliteTable(
  'session_watches',
  {
    jobId: text('job_id')
      .primaryKey()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    status: text('status', { enum: sessionWatchStatuses }).notNull(),
    rolloutPath: text('rollout_path'),
    byteOffset: integer('byte_offset').notNull().default(0),
    lastTurnId: text('last_turn_id'),
    missingSince: integer('missing_since', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    check(
      'session_watches_status_check',
      oneOf(table.status, sessionWatchStatuses),
    ),
  ],
)
