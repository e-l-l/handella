/**
 * A pull request as GitHub currently holds it. Read rather than reported:
 * Handella asks GitHub what exists on the branch instead of believing what the
 * agent said it opened.
 */
export interface PullRequestSummary {
  baseRefName: string
  isDraft: boolean
  state: string
  url: string
}

/**
 * Read-only, and deliberately so.
 *
 * The agent opens the pull request, so Handella needs to see one rather than
 * create one — and a port with no write methods is the structural half of
 * "no workflow can merge the original PR". There is nothing here to merge,
 * close or comment with, in this phase or by accident in a later one.
 */
export interface GitHubAdapter {
  /** Whether the `gh` binary is there, so status can say so. */
  readonly configured: boolean
  /**
   * Resolves when `gh` holds a usable login and rejects with
   * `githubNotAuthenticated` when it does not. Asked before a turn rather than
   * after one: the work has nowhere to go without it.
   */
  checkAuth(): Promise<void>
  findPullRequest(
    repositoryPath: string,
    branch: string,
  ): Promise<PullRequestSummary | null>
}
