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

/**
 * The two dispatch preconditions, spelled once. Dispatch asks them before it
 * calls Linear and the claim asks them again inside its transaction, so the
 * same refusal is reachable by two paths; two spellings would answer the same
 * question with two different sentences depending on which path got there.
 */
export const dispatchNeedsRepository = (): DomainError =>
  transitionGuardFailed(
    'A job cannot be dispatched until it names a repository',
  )

export const dispatchNeedsLinearIssue = (): DomainError =>
  transitionGuardFailed(
    'A job cannot be dispatched without the Linear issue that names its branch',
  )

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

export const repositoryNotFound = (repositoryId: string): DomainError =>
  new DomainError(
    'repository_not_found',
    404,
    `No repository with id ${repositoryId}`,
  )

/**
 * A settled job keeps its history and lets the repository go, nulling its
 * column. A live job is still working in a worktree cut from this checkout, so
 * removing it underneath would strand that work.
 */
export const repositoryInUse = (
  repositoryId: string,
  jobId: string,
): DomainError =>
  new DomainError(
    'repository_in_use',
    409,
    `Repository ${repositoryId} is still being worked in by job ${jobId}`,
  )

/**
 * Another live Job already holds this Canonical Branch. ADR 0004 recomputes
 * the suffix while claiming, so reaching this means two dispatches raced and
 * this one lost.
 */
export const canonicalBranchClaimed = (branch: string): DomainError =>
  new DomainError(
    'canonical_branch_claimed',
    409,
    `Another job already holds the branch ${branch}`,
  )

/**
 * masterplan.md:46 — the branch exists in git but no live Job owns it, so
 * Handella cannot tell whose work is on it and will not write over it.
 */
export const canonicalBranchUnowned = (branch: string): DomainError =>
  new DomainError(
    'canonical_branch_unowned',
    409,
    `The branch ${branch} already exists but no job owns it; delete it or rename the Linear branch`,
  )

/** Git's own text travels as `cause` so the local log keeps it. */
export const gitUnavailable = (message: string, cause?: unknown): DomainError =>
  new DomainError('git_unavailable', 502, message, { cause })

export const worktreeCreationFailed = (
  branch: string,
  cause?: unknown,
): DomainError =>
  new DomainError(
    'worktree_creation_failed',
    502,
    `The worktree for ${branch} could not be created`,
    { cause },
  )
