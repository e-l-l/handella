import { join } from 'node:path'

import { canTransition, type Job } from '@handella/contracts'

import type { GitAdapter } from '../adapters/git.js'
import type { LinearAdapter } from '../adapters/linear.js'
import {
  canonicalBranchUnowned,
  dispatchNeedsLinearIssue,
  dispatchNeedsRepository,
  illegalTransition,
} from './errors.js'
import type { Store } from './store.js'

export interface DispatchOutcome {
  /**
   * The Job as the claim left it: queued, its Canonical Branch fixed, its
   * worktree not yet cut. This is what the 202 carries.
   */
  job: Job
  /**
   * Resolves once the worktree exists, or once the claim has been given back.
   * Rejects only if the compensating write itself fails, which is a bug.
   *
   * It may wait first: cuts in one checkout are taken one at a time, so a Job
   * dispatched alongside others is queued behind them before git runs for it.
   */
  worktree: Promise<Job>
}

export interface Dispatcher {
  dispatch(jobId: string): Promise<DispatchOutcome>
}

/**
 * ADR 0006: fixed under `.data`, never configurable. A root inside the target
 * checkout would put the worktree and the main working tree under one sandbox
 * root, and nothing would warn the Handler that containment had gone.
 *
 * A Linear branch name carries slashes, which nest as directories. ADR 0004
 * has already made the name unique per Job, so the leaf cannot collide.
 */
export const worktreePathFor = (
  worktreeRoot: string,
  repositoryId: string,
  canonicalBranch: string,
): string => join(worktreeRoot, repositoryId, canonicalBranch)

interface DispatcherOptions {
  git: GitAdapter
  linear: LinearAdapter
  store: Store
  worktreeRoot: string
}

export function createDispatcher(options: DispatcherOptions): Dispatcher {
  const { git, linear, store, worktreeRoot } = options

  const cutWorktree = async (
    job: Job,
    repositoryPath: string,
  ): Promise<Job> => {
    // Narrowed by the claim, which refuses to commit without either.
    const canonicalBranch = job.canonicalBranch ?? ''
    const repositoryId = job.repositoryId ?? ''
    const worktreePath = worktreePathFor(
      worktreeRoot,
      repositoryId,
      canonicalBranch,
    )

    try {
      // The base is refreshed rather than assumed: a worktree cut from a stale
      // remote branch is a pull request that starts behind.
      await git.fetchBase(repositoryPath, job.baseBranch)

      // The claim already ruled out every live Job, so a branch that exists
      // here belongs to nobody Handella knows about — masterplan.md:46's
      // "already owned by an unknown job". Handella will not write over it.
      if (await git.branchExists(repositoryPath, canonicalBranch)) {
        throw canonicalBranchUnowned(canonicalBranch)
      }

      await git.addWorktree({
        base: job.baseBranch,
        branch: canonicalBranch,
        repositoryPath,
        worktreePath,
      })
    } catch (error) {
      return store.abandonDispatch({
        jobId: job.id,
        reason: error instanceof Error ? error.message : String(error),
      })
    }

    return store.recordWorktree({ jobId: job.id, worktreePath })
  }

  /**
   * One cut at a time per checkout. `git fetch` and `git worktree add` both
   * take locks inside the repository they run in, and Intake dispatches a
   * whole Selection at once — two cuts racing in one checkout is the ordinary
   * case now rather than a Handler clicking twice. Keyed by the repository
   * path, so different checkouts still cut alongside each other.
   *
   * The chain is the whole of the serialisation, so nothing may break it: what
   * is stored as the tail is a promise that cannot reject. `cutWorktree`
   * compensates rather than throwing, and the `catch` is for the bug its own
   * doc comment describes.
   */
  const cuts = new Map<string, Promise<unknown>>()

  const queueCut = (job: Job, repositoryPath: string): Promise<Job> => {
    const after = cuts.get(repositoryPath) ?? Promise.resolve()
    const cut = after.then(() => cutWorktree(job, repositoryPath))

    // One entry per checkout, each replaced by the cut behind it, so the map
    // is as big as the Handler's repository list and no bigger.
    cuts.set(
      repositoryPath,
      cut.catch(() => undefined),
    )
    return cut
  }

  return {
    async dispatch(jobId) {
      const job = store.getJob(jobId)

      // Asked before Linear rather than after: a job that can never be
      // dispatched should say so without a network call, and the claim repeats
      // every one of these inside its transaction anyway.
      if (job.repositoryId === null) throw dispatchNeedsRepository()
      if (job.linearIssueId === null) throw dispatchNeedsLinearIssue()

      if (!canTransition(job.state, 'queued')) {
        throw illegalTransition(job.state, 'queued')
      }

      // Re-read rather than trusted: Linear rewrites a branch name when an
      // issue is retitled, and Intake stored what the Handler saw. ADR 0004
      // applies the suffix to whatever Linear says now.
      //
      // Outside the transaction because better-sqlite3's are synchronous, and
      // because a claim held open across a network call is a claim held open
      // for as long as Linear takes to answer.
      const issue = await linear.getIssue(job.linearIssueId)

      const claim = store.claimForDispatch({
        branchName: issue.branchName,
        jobId,
      })

      return {
        job: claim.job,
        worktree: queueCut(claim.job, claim.repository.path),
      }
    },
  }
}
