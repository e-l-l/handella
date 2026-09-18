import { Type, type Static } from 'typebox'

import { IsoDateTimeSchema, Nullable, UuidSchema } from './primitives.js'

/**
 * One pass of review comments on a job's pull request, together with Handella's
 * verdicts and any child pull request that answers them.
 *
 * `comments` and `verdicts` are stored verbatim, on the same terms as
 * `PlanVersion.content`: Phase 11 evaluates reviews and owns their inner shape.
 * `childBranch` and `childPrUrl` stay null until accepted feedback has
 * somewhere to land, which is also Phase 11.
 */
export const ReviewRoundSchema = Type.Object(
  {
    id: UuidSchema,
    jobId: UuidSchema,
    roundNumber: Type.Integer({ minimum: 1 }),
    comments: Type.String(),
    verdicts: Nullable(Type.String()),
    childBranch: Nullable(Type.String({ minLength: 1, maxLength: 255 })),
    childPrUrl: Nullable(Type.String()),
    createdAt: IsoDateTimeSchema,
  },
  { additionalProperties: false, $id: 'ReviewRound' },
)

export type ReviewRound = Static<typeof ReviewRoundSchema>

export const CreateReviewRoundSchema = Type.Object(
  {
    comments: Type.String(),
  },
  { additionalProperties: false, $id: 'CreateReviewRound' },
)

export type CreateReviewRound = Static<typeof CreateReviewRoundSchema>
