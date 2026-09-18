import { Type, type Static } from 'typebox'

import { JobStateSchema, JobSuspensionSchema } from './job.js'
import { Nullable, UuidSchema } from './primitives.js'

/**
 * Events name what changed rather than carrying the new record, so the REST
 * endpoints stay the single description of every entity. The dashboard turns
 * each event into a query invalidation and refetches.
 */
export const domainEventNames = ['job.changed', 'attention.changed'] as const

export type DomainEventName = (typeof domainEventNames)[number]

export const JobChangedSchema = Type.Object(
  {
    jobId: UuidSchema,
    state: JobStateSchema,
    suspension: Nullable(JobSuspensionSchema),
  },
  { additionalProperties: false, $id: 'JobChanged' },
)

export type JobChanged = Static<typeof JobChangedSchema>

export const AttentionChangedSchema = Type.Object(
  {
    attentionItemId: UuidSchema,
    jobId: Nullable(UuidSchema),
  },
  { additionalProperties: false, $id: 'AttentionChanged' },
)

export type AttentionChanged = Static<typeof AttentionChangedSchema>

export type DomainEvent =
  | { name: 'job.changed'; data: JobChanged }
  | { name: 'attention.changed'; data: AttentionChanged }
