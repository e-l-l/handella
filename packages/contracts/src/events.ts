import { Type, type Static } from 'typebox'

import { JobStateSchema, JobSuspensionSchema } from './job.js'
import { Nullable, UuidSchema } from './primitives.js'

/**
 * Events name what changed rather than carrying the new record, so the REST
 * endpoints stay the single description of every entity. The dashboard turns
 * each event into a query invalidation and refetches.
 */
export const domainEventNames = [
  'job.changed',
  'attention.changed',
  'job.progress',
] as const

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

/**
 * A job's implementation produced new milestones. Names the job and nothing
 * else, like the other two: the milestone endpoint stays the only description
 * of a milestone.
 *
 * Unlike the other two this one can fire many times a minute, so the pass that
 * raises it coalesces — the Handler watching a spine wants it to move, not to
 * move once per line.
 */
export const JobProgressSchema = Type.Object(
  {
    jobId: UuidSchema,
  },
  { additionalProperties: false, $id: 'JobProgress' },
)

export type JobProgress = Static<typeof JobProgressSchema>

export type DomainEvent =
  | { name: 'job.changed'; data: JobChanged }
  | { name: 'attention.changed'; data: AttentionChanged }
  | { name: 'job.progress'; data: JobProgress }
