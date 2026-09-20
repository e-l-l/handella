import { Type, type Static } from 'typebox'

import {
  IsoDateTimeSchema,
  Nullable,
  UuidSchema,
  literalUnion,
} from './primitives.js'

/**
 * How an Attempt ended. Split finely rather than into succeeded and failed,
 * because what Handella does next differs for each: a blocked report stops the
 * job at once however much budget is left, a timeout or a crash is worth
 * another turn, and a stop is the Handler's own and waits for them.
 *
 * `reportedDone` says only that the agent claimed to be finished. Whether the
 * job actually reaches `prOpen` is decided by what Handella can see for itself
 * — the worktree's HEAD and the pull request GitHub can be asked about.
 */
export const attemptOutcomes = [
  'reportedDone',
  'reportedBlocked',
  'failed',
  'timedOut',
  'stopped',
  'interrupted',
] as const

export type AttemptOutcome = (typeof attemptOutcomes)[number]

export const AttemptOutcomeSchema = literalUnion(attemptOutcomes)

/**
 * Whether Handella may answer this ending by itself.
 *
 * A turn that crashed, ran long or came back unfinished is one it can try
 * again. A stop, an interruption and a wrong plan are endings only the Handler
 * can move past, so the next turn after one of those opens a new round and a
 * fresh budget.
 *
 * Stated here rather than in the store because three readers depend on it
 * agreeing: the store numbers rounds by it, the scheduler decides whether to
 * take another turn by it, and the dashboard marks a turn passed or ended by
 * it. Two of them spelling it out privately is how a budget stops being one.
 */
export const isRepairable = (outcome: AttemptOutcome): boolean =>
  outcome === 'reportedDone' || outcome === 'failed' || outcome === 'timedOut'

/**
 * The most autonomous repair turns Handella will take before it asks the
 * Handler. Counted as rows rather than kept in a column: see the comment on
 * `implementationAttempts` in the service's schema.
 */
export const maxImplementationAttempts = 3

/** One check the agent ran, as the agent describes it. */
const ImplementationCheckSchema = Type.Object(
  {
    command: Type.String(),
    passed: Type.Boolean(),
    note: Type.String(),
  },
  { additionalProperties: false },
)

export type ImplementationCheck = Static<typeof ImplementationCheckSchema>

/**
 * The agent's own account of an Attempt, handed to `codex exec --output-schema`
 * exactly as `PlanContentSchema` is. That dual use is why nothing here carries
 * `minItems`, `minLength` or `minimum`, why every property is required, and why
 * "none" is an empty string or an empty array: structured output accepts a
 * subset of JSON Schema and rejects the rest at the CLI.
 *
 * It is read and kept, never believed. `pullRequestUrl` is stored for the
 * record, but a job reaches `prOpen` only when Handella's own GitHub query
 * finds the pull request.
 *
 * `outcome` is `blocked` when the Plan itself turned out to be wrong — a file
 * is not what it claimed, a step is impossible, the work is far larger than
 * described. That is the one ending no repair turn can help with, so it spends
 * no budget and goes straight to the Handler with `planDeviations` as evidence.
 *
 * Carries no `$id`: it is inlined into `AttemptSchema`, and Fastify refuses a
 * serializer whose graph resolves one `$id` twice (see `primitives.ts`).
 */
export const ImplementationReportSchema = Type.Object(
  {
    outcome: literalUnion(['completed', 'blocked']),
    summary: Type.String(),
    committed: Type.Boolean(),
    pullRequestUrl: Type.String(),
    checks: Type.Array(ImplementationCheckSchema),
    /** What is still broken. The whole of the next repair turn's brief. */
    unresolved: Type.Array(Type.String()),
    /** Where the approved Plan turned out not to describe the repository. */
    planDeviations: Type.Array(Type.String()),
  },
  { additionalProperties: false },
)

export type ImplementationReport = Static<typeof ImplementationReportSchema>

/**
 * One turn of implementation Codex took on a Job.
 *
 * `report` is null whenever the turn did not get far enough to produce one: a
 * crash, a timeout, a stop. `failureReason` carries what Codex said instead,
 * already redacted.
 *
 * Where the raw log is kept is not on the wire. The dashboard reads it through
 * the attempt's own endpoint, and a filesystem path is not something a browser
 * has any use for.
 */
export const AttemptSchema = Type.Object(
  {
    id: UuidSchema,
    jobId: UuidSchema,
    /**
     * Which run of the budget this Attempt belongs to. A Handler who resumes a
     * Job that has run out of repair turns grants a fresh three, and that fresh
     * three is a new round rather than a continuation — so `attempt` stays 1, 2
     * or 3 and never has to say "4 of 3".
     */
    round: Type.Integer({ minimum: 1 }),
    attempt: Type.Integer({ minimum: 1 }),
    codexSessionId: Type.String(),
    startedAt: IsoDateTimeSchema,
    endedAt: Nullable(IsoDateTimeSchema),
    outcome: Nullable(AttemptOutcomeSchema),
    report: Nullable(ImplementationReportSchema),
    failureReason: Nullable(Type.String()),
  },
  { additionalProperties: false, $id: 'Attempt' },
)

export type Attempt = Static<typeof AttemptSchema>

/**
 * Whether the turn is still going. `endedAt` and `outcome` are written
 * together on every path, so their nullness is one fact and is asked as one.
 */
export const isAttemptRunning = (attempt: Attempt): boolean =>
  attempt.endedAt === null
