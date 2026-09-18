import { Type, type Static } from 'typebox'

import {
  IsoDateTimeSchema,
  Nullable,
  UuidSchema,
  literalUnion,
} from './primitives.js'

/** The decisions and outcomes the masterplan puts in front of the Handler. */
export const attentionItemKinds = [
  'planApproval',
  'blocker',
  'disputedReview',
  'conflictProposal',
  'readyPr',
  'failure',
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
