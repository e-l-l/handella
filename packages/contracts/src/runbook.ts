import { Type, type Static } from 'typebox'

import { IsoDateTimeSchema, UuidSchema } from './primitives.js'

/**
 * The immutable copy of the Runbook a job will execute, taken when its plan is
 * approved. Nothing ever updates one: a re-approval takes another snapshot.
 *
 * `content` is the runbook verbatim, on the same terms as `PlanVersion.content`
 * — Phase 5 introduces the dashboard-managed runbook and owns its inner shape,
 * and until then this stores and returns exactly what it was given.
 */
export const RunbookSnapshotSchema = Type.Object(
  {
    id: UuidSchema,
    jobId: UuidSchema,
    content: Type.String(),
    createdAt: IsoDateTimeSchema,
  },
  { additionalProperties: false, $id: 'RunbookSnapshot' },
)

export type RunbookSnapshot = Static<typeof RunbookSnapshotSchema>

export const CreateRunbookSnapshotSchema = Type.Object(
  {
    content: Type.String(),
  },
  { additionalProperties: false, $id: 'CreateRunbookSnapshot' },
)

export type CreateRunbookSnapshot = Static<typeof CreateRunbookSnapshotSchema>
