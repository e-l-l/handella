import { isAwaitingMerge, type Job } from '@handella/contracts'

import type { GitAdapter } from '../adapters/git.js'
import type { GitHubAdapter } from '../adapters/github.js'
import { messageOf } from './errors.js'
import type { Store } from './store.js'

/**
 * Whether the pull request on a Job's Canonical Branch has been merged, and
 * what to do about the worktree if it has.
 *
 * Its own module rather than part of Reconciliation because two callers need
 * exactly this and nothing else around it: the timer, which asks about every
 * Job it is watching, and the Handler, who has just merged one and does not
 * want to wait five minutes. A Handler pressing a button wants an upstream
 * failure as their response rather than as a line in a log, so this throws
 * where Reconciliation would record — and it holds no logger and no timer of
 * its own.
 */
export interface MergeCheck {
  /**
   * Asks GitHub about one Job and answers with the Job as the question left
   * it: unchanged when the pull request is not merged, `merged` when it is.
   */
  check(jobId: string): Promise<Job>
}

interface MergeCheckOptions {
  git: GitAdapter
  github: GitHubAdapter
  store: Store
}

export function createMergeCheck(options: MergeCheckOptions): MergeCheck {
  const { git, github, store } = options

  /**
   * The check each Job already has running, so two callers asking at once ask
   * once.
   *
   * There are exactly two callers and they collide by design: the timer sweeps
   * every watched Job, and the Handler presses "Check merge" because they do
   * not want to wait for it. Without this they both read a worktree that is
   * clean, both ask git to remove it, and the slower one is told a directory
   * it was never going to remove is missing — a failure item about work that
   * succeeded.
   */
  const inFlight = new Map<string, Promise<Job>>()

  /**
   * Removes the merged Job's worktree, or records why it did not.
   *
   * Guarded rather than forced, and the guards are the whole point: this is
   * the only place Handella deletes a directory an agent has been writing in,
   * and work that never reached the pull request is work the Handler has never
   * seen. Refusing leaves a merged Job with its worktree still on disk, which
   * the next pass reports — a recoverable failure. Removing wrongly is not
   * recoverable at all (docs/adr/0013).
   */
  const tidyWorktree = async (job: Job): Promise<void> => {
    const worktreePath = job.worktreePath
    if (worktreePath === null) return

    const refuse = (reason: string): void => {
      store.failCleanup({
        body: [`The worktree at ${worktreePath} was left in place.`, '', reason]
          .join('\n')
          .trim(),
        jobId: job.id,
      })
    }

    if (job.repositoryId === null) {
      refuse(
        'The repository it was cut from is no longer registered, so Handella cannot ask git to remove it. Remove it by hand from the checkout it belongs to.',
      )
      return
    }

    try {
      const repository = store.getRepository(job.repositoryId)

      // The branch first, because a worktree that has been moved onto some
      // other branch is not the one this Job worked in, whatever the column
      // says — the same drift assertion the implementation pass makes before
      // it believes a pull request.
      const head = await git.headBranch(worktreePath)
      if (head !== job.canonicalBranch) {
        refuse(
          `It is on ${head} rather than ${job.canonicalBranch ?? '(no branch)'}, so what is in it is not what this job merged.`,
        )
        return
      }

      if (!(await git.isWorktreeClean(worktreePath))) {
        refuse(
          'It still holds uncommitted changes, which never reached the pull request. Look at them before removing it.',
        )
        return
      }

      await git.removeWorktree(repository.path, worktreePath)
    } catch (error) {
      refuse(`git could not remove it: ${messageOf(error)}`)
      return
    }

    // Only now: the column is what says where the worktree was, and clearing
    // it before the directory was gone would lose the last record of it.
    store.releaseWorktree({ jobId: job.id })
  }

  const ask = async (jobId: string): Promise<Job> => {
    const job = store.getJob(jobId)

    // Nothing to ask about: a Job that has not opened a pull request, or one
    // the Handler is holding. A stop means leave it alone, and removing its
    // worktree because the branch happened to land is the opposite of that.
    if (!isAwaitingMerge(job)) return job
    if (job.worktreePath === null || job.canonicalBranch === null) return job

    // Asked from inside the worktree, which is where `gh` can see the
    // remote — and asked before anything is removed, because afterwards
    // there is nowhere left to ask from.
    const pullRequest = await github.findPullRequest(
      job.worktreePath,
      job.canonicalBranch,
    )

    if (pullRequest === null || pullRequest.state !== 'MERGED') return job

    await tidyWorktree(store.confirmMerge({ jobId }))

    // Read back rather than answered from the write: the removal may have
    // cleared the worktree column after `confirmMerge` returned.
    return store.getJob(jobId)
  }

  return {
    check(jobId) {
      const running = inFlight.get(jobId)
      if (running !== undefined) return running

      const work = ask(jobId).finally(() => inFlight.delete(jobId))
      inFlight.set(jobId, work)
      return work
    },
  }
}
