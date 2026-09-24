import { Type, type Static } from 'typebox'

import {
  IsoDateTimeSchema,
  Nullable,
  UuidSchema,
  literalUnion,
} from './primitives.js'

/**
 * How an Attempt ended.
 *
 * `finished` says only that the turn ended on its own. Whether the work landed
 * is not the turn's to say: the Job moves on only when GitHub shows an open
 * pull request on the Canonical Branch, and a turn that finished without one
 * hands the Job back to the Handler rather than to a repair loop
 * (docs/adr/0015). A stop is the Handler's own; a timeout or a crash is
 * recorded and waits for them too.
 */
export const attemptOutcomes = [
  'finished',
  'failed',
  'timedOut',
  'stopped',
  'interrupted',
] as const

export type AttemptOutcome = (typeof attemptOutcomes)[number]

export const AttemptOutcomeSchema = literalUnion(attemptOutcomes)

/**
 * The one unattended implementation turn Handella takes on a Job, in the Codex
 * Session that planned it. Ordinarily one row per Job: a second appears only
 * when the Handler sends a Job back through the queue and approves it again.
 *
 * `failureReason` carries what Codex said when the turn did not end on its own
 * terms, already redacted.
 *
 * Where the raw log is kept is not on the wire. The dashboard reads it through
 * the attempt's own endpoint, and a filesystem path is not something a browser
 * has any use for.
 */
export const AttemptSchema = Type.Object(
  {
    id: UuidSchema,
    jobId: UuidSchema,
    codexSessionId: Type.String(),
    startedAt: IsoDateTimeSchema,
    endedAt: Nullable(IsoDateTimeSchema),
    outcome: Nullable(AttemptOutcomeSchema),
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
