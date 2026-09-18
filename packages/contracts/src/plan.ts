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
 * `content` is the structured plan as Codex returned it. Phase 5 owns its
 * internal shape; until then it is stored and returned verbatim.
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
    content: Type.String(),
    feedback: Nullable(Type.String()),
    approvalState: PlanApprovalStateSchema,
    approvedAt: Nullable(IsoDateTimeSchema),
    createdAt: IsoDateTimeSchema,
  },
  { additionalProperties: false, $id: 'PlanVersion' },
)

export type PlanVersion = Static<typeof PlanVersionSchema>
