import { mkdirSync } from 'node:fs'

import type { AddWorktreeInput, GitAdapter } from '../src/adapters/git.js'
import { gitUnavailable } from '../src/domain/errors.js'

export interface FakeGitAdapter extends GitAdapter {
  /** Every worktree this fake was asked to cut, in order. */
  readonly added: AddWorktreeInput[]
  /** Branches it should claim already exist, for the unowned-branch path. */
  existingBranches: Set<string>
  readonly fetched: { base: string; repositoryPath: string }[]
  /** What the next git call should fail with, for the compensation path. */
  failNextWith: Error | undefined
  /**
   * What each worktree is checked out at. Exposed rather than private because
   * a suite that did not cut the worktree through this same fake still has to
   * be able to say what Handella would find there.
   */
  readonly heads: Map<string, string>
  readonly removed: string[]
}

interface FakeGitOptions {
  /**
   * Whether `addWorktree` makes the directory. On by default, so a test can
   * assert the path is real without a repository behind it.
   */
  createsDirectories?: boolean
  existingBranches?: readonly string[]
  remoteBranches?: readonly string[]
}

/**
 * Enough git for the store and scheduler suites, which care about ordering and
 * compensation rather than about git. What git actually does is proven against
 * real repositories in `git-cli.test.ts`; nothing here stands in for that.
 */
export function createFakeGitAdapter(
  options: FakeGitOptions = {},
): FakeGitAdapter {
  const added: AddWorktreeInput[] = []
  const fetched: { base: string; repositoryPath: string }[] = []
  const removed: string[] = []
  const heads = new Map<string, string>()

  // One armed failure, spent by whichever call reaches it first.
  const consume = (): void => {
    const failure = fake.failNextWith
    if (failure !== undefined) {
      fake.failNextWith = undefined
      throw failure
    }
  }

  const fake: FakeGitAdapter = {
    added,
    existingBranches: new Set(options.existingBranches ?? []),
    heads,
    failNextWith: undefined,
    fetched,
    removed,

    async fetchBase(repositoryPath, base) {
      consume()
      fetched.push({ base, repositoryPath })
    },

    async branchExists(_repositoryPath, branch) {
      consume()
      return fake.existingBranches.has(branch)
    },

    async addWorktree(input) {
      consume()
      added.push(input)
      fake.existingBranches.add(input.branch)
      heads.set(input.worktreePath, input.branch)
      if (options.createsDirectories !== false) {
        mkdirSync(input.worktreePath, { recursive: true })
      }
    },

    async removeWorktree(_repositoryPath, worktreePath) {
      consume()
      removed.push(worktreePath)
      heads.delete(worktreePath)
    },

    async headBranch(worktreePath) {
      consume()
      return heads.get(worktreePath) ?? 'dev'
    },

    async listRemoteBranches() {
      consume()
      return [...(options.remoteBranches ?? ['dev', 'main'])]
    },
  }

  return fake
}

/** The shape `git-cli` raises when the binary or the repository is not there. */
export const aGitFailure = (message = 'fatal: not a git repository'): Error =>
  gitUnavailable(message)
