import { Type, type Static } from 'typebox'

import { isOneOf, literalUnion } from './primitives.js'

export const apiErrorCodes = [
  'job_not_found',
  'attention_item_not_found',
  'illegal_transition',
  'state_conflict',
  'transition_guard_failed',
  'suspension_not_allowed',
  'validation_failed',
  'internal_error',
] as const

export type ApiErrorCode = (typeof apiErrorCodes)[number]

export const ApiErrorCodeSchema = literalUnion(apiErrorCodes)

export const ApiErrorSchema = Type.Object(
  {
    code: ApiErrorCodeSchema,
    message: Type.String(),
  },
  { additionalProperties: false, $id: 'ApiError' },
)

export type ApiError = Static<typeof ApiErrorSchema>

export const isApiErrorCode = isOneOf(apiErrorCodes)
