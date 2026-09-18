import type { ApiErrorCode } from '@handella/contracts'

/**
 * The only error type the routes translate into a response body. Anything else
 * escaping the store is a bug and becomes a 500.
 */
export class DomainError extends Error {
  readonly code: ApiErrorCode
  readonly statusCode: number

  constructor(code: ApiErrorCode, statusCode: number, message: string) {
    super(message)
    this.name = 'DomainError'
    this.code = code
    this.statusCode = statusCode
  }
}

export const jobNotFound = (jobId: string): DomainError =>
  new DomainError('job_not_found', 404, `No job with id ${jobId}`)

export const attentionItemNotFound = (id: string): DomainError =>
  new DomainError(
    'attention_item_not_found',
    404,
    `No attention item with id ${id}`,
  )

export const illegalTransition = (from: string, to: string): DomainError =>
  new DomainError(
    'illegal_transition',
    409,
    `A job cannot move from ${from} to ${to}`,
  )

export const stateConflict = (expected: string): DomainError =>
  new DomainError(
    'state_conflict',
    409,
    `The job is no longer in state ${expected}`,
  )

export const transitionGuardFailed = (message: string): DomainError =>
  new DomainError('transition_guard_failed', 409, message)

export const suspensionNotAllowed = (state: string): DomainError =>
  new DomainError(
    'suspension_not_allowed',
    409,
    `A job in state ${state} cannot be suspended`,
  )
