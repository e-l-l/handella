import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

import { gitUnavailable, worktreeCreationFailed } from '../domain/errors.js'
import { cliRunner, commandEnv } from './command.js'
import type { AddWorktreeInput, GitAdapter, WorktreeListing } from './git.js'

const git = cliRunner('git', gitUnavailable, commandEnv())

/**
 * One `key value` line out of a `--porcelain` block, or undefined when the
 * block has none. Spelling the key once is what keeps the slice and the test
 * that finds the line from disagreeing about the space between them.
 */
const field = (lines: readonly string[], key: string): string | undefined =>
  lines.find((line) => line.startsWith(`${key} `))?.slice(key.length + 1)

export const createGitAdapter = (): GitAdapter => ({
  async fetchBase(repositoryPath, base) {
    await git(repositoryPath, ['fetch', 'origin', base])
  },

  /**
   * Local and remote asked in one spawn. `for-each-ref` takes both patterns and
   * exits zero either way, so "taken" is a non-empty answer rather than a
   * caught failure — unlike `show-ref`, which signals "no" by exiting non-zero
   * and so needs one process per ref plus a swallowed error for the common case.
   */
  async branchExists(repositoryPath, branch) {
    const { stdout } = await git(repositoryPath, [
      'for-each-ref',
      '--count=1',
      '--format=%(refname)',
      `refs/heads/${branch}`,
      `refs/remotes/origin/${branch}`,
    ])
    return stdout.trim() !== ''
  },

  /**
   * The parent is created first: a Linear branch name carries slashes, which
   * nest as directories, and `git worktree add` will not make them itself.
   */
  async addWorktree(input: AddWorktreeInput) {
    mkdirSync(dirname(input.worktreePath), { recursive: true })

    try {
      await git(input.repositoryPath, [
        'worktree',
        'add',
        input.worktreePath,
        '-b',
        input.branch,
        `origin/${input.base}`,
      ])
    } catch (error) {
      throw worktreeCreationFailed(input.branch, error)
    }
  },

  async removeWorktree(repositoryPath, worktreePath) {
    await git(repositoryPath, ['worktree', 'remove', worktreePath])
  },

  /**
   * `--porcelain` rather than the human listing, whose columns are alignment
   * rather than structure and whose branch appears in square brackets that a
   * branch name may itself contain.
   */
  async listWorktrees(repositoryPath) {
    const { stdout } = await git(repositoryPath, [
      'worktree',
      'list',
      '--porcelain',
    ])

    return (
      stdout
        .split('\n\n')
        .map((block) => block.split('\n').filter((line) => line !== ''))
        .filter((lines) => lines.length > 0)
        // The checkout itself is always the first block, and it is the one
        // entry that is never a Job's worktree.
        .map((lines, position) => {
          const path = field(lines, 'worktree')
          const ref = field(lines, 'branch')

          return path === undefined
            ? undefined
            : {
                // Stripped where the prefix is there rather than by length, so
                // a ref that is not under `refs/heads/` comes back as git
                // spelled it instead of losing its first nineteen characters.
                branch: ref?.replace(/^refs\/heads\//, '') ?? null,
                isMain: position === 0,
                path,
              }
        })
        .filter((listing): listing is WorktreeListing => listing !== undefined)
    )
  },

  async pruneWorktrees(repositoryPath) {
    await git(repositoryPath, ['worktree', 'prune'])
  },

  /**
   * Untracked files count, which is why this is `status` and not
   * `diff --quiet`: an agent that wrote a file and never added it has still
   * left work behind, and that is exactly the work a removal would destroy.
   */
  async isWorktreeClean(worktreePath) {
    const { stdout } = await git(worktreePath, ['status', '--porcelain'])
    return stdout.trim() === ''
  },

  async headBranch(worktreePath) {
    const { stdout } = await git(worktreePath, [
      'rev-parse',
      '--abbrev-ref',
      'HEAD',
    ])
    return stdout.trim()
  },

  async listRemoteBranches(repositoryPath) {
    // `lstrip=3` drops refs/remotes/origin and leaves the branch name, which
    // `short` does not: it abbreviates refs/remotes/origin/HEAD to bare
    // `origin`, and a branch called origin is not what that means.
    const { stdout } = await git(repositoryPath, [
      'for-each-ref',
      '--format=%(refname:lstrip=3)',
      'refs/remotes/origin',
    ])

    return stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '' && line !== 'HEAD')
  },
})
