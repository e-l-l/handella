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

/**
 * Whatever this error said, for the writes that have to record something the
 * Handler will read.
 *
 * Here because three components need it and all three of them are wording a
 * failure for the same audience: a reason on a job, a body on an attention
 * item, a line in a log. `stderrOf` in the adapters was centralised for this
 * reason already; this is the domain's half of it.
 */
export const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

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

/** Codex's own text travels as `cause`, on the same terms as git's. */
export const codexUnavailable = (
  message: string,
  cause?: unknown,
): DomainError => new DomainError('codex_unavailable', 502, message, { cause })

/**
 * The pass ran and did not produce a plan: Codex reported a failed turn, exited
 * non-zero, or was stopped. Upstream rather than a bad request, which is what
 * puts the job into `stoppedBySystem` instead of answering the Handler.
 */
export const codexPlanningFailed = (
  message: string,
  cause?: unknown,
): DomainError =>
  new DomainError('codex_planning_failed', 502, message, { cause })

/**
 * Implementation happens in the session that planned, so the plan the Handler
 * approved is a conversation to resume. Without the id there is no such
 * conversation.
 */
export const codexSessionMissing = (jobId: string): DomainError =>
  new DomainError(
    'codex_session_missing',
    409,
    `Job ${jobId} has no Codex session to implement in`,
  )

/**
 * Codex answered with something the report schema rejects, despite having been
 * given that schema. Upstream, not a bug here — the same class of failure as a
 * non-zero exit, and it takes the same path.
 */
export const implementationReportInvalid = (
  message: string,
  cause?: unknown,
): DomainError =>
  new DomainError('implementation_report_invalid', 502, message, { cause })

export const attemptNotFound = (attemptId: string): DomainError =>
  new DomainError('attempt_not_found', 404, `No attempt with id ${attemptId}`)

/** The GitHub CLI's own text travels as `cause`, on the same terms as git's. */
export const githubUnavailable = (
  message: string,
  cause?: unknown,
): DomainError => new DomainError('github_unavailable', 502, message, { cause })

/**
 * `gh` is installed but holds no usable login. Asked before an implementation
 * pass rather than discovered after one: the agent opens the pull request, so a
 * logged-out `gh` is only visible once ninety minutes of work has nowhere to go.
 */
export const githubNotAuthenticated = (cause?: unknown): DomainError =>
  new DomainError(
    'github_not_authenticated',
    503,
    'The GitHub CLI is not logged in; run `gh auth login` and resume the job',
    { cause },
  )

/**
 * Version 1 is seeded when a database is opened, so an installation with no
 * Runbook has had one deleted underneath it. Approval refuses rather than
 * snapshotting nothing: a job that cannot say what it will execute is not
 * approved for implementation.
 */
export const runbookVersionNotFound = (): DomainError =>
  new DomainError(
    'runbook_version_not_found',
    409,
    'This installation has no runbook to snapshot',
  )

/**
 * The path is well-formed but does not name a checkout. Refused on the way in
 * rather than discovered at dispatch, where the first sign of a typo is a
 * worktree that cannot be cut for a job the Handler has already committed to.
 */
export const repositoryPathInvalid = (message: string): DomainError =>
  new DomainError('repository_path_invalid', 400, message)

/**
 * A request that did not come from a page Handella served. The dashboard and
 * the API share one loopback origin (ADR 0001), so a same-origin call is the
 * only legitimate one; anything else is another site reaching for a service it
 * can see only because it runs on the Handler's own machine.
 */
export const crossOriginRefused = (): DomainError =>
  new DomainError(
    'cross_origin_refused',
    403,
    'This request did not come from Handella',
  )

/**
 * There is no native dialog to open. The Handler can still type a path, so
 * this refuses the convenience and not the operation.
 */
export const folderPickerUnavailable = (
  message: string,
  cause?: unknown,
): DomainError =>
  new DomainError('folder_picker_unavailable', 502, message, { cause })

/**
 * There is no terminal Handella can open, or the one it found refused to.
 * A 502 for the reason `folderPickerUnavailable` is one: the operation itself
 * is fine, the convenience around it is not, and the worktree path is on the
 * job page for a Handler who would rather open their own shell.
 */
export const terminalUnavailable = (
  message: string,
  cause?: unknown,
): DomainError =>
  new DomainError('terminal_unavailable', 502, message, { cause })

/**
 * Asked to open a shell in a worktree that is not there. Either the Job has
 * not been dispatched, or the cut has not finished — both are answers about
 * where the Job is rather than failures, so this reads as a conflict.
 */
export const worktreeNotCut = (jobId: string): DomainError =>
  new DomainError(
    'worktree_not_cut',
    409,
    `Job ${jobId} has no worktree yet, so there is nothing to open a shell in`,
  )
