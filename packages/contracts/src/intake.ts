import { Type, type Static } from 'typebox'

import { BranchNameSchema, WorkClassSchema } from './job.js'
import {
  LinearIdSchema,
  LinearIssueSummarySchema,
  LinearPrioritySchema,
} from './linear.js'
import { Nullable, UuidSchema } from './primitives.js'

/**
 * The three decisions Intake takes from the browser, and the only three. They
 * travel together through every creation path, so they are one type rather
 * than a trio each path has to keep in step.
 *
 * The repository is required here although the column is nullable: a base
 * branch means nothing without the remote it is on, so a Job born at Intake
 * always names one. Only the recovery path leaves it null, and a Job with no
 * repository can never be dispatched.
 *
 * Carries no `$id`: it is spread into the records below rather than sent on
 * its own, and one id resolving to two schemas is what stops Fastify
 * compiling a serializer.
 */
export const IntakeChoicesSchema = Type.Object({
  workClass: WorkClassSchema,
  repositoryId: UuidSchema,
  baseBranch: BranchNameSchema,
})

export type IntakeChoices = Static<typeof IntakeChoicesSchema>

/**
 * Intake never takes the Canonical Branch, the title or the issue key from the
 * browser: Linear owns all three and the local service reads them back itself.
 * All the Handler contributes is the classification and the base branch.
 *
 * One issue per request. The dashboard supports multi-selection, but the
 * masterplan classifies, plans and approves each issue independently, so each
 * one gets its own transaction, its own conflict and its own event.
 */
export const CreateJobFromLinearIssueSchema = Type.Object(
  {
    issueId: LinearIdSchema,
    ...IntakeChoicesSchema.properties,
  },
  { additionalProperties: false, $id: 'CreateJobFromLinearIssue' },
)

export type CreateJobFromLinearIssue = Static<
  typeof CreateJobFromLinearIssueSchema
>

/**
 * Ad hoc work still becomes a real Linear issue before it becomes a job: the
 * Canonical Branch is what makes a job dispatchable, and only Linear can name
 * one.
 *
 * There is no suggested work class. The masterplan files "AI proposes Feature
 * or Routine and you confirm or change it" under Dispatch, and the proposer is
 * the Codex adapter Phase 5 introduces; until then the Handler picks and
 * nothing pretends to have an opinion.
 */
export const CreateAdhocJobSchema = Type.Object(
  {
    teamId: LinearIdSchema,
    title: Type.String({ minLength: 1, maxLength: 500 }),
    description: Type.Optional(Type.String({ maxLength: 20_000 })),
    priority: Type.Optional(LinearPrioritySchema),
    ...IntakeChoicesSchema.properties,
  },
  { additionalProperties: false, $id: 'CreateAdhocJob' },
)

export type CreateAdhocJob = Static<typeof CreateAdhocJobSchema>

/**
 * One issue as Intake offers it: what Linear says about it, beside what
 * Handella already knows about it. Both halves are answered by the local
 * service, so the dashboard never re-derives either from the jobs it happens
 * to be holding.
 */
export const IntakeIssueSchema = Type.Object(
  {
    issue: LinearIssueSummarySchema,
    /**
     * The Job that already holds this issue, or null while it is free. A
     * Linear issue belongs to at most one live Job, so this is what makes an
     * issue unavailable rather than hidden: knowing why it cannot be taken is
     * the point.
     */
    heldByJobId: Nullable(UuidSchema),
    /**
     * The Canonical Branch the next Job for this issue would take, computed
     * here so the Handler sees the real name before committing to it (ADR
     * 0004). Provisional: Dispatch computes it again and fixes it.
     */
    plannedBranch: BranchNameSchema,
    /**
     * Which round of work on this issue the next Job would be: 1 the first
     * time, 2 after it has been worked and reopened (ADR 0004). Carried as the
     * number rather than left for the browser to recover by comparing
     * `plannedBranch` against Linear's own name, so the suffix format stays a
     * detail of `canonicalBranchForRound`.
     */
    round: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false, $id: 'IntakeIssue' },
)

export type IntakeIssue = Static<typeof IntakeIssueSchema>

/** Relay pagination flattened: a cursor to ask for more, or null because there is no more. */
export const IntakeIssuePageSchema = Type.Object(
  {
    issues: Type.Array(IntakeIssueSchema),
    nextCursor: Nullable(Type.String({ minLength: 1, maxLength: 1024 })),
  },
  { additionalProperties: false, $id: 'IntakeIssuePage' },
)

export type IntakeIssuePage = Static<typeof IntakeIssuePageSchema>

/**
 * Free text with help rather than a closed list. Phase 4 owns Git, so until
 * then `recent` is what this installation has actually used, newest first,
 * with the default left out because it is reported on its own field. Phase 4
 * replaces the body of this read with the remote's branches and leaves the
 * shape alone.
 */
export const BaseBranchSuggestionsSchema = Type.Object(
  {
    defaultBranch: BranchNameSchema,
    recent: Type.Array(BranchNameSchema),
  },
  { additionalProperties: false, $id: 'BaseBranchSuggestions' },
)

export type BaseBranchSuggestions = Static<typeof BaseBranchSuggestionsSchema>
