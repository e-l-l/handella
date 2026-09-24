import { Type, type Static } from 'typebox'

import {
  IsoDateTimeSchema,
  Nullable,
  UuidSchema,
  literalUnion,
} from './primitives.js'

/**
 * The decisions and outcomes the masterplan puts in front of the Handler.
 *
 * `handlerInput` is Handella handing a Job to the Handler's terminal and
 * waiting on what they do there: a plan it will not make unattended, an
 * implementation turn that ended without a pull request, a session it can no
 * longer follow. Not a blocker — nothing has stopped — and not a failure:
 * Handella's part has ended and the Handler's has begun (docs/adr/0015).
 *
 * `orphanWorktree` is the one Reconciliation raises, and it is a kind of its
 * own rather than a blocker: a blocker is a Job that has stopped, and an orphan
 * is residue on disk that no Job claims. Having its own kind is also what lets
 * Reconciliation find the item it raised last pass, which is how a standalone
 * one is replaced rather than duplicated.
 */
export const attentionItemKinds = [
  'planApproval',
  'blocker',
  'disputedReview',
  'conflictProposal',
  'readyPr',
  'failure',
  'orphanWorktree',
  'handlerInput',
] as const

export type AttentionItemKind = (typeof attentionItemKinds)[number]

export const AttentionItemKindSchema = literalUnion(attentionItemKinds)

export const AttentionItemSchema = Type.Object(
  {
    id: UuidSchema,
    jobId: Nullable(UuidSchema),
    kind: AttentionItemKindSchema,
    title: Type.String({ minLength: 1, maxLength: 500 }),
    body: Nullable(Type.String()),
    createdAt: IsoDateTimeSchema,
    resolvedAt: Nullable(IsoDateTimeSchema),
  },
  { additionalProperties: false, $id: 'AttentionItem' },
)

export type AttentionItem = Static<typeof AttentionItemSchema>
