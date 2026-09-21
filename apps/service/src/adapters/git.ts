/**
 * The one place Handella runs git. Everything above it deals in absolute paths
 * and `DomainError`s, which is what lets a deterministic fake stand in for the
 * store and scheduler suites without a repository on disk.
 *
 * Unlike the Linear port there is no "unconfigured" null object: git is a local
 * binary rather than an integration the Handler opts into, and which checkout
 * to work in is a row in `repositories`, not a setting. A missing binary is a
 * typed failure, not a mode.
 */
export interface AddWorktreeInput {
  /** The branch the worktree is cut from, as named on the remote. */
  base: string
  /** The Canonical Branch, created by this call. */
  branch: string
  repositoryPath: string
  worktreePath: string
}

/**
 * A worktree git itself knows about, which is not the same set as the
 * directories on disk: git keeps a registration after a directory is deleted,
 * and a cut that died between making the directory and registering it leaves
 * a directory git never heard of. Reconciliation reads both.
 */
export interface WorktreeListing {
  /** Null for a detached HEAD, which a Job's worktree should never be. */
  branch: string | null
  /** Whether this is the checkout itself rather than a worktree cut from it. */
  isMain: boolean
  path: string
}

export interface GitAdapter {
  /**
   * Creates the Canonical Branch and checks it out in its own directory.
   * Fails rather than reusing anything: the branch must not already exist.
   */
  addWorktree(input: AddWorktreeInput): Promise<void>
  /** Whether the name is taken locally or on the remote. */
  branchExists(repositoryPath: string, branch: string): Promise<boolean>
  /** Brings the base branch up to date before anything is cut from it. */
  fetchBase(repositoryPath: string, base: string): Promise<void>
  /**
   * The branch a worktree is actually on. The drift assertion: an agent that
   * cuts its own branch inside the worktree is invisible without this.
   */
  headBranch(worktreePath: string): Promise<string>
  /**
   * Whether the worktree holds nothing uncommitted, untracked included.
   *
   * Asked before a worktree is removed after a merge: work the agent left
   * behind never reached the pull request, so deleting the directory would be
   * the one way Handella could destroy something (docs/adr/0013).
   */
  isWorktreeClean(worktreePath: string): Promise<boolean>
  /** What Intake offers as base branches, in place of Phase 3's guesses. */
  listRemoteBranches(repositoryPath: string): Promise<string[]>
  /** Every worktree this checkout has registered, itself included. */
  listWorktrees(repositoryPath: string): Promise<WorktreeListing[]>
  /**
   * Drops the registrations of worktrees whose directories are already gone.
   *
   * Metadata only, which is what makes it safe to do unprompted: it deletes
   * git's record of a directory that no longer exists and can never delete a
   * directory that does.
   */
  pruneWorktrees(repositoryPath: string): Promise<void>
  removeWorktree(repositoryPath: string, worktreePath: string): Promise<void>
}
