import { mkdirSync, rmSync, writeFileSync } from 'node:fs'

import { join } from 'node:path'

import type {
  AddWorktreeInput,
  GitAdapter,
  WorktreeListing,
} from '../src/adapters/git.js'
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
  /**
   * Worktrees git knows about but this fake never cut, so a suite can put
   * residue in front of Reconciliation without a repository on disk. Keyed by
   * repository path, because that is what the listing is asked about.
   */
  readonly registered: Map<string, WorktreeListing[]>
  /**
   * Worktrees holding uncommitted work. Absent means clean, which is the
   * ordinary case and the one the guard lets through.
   */
  readonly dirty: Set<string>
  readonly pruned: string[]
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
  const pruned: string[] = []
  const heads = new Map<string, string>()
  const registered = new Map<string, WorktreeListing[]>()
  const dirty = new Set<string>()

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
    dirty,
    existingBranches: new Set(options.existingBranches ?? []),
    heads,
    failNextWith: undefined,
    fetched,
    pruned,
    registered,
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
      // Registered as well as made, so a worktree this fake cut is one the
      // listing knows about — which is what keeps it out of the orphan set.
      registered.set(input.repositoryPath, [
        ...(registered.get(input.repositoryPath) ?? []),
        { branch: input.branch, isMain: false, path: input.worktreePath },
      ])
      if (options.createsDirectories !== false) {
        mkdirSync(input.worktreePath, { recursive: true })
        // The `.git` file a real worktree carries, because that is what the
        // orphan walk recognises a worktree by: without it, a directory this
        // fake cut would be invisible to the very pass that looks for them.
        writeFileSync(
          join(input.worktreePath, '.git'),
          `gitdir: ${input.repositoryPath}/.git/worktrees/${input.branch}\n`,
        )
      }
    },

    async removeWorktree(repositoryPath, worktreePath) {
      consume()
      removed.push(worktreePath)
      heads.delete(worktreePath)
      registered.set(
        repositoryPath,
        (registered.get(repositoryPath) ?? []).filter(
          (listing) => listing.path !== worktreePath,
        ),
      )
      // Really removed, because the orphan walk reads the filesystem and a
      // directory this fake left behind would be reported as residue.
      rmSync(worktreePath, { force: true, recursive: true })
    },

    async listWorktrees(repositoryPath) {
      consume()
      return [
        { branch: 'dev', isMain: true, path: repositoryPath },
        ...(registered.get(repositoryPath) ?? []),
      ]
    },

    async pruneWorktrees(repositoryPath) {
      consume()
      pruned.push(repositoryPath)
    },

    async isWorktreeClean(worktreePath) {
      consume()
      return !dirty.has(worktreePath)
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
