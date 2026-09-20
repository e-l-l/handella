import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

import { gitUnavailable, worktreeCreationFailed } from '../domain/errors.js'
import { cliRunner, commandEnv } from './command.js'
import type { AddWorktreeInput, GitAdapter } from './git.js'

const git = cliRunner('git', gitUnavailable, commandEnv())

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
