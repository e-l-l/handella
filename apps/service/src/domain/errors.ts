import type { ApiErrorCode } from '@handella/contracts'

/**
 * The only error type the routes translate into a response body. Anything else
 * escaping the store is a bug and becomes a 500.
 */
export class DomainError extends Error {
  readonly code: ApiErrorCode
  readonly statusCode: number

  constructor(
    code: ApiErrorCode,
    statusCode: number,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options)
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

/**
 * An integration Handella can run without says so rather than refusing to
 * start, so the dashboard offers a setup notice instead of a failed request.
 */
export const linearNotConfigured = (): DomainError =>
  new DomainError(
    'linear_not_configured',
    503,
    'Linear is not configured; set HANDELLA_LINEAR_API_KEY in .env and restart Handella',
  )

/**
 * Upstream text never reaches the wire: Linear's messages can carry request
 * and workspace detail. The original travels as `cause` so the local log keeps
 * it, and 502 rather than 401 because it is Handella's key that was rejected,
 * not the Handler's browser.
 */
export const linearUnauthorized = (cause?: unknown): DomainError =>
  new DomainError(
    'linear_unauthorized',
    502,
    'Linear rejected the configured API key',
    { cause },
  )

export const linearRateLimited = (cause?: unknown): DomainError =>
  new DomainError(
    'linear_rate_limited',
    429,
    'Linear is rate limiting Handella; try again shortly',
    { cause },
  )

export const linearUnavailable = (cause?: unknown): DomainError =>
  new DomainError('linear_unavailable', 502, 'Linear could not be reached', {
    cause,
  })

export const linearIssueNotFound = (issueId: string): DomainError =>
  new DomainError(
    'linear_issue_not_found',
    404,
    `Linear has no visible issue ${issueId}`,
  )

export const linearIssueNotActionable = (
  identifier: string,
  stateName: string,
): DomainError =>
  new DomainError(
    'linear_issue_not_actionable',
    409,
    `${identifier} is ${stateName} and has no work left to supervise`,
  )

/**
 * CONTEXT.md: an Actionable Issue assigned to the Handler is what Intake
 * offers. 409 rather than 404, because the issue exists and is readable; it is
 * simply not theirs to supervise.
 */
export const linearIssueNotAssigned = (identifier: string): DomainError =>
  new DomainError(
    'linear_issue_not_assigned',
    409,
    `${identifier} is not assigned to you`,
  )

export const linearIssueAlreadyLinked = (
  identifier: string,
  jobId: string,
): DomainError =>
  new DomainError(
    'linear_issue_already_linked',
    409,
    `${identifier} is already the Linear issue for job ${jobId}`,
  )

/** Linear rejecting the Handler's issue details is a bad request, not an outage. */
export const validationFailed = (
  message: string,
  cause?: unknown,
): DomainError => new DomainError('validation_failed', 400, message, { cause })
