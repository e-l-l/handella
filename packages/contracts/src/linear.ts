import { Type, type Static } from 'typebox'

import { Nullable, isOneOf, literalUnion } from './primitives.js'

/**
 * Linear's own workflow state categories, spelled the way Linear spells them:
 * `canceled` carries one `l`. Handella reads these and never writes them, so
 * this tuple describes Linear's vocabulary rather than Handella's.
 *
 * `duplicate` is easy to miss: it is a category in its own right rather than a
 * flavour of `canceled`, and Linear's own `state.type` filter treats it as
 * such. An issue Handella cannot place in one of these is never actionable.
 */
export const linearWorkflowStateTypes = [
  'triage',
  'backlog',
  'unstarted',
  'started',
  'completed',
  'canceled',
  'duplicate',
] as const

export type LinearWorkflowStateType = (typeof linearWorkflowStateTypes)[number]

export const LinearWorkflowStateTypeSchema = literalUnion(
  linearWorkflowStateTypes,
)

export const isLinearWorkflowStateType = isOneOf(linearWorkflowStateTypes)

/**
 * An Actionable Issue is one with work left in it: every category except the
 * three that end an issue's life. Triage counts, because an untriaged issue
 * assigned to the Handler is still work they have not done. A duplicate does
 * not: its work lives on the issue it duplicates.
 *
 * Written out rather than filtered from the tuple above, because `filter`
 * erases the literal types and every `Static` built from the result collapses
 * to `never`. The relationship is asserted in the contracts tests instead, so
 * a category Linear adds later still forces a decision in review.
 */
export const actionableLinearWorkflowStateTypes = [
  'triage',
  'backlog',
  'unstarted',
  'started',
] as const

export type ActionableLinearWorkflowStateType =
  (typeof actionableLinearWorkflowStateTypes)[number]

export const isActionableLinearWorkflowStateType = isOneOf(
  actionableLinearWorkflowStateTypes,
)

/**
 * Linear's identifiers are opaque to Handella, so they are bounded strings
 * rather than `UuidSchema`: nothing here parses them, and pinning a format
 * would make Handella wrong the day Linear changes one.
 */
export const LinearIdSchema = Type.String({ minLength: 1, maxLength: 64 })

/**
 * Linear's priority scale, which runs the opposite way to most: 0 is no
 * priority and 1 is the most urgent. One list, because the schemas that bound
 * it and the dashboard that labels it must agree on which numbers exist.
 */
export const linearPriorities = [0, 1, 2, 3, 4] as const

export type LinearPriority = (typeof linearPriorities)[number]

export const LinearPrioritySchema = literalUnion(linearPriorities)

/**
 * Linear hands the SDK a plain number, so the scale is narrowed once here
 * rather than defended against everywhere it is displayed. A priority
 * Handella does not know reads as no priority, which is what the dashboard
 * showed for it anyway.
 */
export const isLinearPriority = isOneOf(linearPriorities)

/**
 * What intake needs to know about a Linear issue.
 *
 * `id` is what Handella stores and looks a Job up by, because it never
 * changes. `identifier` is what the Handler reads, and it changes when an
 * issue moves team. `branchName` is the Canonical Branch: it is never accepted
 * from the browser, and a blank one is a malformed upstream response rather
 * than a state this schema should allow.
 */
export const LinearIssueSummarySchema = Type.Object(
  {
    id: LinearIdSchema,
    identifier: Type.String({ minLength: 1, maxLength: 64 }),
    title: Type.String({ minLength: 1, maxLength: 500 }),
    description: Nullable(Type.String()),
    priority: LinearPrioritySchema,
    url: Type.String({ minLength: 1, maxLength: 2048 }),
    branchName: Type.String({ minLength: 1, maxLength: 255 }),
    stateName: Type.String({ minLength: 1, maxLength: 255 }),
    stateType: LinearWorkflowStateTypeSchema,
    updatedAt: Type.String({ minLength: 1, maxLength: 64 }),
  },
  { additionalProperties: false, $id: 'LinearIssueSummary' },
)

export type LinearIssueSummary = Static<typeof LinearIssueSummarySchema>

/** Relay pagination flattened: a cursor to ask for more, or null because there is no more. */
export const LinearIssuePageSchema = Type.Object(
  {
    issues: Type.Array(LinearIssueSummarySchema),
    nextCursor: Nullable(Type.String({ minLength: 1, maxLength: 1024 })),
  },
  { additionalProperties: false, $id: 'LinearIssuePage' },
)

export type LinearIssuePage = Static<typeof LinearIssuePageSchema>

/**
 * A workflow state as one team defines it. Linear's categories are fixed, but
 * the states inside them are named per team: on some teams `started` alone
 * covers In Progress, In Review and four QA states. A Handler filtering intake
 * is thinking of those names, not of the category behind them, so intake
 * filters by state and this is what it filters with.
 *
 * Only actionable states are ever described, because a state the Handler
 * cannot intake from is not one worth offering. Array order is Linear's own,
 * so a team's states read the way that team's Linear picker reads.
 */
export const LinearWorkflowStateSummarySchema = Type.Object(
  {
    id: LinearIdSchema,
    name: Type.String({ minLength: 1, maxLength: 255 }),
    type: literalUnion(actionableLinearWorkflowStateTypes),
  },
  { additionalProperties: false, $id: 'LinearWorkflowStateSummary' },
)

export type LinearWorkflowStateSummary = Static<
  typeof LinearWorkflowStateSummarySchema
>

/**
 * `teamId` and `stateId` are Linear's identifiers, taken from the team and
 * state lists rather than typed by hand, so nothing here parses them.
 *
 * A state id cannot be checked against the actionable categories the way the
 * category filter it replaced could be: ids are opaque, and which category a
 * state belongs to is a fact that lives in Linear. The guarantee that no query
 * parameter can talk the endpoint into listing finished work therefore moves
 * into the adapter, which keeps the actionable-category filter on every query
 * and only ever narrows it. A finished state's id selects nothing.
 *
 * Single-valued deliberately: Fastify's querystring parser yields a bare
 * string for one occurrence and an array for two, and the TypeBox validator
 * compiler will not wrap the first case, so a repeated parameter would
 * validate only when the Handler happened to pick more than one.
 */
export const LinearIssueQuerySchema = Type.Object(
  {
    search: Type.Optional(Type.String({ maxLength: 200 })),
    teamId: Type.Optional(LinearIdSchema),
    stateId: Type.Optional(LinearIdSchema),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
    cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 1024 })),
  },
  { additionalProperties: false, $id: 'LinearIssueQuery' },
)

export type LinearIssueQuery = Static<typeof LinearIssueQuerySchema>

/** Only what the ad hoc form needs to put a new issue in the right team. */
export const LinearTeamSummarySchema = Type.Object(
  {
    id: LinearIdSchema,
    key: Type.String({ minLength: 1, maxLength: 16 }),
    name: Type.String({ minLength: 1, maxLength: 255 }),
  },
  { additionalProperties: false, $id: 'LinearTeamSummary' },
)

export type LinearTeamSummary = Static<typeof LinearTeamSummarySchema>
