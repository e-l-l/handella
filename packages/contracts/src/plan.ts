import { Type, type Static } from 'typebox'

import {
  IsoDateTimeSchema,
  Nullable,
  UuidSchema,
  literalUnion,
} from './primitives.js'

export const planApprovalStates = [
  'pending',
  'approved',
  'changesRequested',
] as const

export type PlanApprovalState = (typeof planApprovalStates)[number]

export const PlanApprovalStateSchema = literalUnion(planApprovalStates)

/**
 * One thing the implementation will do. `id` is the planner's own label for
 * the step, not a database key: it is what Phase 6 quotes when a step fails and
 * what a repair cycle is counted against, so it has to survive being read back
 * out of a snapshot months later.
 *
 * `required` is what makes a plan executable rather than merely readable. A
 * required step that will not pass pauses the job before any pull request;
 * an optional one is allowed to be abandoned.
 *
 * Carries no `$id`: it is inlined into `PlanContentSchema`, and Fastify refuses
 * a serializer whose graph resolves one `$id` twice (see `primitives.ts`).
 */
const PlanStepSchema = Type.Object(
  {
    id: Type.String(),
    title: Type.String(),
    detail: Type.String(),
    /** Paths the step expects to touch, as the planner read them. */
    files: Type.Array(Type.String()),
    required: Type.Boolean(),
  },
  { additionalProperties: false },
)

export type PlanStep = Static<typeof PlanStepSchema>

/**
 * The structured plan itself. This schema does double duty: it is written to a
 * file and handed to `codex exec --output-schema`, so the model is constrained
 * by the same definition the store validates against. One definition, and no
 * way for the two to drift.
 *
 * That dual use is why nothing in here carries `minItems`, `minLength` or
 * `minimum`, and why every property is required with `additionalProperties`
 * off: structured output supports a subset of JSON Schema, and a keyword it
 * does not accept is rejected at the CLI rather than at review time. An empty
 * `risks` array is a meaningful answer; a schema that forbade one would only
 * teach the planner to invent a risk.
 *
 * Also carries no `$id`, for the reason `PlanStepSchema` does not.
 */
export const PlanContentSchema = Type.Object(
  {
    summary: Type.String(),
    steps: Type.Array(PlanStepSchema),
    /** How the Handler, or Phase 6, can tell the work actually landed. */
    verification: Type.Array(Type.String()),
    risks: Type.Array(Type.String()),
    /** What the planner decided this job is not, so review can argue with it. */
    outOfScope: Type.Array(Type.String()),
  },
  { additionalProperties: false },
)

export type PlanContent = Static<typeof PlanContentSchema>

/**
 * `content` is the structured plan Codex returned, validated on the way into
 * the database so a row can never hold something this type says it does not.
 * The column behind it is text; the store serialises on write and parses on
 * read, and the dashboard receives it already typed.
 *
 * `feedback` is what the Handler asked to be changed. It is what makes
 * `changesRequested` a state with somewhere to put its reason, and it is null
 * on every revision the Handler approved or has not answered yet.
 */
export const PlanVersionSchema = Type.Object(
  {
    id: UuidSchema,
    jobId: UuidSchema,
    revision: Type.Integer({ minimum: 1 }),
    content: PlanContentSchema,
    feedback: Nullable(Type.String()),
    approvalState: PlanApprovalStateSchema,
    approvedAt: Nullable(IsoDateTimeSchema),
    createdAt: IsoDateTimeSchema,
  },
  { additionalProperties: false, $id: 'PlanVersion' },
)

export type PlanVersion = Static<typeof PlanVersionSchema>

/**
 * A change request is the feedback and nothing else: which revision it answers
 * is in the path, and the job's next state is not the Handler's to name.
 */
export const RequestPlanChangesSchema = Type.Object(
  {
    // A character that is not whitespace, rather than a length: a space passes
    // `minLength` and then becomes the whole brief the next revision is
    // planned against.
    feedback: Type.String({ minLength: 1, pattern: '\\S' }),
  },
  { additionalProperties: false, $id: 'RequestPlanChanges' },
)

export type RequestPlanChanges = Static<typeof RequestPlanChangesSchema>
