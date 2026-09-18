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
  /** What Intake offers as base branches, in place of Phase 3's guesses. */
  listRemoteBranches(repositoryPath: string): Promise<string[]>
  removeWorktree(repositoryPath: string, worktreePath: string): Promise<void>
}
