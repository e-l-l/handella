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
 * `orphanWorktree` and `overlapWarning` are the two Reconciliation raises, and
 * both are kinds of their own rather than blockers: a blocker is a Job that
 * has stopped, and neither of these has. An orphan is residue on disk that no
 * Job claims, and an overlap is a warning about two Jobs that are both fine.
 * Having their own kinds is also what lets Reconciliation find the items it
 * raised last pass, which is how a standalone one is replaced rather than
 * duplicated.
 */
export const attentionItemKinds = [
  'planApproval',
  'blocker',
  'disputedReview',
  'conflictProposal',
  'readyPr',
  'failure',
  'orphanWorktree',
  'overlapWarning',
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
