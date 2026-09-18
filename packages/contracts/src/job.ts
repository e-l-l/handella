import { Type, type Static } from 'typebox'

import {
  IsoDateTimeSchema,
  Nullable,
  UuidSchema,
  literalUnion,
} from './primitives.js'

/**
 * Where a job sits in its life. Deliberately excludes paused, interrupted and
 * blocked: those describe why a job is not moving, not where it is, and live on
 * `suspension` instead. See docs/adr/0003-orthogonal-job-state-and-suspension.md.
 */
export const jobStates = [
  'intake',
  'queued',
  'planning',
  'planReview',
  'approved',
  'implementing',
  'prOpen',
  'reviewing',
  'merged',
  'archived',
  'cancelled',
] as const

export type JobState = (typeof jobStates)[number]

export const JobStateSchema = literalUnion(jobStates)

/**
 * Why a job is not progressing. A job with no suspension is healthy.
 *
 * Named for stoppage rather than pausing: CONTEXT.md defines this concept as
 * Suspension and rules out pause, block, stall and hold as names for it.
 */
export const jobSuspensions = [
  'stoppedByHandler',
  'stoppedBySystem',
  'interrupted',
] as const

export type JobSuspension = (typeof jobSuspensions)[number]

export const JobSuspensionSchema = literalUnion(jobSuspensions)

export const jobSources = ['linear', 'slack', 'adhoc'] as const

export type JobSource = (typeof jobSources)[number]

export const JobSourceSchema = literalUnion(jobSources)

export const workClasses = ['feature', 'routine'] as const

export type WorkClass = (typeof workClasses)[number]

export const WorkClassSchema = literalUnion(workClasses)

export const transitionActors = ['handler', 'system'] as const

export type TransitionActor = (typeof transitionActors)[number]

export const TransitionActorSchema = literalUnion(transitionActors)

export const JobSchema = Type.Object(
  {
    id: UuidSchema,
    source: JobSourceSchema,
    title: Type.String({ minLength: 1, maxLength: 500 }),
    workClass: WorkClassSchema,
    state: JobStateSchema,
    suspension: Nullable(JobSuspensionSchema),
    linearIssueKey: Nullable(Type.String({ minLength: 1, maxLength: 64 })),
    canonicalBranch: Nullable(Type.String({ minLength: 1, maxLength: 255 })),
    baseBranch: Type.String({ minLength: 1, maxLength: 255 }),
    queuePriority: Nullable(Type.Integer()),
    worktreePath: Nullable(Type.String()),
    codexSessionId: Nullable(Type.String()),
    originalPrUrl: Nullable(Type.String()),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  },
  { additionalProperties: false, $id: 'Job' },
)

export type Job = Static<typeof JobSchema>

export const CreateJobSchema = Type.Object(
  {
    source: JobSourceSchema,
    title: Type.String({ minLength: 1, maxLength: 500 }),
    workClass: WorkClassSchema,
    baseBranch: Type.String({ minLength: 1, maxLength: 255, default: 'dev' }),
    linearIssueKey: Type.Optional(
      Nullable(Type.String({ minLength: 1, maxLength: 64 })),
    ),
    canonicalBranch: Type.Optional(
      Nullable(Type.String({ minLength: 1, maxLength: 255 })),
    ),
  },
  { additionalProperties: false, $id: 'CreateJob' },
)

export type CreateJob = Static<typeof CreateJobSchema>

/** One row of the append-only history behind every job. */
export const JobTransitionSchema = Type.Object(
  {
    id: UuidSchema,
    jobId: UuidSchema,
    fromState: JobStateSchema,
    toState: JobStateSchema,
    actor: TransitionActorSchema,
    reason: Nullable(Type.String()),
    occurredAt: IsoDateTimeSchema,
  },
  { additionalProperties: false, $id: 'JobTransition' },
)

export type JobTransitionRecord = Static<typeof JobTransitionSchema>

export const TransitionRequestSchema = Type.Object(
  {
    to: JobStateSchema,
    /** Optimistic lock: the move applies only if the job is still here. */
    expectedState: Type.Optional(JobStateSchema),
    reason: Type.Optional(Type.String({ maxLength: 1000 })),
  },
  { additionalProperties: false, $id: 'TransitionRequest' },
)

export type TransitionRequest = Static<typeof TransitionRequestSchema>

export const SuspendRequestSchema = Type.Object(
  {
    suspension: JobSuspensionSchema,
    reason: Type.Optional(Type.String({ maxLength: 1000 })),
  },
  { additionalProperties: false, $id: 'SuspendRequest' },
)

export type SuspendRequest = Static<typeof SuspendRequestSchema>
