import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { githubNotAuthenticated, githubUnavailable } from '../domain/errors.js'
import {
  cliRunner,
  commandEnv,
  isMissingCommand,
  onPath,
  stderrOf,
} from './command.js'
import type { GitHubAdapter, PullRequestSummary } from './github.js'

const run = promisify(execFile)

const binary = 'gh'

// `GH_PAGER` empty because `gh` will otherwise hand a JSON answer to a pager
// that has no terminal to write to.
const githubEnv = commandEnv({ GH_PAGER: '' })

const gh = cliRunner(binary, githubUnavailable, githubEnv)

/**
 * The fields asked for, spelled once. `gh` answers with exactly these keys, and
 * asking for fewer would mean a second call the first time one is needed.
 */
const prFields = 'url,baseRefName,isDraft,state'

const asSummary = (value: unknown): PullRequestSummary | null => {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  const url = record['url']
  const baseRefName = record['baseRefName']
  const state = record['state']
  if (
    typeof url !== 'string' ||
    typeof baseRefName !== 'string' ||
    typeof state !== 'string'
  ) {
    return null
  }
  return {
    baseRefName,
    isDraft: record['isDraft'] === true,
    state,
    url,
  }
}

export const createGitHubAdapter = (): GitHubAdapter => ({
  get configured(): boolean {
    return onPath(binary)
  },

  async checkAuth() {
    try {
      // `gh auth status` exits non-zero when no host holds a usable token, so
      // the exit code is the whole answer and its text is only for the log.
      await run(binary, ['auth', 'status'], { env: githubEnv })
    } catch (error) {
      if (isMissingCommand(error)) {
        throw githubUnavailable('gh is not installed or is not on PATH', error)
      }
      throw githubNotAuthenticated(
        new Error(stderrOf(error) || String(error), { cause: error }),
      )
    }
  },

  /**
   * The branch is asked about rather than the job: GitHub is the authority on
   * whether a pull request exists, and the branch name is what both sides agree
   * on. A branch with no pull request answers null, which is an ordinary
   * outcome and not a failure.
   */
  async findPullRequest(repositoryPath, branch) {
    const { stdout } = await gh(repositoryPath, [
      'pr',
      'list',
      '--head',
      branch,
      '--state',
      'all',
      '--limit',
      '1',
      '--json',
      prFields,
    ])

    let parsed: unknown
    try {
      parsed = JSON.parse(stdout)
    } catch (error) {
      throw githubUnavailable(
        'gh answered with something that is not JSON',
        error,
      )
    }

    if (!Array.isArray(parsed) || parsed.length === 0) return null
    return asSummary(parsed[0])
  },
})
