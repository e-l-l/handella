import { Type, type Static } from 'typebox'

import { codexPassKinds } from './codex-process.js'
import { LinearIdSchema } from './linear.js'
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

/**
 * Why a Job in `planning` has no pass behind it: Handella will not plan it
 * unattended and is waiting for the Handler to open the session. Not a
 * Suspension — nothing stopped — and it holds no Slot (docs/adr/0017).
 */
export const jobHolds = ['handlerPlanning'] as const

export type JobHold = (typeof jobHolds)[number]

export const JobHoldSchema = literalUnion(jobHolds)

export const jobSources = ['linear', 'slack', 'adhoc'] as const

export type JobSource = (typeof jobSources)[number]

export const JobSourceSchema = literalUnion(jobSources)

export const workClasses = ['feature', 'routine'] as const

export type WorkClass = (typeof workClasses)[number]

export const WorkClassSchema = literalUnion(workClasses)

export const transitionActors = ['handler', 'system'] as const

export type TransitionActor = (typeof transitionActors)[number]

export const TransitionActorSchema = literalUnion(transitionActors)

/** Where a job starts from when the Handler has said nothing else. */
export const defaultBaseBranch = 'dev'

/**
 * Git's own bound on a ref name, spelled once: a Job's base branch, the
 * Canonical Branch it works on, and the branch Intake plans for it are all the
 * same kind of string, and three spellings of the bound are three chances for
 * one path to accept a name another rejects.
 */
export const BranchNameSchema = Type.String({ minLength: 1, maxLength: 255 })

/**
 * ADR 0004: the first Job for an issue takes Linear's branch name verbatim,
 * and every repeat appends its round number.
 *
 * One implementation, because the rule is applied three times over a Job's
 * life — Intake shows the Handler the name, Intake writes it, and Dispatch
 * computes it again to claim it — and three spellings of it are three chances
 * for them to disagree.
 */
export const canonicalBranchForRound = (
  branchName: string,
  round: number,
): string => (round === 1 ? branchName : `${branchName}-${round}`)

export const JobSchema = Type.Object(
  {
    id: UuidSchema,
    source: JobSourceSchema,
    title: Type.String({ minLength: 1, maxLength: 500 }),
    workClass: WorkClassSchema,
    state: JobStateSchema,
    suspension: Nullable(JobSuspensionSchema),
    hold: Nullable(JobHoldSchema),
    /**
     * The Handella pass currently claiming this Job's Slot, or null. A Slot is
     * a fact about a pass rather than about a Lifecycle State: a Job the
     * Handler is driving from their terminal is `implementing` and holds none
     * (docs/adr/0015).
     */
    codexPass: Nullable(literalUnion(codexPassKinds)),
    linearIssueKey: Nullable(LinearIdSchema),
    /**
     * Linear's own id for the issue, and the authoritative link. The
     * identifier in `linearIssueKey` is what the Handler reads, but Linear
     * reassigns it when an issue moves team, so nothing looks a job up by it.
     */
    linearIssueId: Nullable(LinearIdSchema),
    linearIssueUrl: Nullable(Type.String({ minLength: 1, maxLength: 2048 })),
    /**
     * Linear's branch name for the issue, suffixed from the second Job
     * onwards. Provisional until Dispatch: ADR 0004 has Intake compute it so
     * the Handler sees the real name before committing to it, and Dispatch
     * compute it again — another Job for the same issue may have started in
     * between — and only then fix it. Phase 4 recomputes rather than claims
     * what it reads here.
     */
    canonicalBranch: Nullable(BranchNameSchema),
    /**
     * The checkout this Job's worktree is cut from. Nullable for the same
     * reason the Linear columns are: `POST /api/jobs` is the recovery path and
     * cannot name one, and such a Job can never be dispatched. Intake always
     * sets it, because a base branch means nothing without the remote it is on.
     */
    repositoryId: Nullable(UuidSchema),
    baseBranch: BranchNameSchema,
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

/**
 * The recovery path: a job made by hand when intake itself is unavailable.
 *
 * Deliberately cannot carry `linearIssueId`. That column is what links a Job
 * to its issue, what the live-job index is keyed on, and what ADR 0004 counts
 * rounds by, so accepting it here would let the browser mint a link that
 * skipped the live-job check and the suffix alike — and surface the index as
 * an untyped constraint failure rather than a typed conflict. Intake is the
 * only path that links a Job to a Linear issue.
 */
export const CreateJobSchema = Type.Object(
  {
    source: JobSourceSchema,
    title: Type.String({ minLength: 1, maxLength: 500 }),
    workClass: WorkClassSchema,
    baseBranch: Type.String({
      ...BranchNameSchema,
      default: defaultBaseBranch,
    }),
    linearIssueKey: Type.Optional(Nullable(LinearIdSchema)),
    canonicalBranch: Type.Optional(Nullable(BranchNameSchema)),
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
