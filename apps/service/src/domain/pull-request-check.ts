import type { StartableJob } from '@handella/contracts'

import type { GitAdapter } from '../adapters/git.js'
import type { GitHubAdapter } from '../adapters/github.js'

/**
 * Either the pull request Handella found, or why it accepted none. Both keys
 * always present, as `Nullable` does everywhere else here, so the caller
 * destructures rather than probing with `in`.
 */
export type PullRequestVerdict =
  { reason: null; url: string } | { reason: string; url: null }

export interface PullRequestCheck {
  verify(job: StartableJob): Promise<PullRequestVerdict>
}

/**
 * What Handella can see for itself, which is the only thing that completes a
 * Job (docs/adr/0015). Asked by the scheduler when its own turn ends and by
 * Session Watch when a turn the Handler drove ends, so it is one module and
 * not two spellings of the same question — the same reason the merge check is
 * its own (docs/adr/0013).
 *
 * The worktree's HEAD first, because a pull request on some other branch is
 * worse than none; then GitHub, which is the only authority on whether a pull
 * request exists.
 */
export const createPullRequestCheck = (options: {
  git: GitAdapter
  github: GitHubAdapter
}): PullRequestCheck => ({
  async verify(job) {
    const branch = job.canonicalBranch
    if (branch === null) {
      return {
        reason: 'The job has no canonical branch to look for',
        url: null,
      }
    }

    const head = await options.git.headBranch(job.worktreePath)
    if (head !== branch) {
      return {
        reason: `The worktree is on ${head} rather than ${branch}, so no pull request was accepted`,
        url: null,
      }
    }

    const pullRequest = await options.github.findPullRequest(
      job.worktreePath,
      branch,
    )
    if (pullRequest === null) {
      return { reason: `No pull request was opened for ${branch}`, url: null }
    }
    if (pullRequest.state !== 'OPEN') {
      return {
        reason: `The pull request for ${branch} is ${pullRequest.state.toLowerCase()}`,
        url: null,
      }
    }
    if (pullRequest.isDraft) {
      return {
        reason: `The pull request for ${branch} is a draft rather than ready for review`,
        url: null,
      }
    }
    if (pullRequest.baseRefName !== job.baseBranch) {
      return {
        reason: `The pull request for ${branch} targets ${pullRequest.baseRefName} rather than ${job.baseBranch}`,
        url: null,
      }
    }

    return { reason: null, url: pullRequest.url }
  },
})
