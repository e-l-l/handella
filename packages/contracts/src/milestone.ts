import { Type, type Static } from 'typebox'

import {
  IsoDateTimeSchema,
  Nullable,
  UuidSchema,
  literalUnion,
} from './primitives.js'

/**
 * What a Milestone can be: work the agent did, never what it thought.
 *
 * Codex emits far more than this over its JSONL stream — reasoning, partial
 * item updates, web searches, tool calls. Those go to the Attempt's raw log and
 * no further. A spine that carried them would be the log, and the two tiers the
 * masterplan asks for would collapse into one.
 *
 * Turn events are not here either. `turn.started`, `turn.completed` and
 * `turn.failed` are the Attempt's own boundaries and land on its row as
 * `startedAt`, `endedAt` and `failureReason`, so recording them again on the
 * spine would say the same thing twice.
 */
export const milestoneKinds = [
  'command',
  'fileChange',
  'narration',
  'todoList',
] as const

export type MilestoneKind = (typeof milestoneKinds)[number]

export const MilestoneKindSchema = literalUnion(milestoneKinds)

/**
 * One beat of an Attempt, as the Handler reads it.
 *
 * `summary` is the single line the dashboard shows — the command, the count of
 * files changed, the agent's sentence. `detail` is what an expanded row adds,
 * and is null when the summary was the whole of it.
 *
 * `seq` is the position within the Attempt rather than a timestamp, because two
 * events in the same millisecond still have an order and the Handler reading a
 * failed turn needs it.
 */
export const MilestoneSchema = Type.Object(
  {
    id: UuidSchema,
    jobId: UuidSchema,
    attemptId: UuidSchema,
    seq: Type.Integer({ minimum: 0 }),
    kind: MilestoneKindSchema,
    summary: Type.String(),
    detail: Nullable(Type.String()),
    /** Set only on `command`, and null while the command is still running. */
    exitCode: Nullable(Type.Integer()),
    occurredAt: IsoDateTimeSchema,
  },
  { additionalProperties: false, $id: 'Milestone' },
)

export type Milestone = Static<typeof MilestoneSchema>
