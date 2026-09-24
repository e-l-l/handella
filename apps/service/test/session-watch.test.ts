import { afterEach, describe, expect, it } from 'vitest'

import { createPullRequestCheck } from '../src/domain/pull-request-check.js'
import {
  createSessionWatch,
  type SessionWatch,
} from '../src/domain/session-watch.js'
import type { TestContext } from './helpers.js'
import {
  aDispatchedQueue,
  aJobAwaitingApproval,
  aPullRequest,
  anApprovedJob,
  cleanupTestContexts,
  createFakeGitAdapter,
  createFakeGitHubAdapter,
  createTestContext,
  type FakeGitHubAdapter,
} from './helpers.js'
import {
  createFakeCodexSessions,
  rolloutLines,
  type FakeCodexSessions,
} from './codex-sessions-fake.js'

afterEach(cleanupTestContexts)

interface Harness {
  codexSessions: FakeCodexSessions
  github: FakeGitHubAdapter
  watch: SessionWatch
}

/**
 * The watcher over a real store, with the worktree's HEAD already agreeing
 * with the job's branch — what it would be while a session works on it.
 */
const aWatcher = (
  context: TestContext,
  jobIds: readonly string[],
  options: {
    pullRequests?: Record<string, ReturnType<typeof aPullRequest>>
  } = {},
): Harness => {
  const codexSessions = createFakeCodexSessions()
  const github = createFakeGitHubAdapter(
    options.pullRequests === undefined
      ? {}
      : { pullRequests: options.pullRequests },
  )
  const git = createFakeGitAdapter()

  for (const jobId of jobIds) {
    const job = context.store.getJob(jobId)
    if (job.worktreePath !== null && job.canonicalBranch !== null) {
      git.heads.set(job.worktreePath, job.canonicalBranch)
    }
  }

  return {
    codexSessions,
    github,
    watch: createSessionWatch({
      codexSessions,
      pullRequests: createPullRequestCheck({ git, github }),
      store: context.store,
    }),
  }
}

const branchOf = (context: TestContext, jobId: string): string => {
  const branch = context.store.getJob(jobId).canonicalBranch
  if (branch === null) throw new Error('The job has no canonical branch')
  return branch
}

const handoffs = (context: TestContext, jobId: string) =>
  context.store
    .listAttentionItems()
    .filter((item) => item.jobId === jobId && item.kind === 'handlerInput')

describe('approving in the terminal', () => {
  it('moves the job on when the session begins changing files', async () => {
    const { context, jobId } = await aJobInReview()
    const harness = aWatcher(context, [jobId])
    harness.codexSessions.append(
      'session-1',
      rolloutLines.turnStarted(),
      rolloutLines.fileChanged(),
    )

    await harness.watch.pass()

    const job = context.store.getJob(jobId)
    expect(job.state).toBe('implementing')
    // The runbook is frozen on this path too, because the guard on
    // `implementing` reads it and there are two ways in.
    expect(context.store.listRunbookSnapshots(jobId)).toHaveLength(1)
    expect(context.store.listJobTransitions(jobId).at(-1)).toMatchObject({
      actor: 'system',
      toState: 'implementing',
    })
  })

  it('leaves a job alone while the Handler is only asking about the plan', async () => {
    const { context, jobId } = await aJobInReview()
    const harness = aWatcher(context, [jobId])
    // A question and an answer, and nothing written in the worktree.
    harness.codexSessions.append(
      'session-1',
      rolloutLines.turnStarted(),
      rolloutLines.userMessage(),
      rolloutLines.turnCompleted('turn-1', 'Because the fixture races.'),
    )

    await harness.watch.pass()

    expect(context.store.getJob(jobId).state).toBe('planReview')
    expect(context.store.listRunbookSnapshots(jobId)).toEqual([])
  })

  it('catches an implementation that wrote no patch, by its pull request', async () => {
    const { context, jobId } = await aJobInReview()
    const branch = branchOf(context, jobId)
    const harness = aWatcher(context, [jobId], {
      pullRequests: { [branch]: aPullRequest() },
    })
    harness.codexSessions.append('session-1', rolloutLines.turnCompleted())

    await harness.watch.pass()

    // Two edges in one pass: the approval it never saw, and the pull request
    // that proves it happened.
    const job = context.store.getJob(jobId)
    expect(job.state).toBe('prOpen')
    expect(job.originalPrUrl).toBe('https://github.com/acme/monorepo/pull/41')
  })
})

describe('a turn ending in the terminal', () => {
  it('opens the pull request GitHub shows', async () => {
    const context = createTestContext()
    const jobId = await anImplementingJob(context)
    const branch = branchOf(context, jobId)
    const harness = aWatcher(context, [jobId], {
      pullRequests: { [branch]: aPullRequest() },
    })
    harness.codexSessions.append('session-1', rolloutLines.turnCompleted())

    await harness.watch.pass()

    expect(context.store.getJob(jobId).state).toBe('prOpen')
  })

  it('asks the Handler once, however many turns end without one', async () => {
    const context = createTestContext()
    const jobId = await anImplementingJob(context)
    const harness = aWatcher(context, [jobId])

    harness.codexSessions.append('session-1', rolloutLines.turnCompleted('t1'))
    await harness.watch.pass()
    expect(handoffs(context, jobId)).toHaveLength(1)

    // A second ending with the item still open changes nothing: they have
    // already been asked.
    harness.codexSessions.append('session-1', rolloutLines.turnCompleted('t2'))
    await harness.watch.pass()
    expect(handoffs(context, jobId)).toHaveLength(1)

    // They come back, which answers it — and the next ending asks again.
    harness.codexSessions.append('session-1', rolloutLines.turnStarted('t3'))
    await harness.watch.pass()
    expect(handoffs(context, jobId)).toEqual([])

    harness.codexSessions.append('session-1', rolloutLines.turnCompleted('t3'))
    await harness.watch.pass()
    expect(handoffs(context, jobId)).toHaveLength(1)
    expect(context.store.getJob(jobId).state).toBe('implementing')
  })

  it('says so when it could not ask GitHub', async () => {
    const context = createTestContext()
    const jobId = await anImplementingJob(context)
    const harness = aWatcher(context, [jobId])
    harness.github.findPullRequest = async () => {
      throw new Error('gh pr list failed')
    }
    harness.codexSessions.append('session-1', rolloutLines.turnCompleted())

    await harness.watch.pass()

    expect(handoffs(context, jobId)[0]?.body).toContain(
      'could not check whether a pull request exists',
    )
  })
})

describe('where the reading is up to', () => {
  it('reads each line once, across passes and across watchers', async () => {
    const context = createTestContext()
    const jobId = await anImplementingJob(context)
    const harness = aWatcher(context, [jobId])
    harness.codexSessions.append('session-1', rolloutLines.turnCompleted('t1'))

    await harness.watch.pass()
    expect(handoffs(context, jobId)).toHaveLength(1)
    context.store.resolveHandlerInput(jobId)

    // Nothing new in the file, so nothing is acted on again.
    await harness.watch.pass()
    expect(handoffs(context, jobId)).toEqual([])

    // A fresh watcher over the same store picks up from the stored offset
    // rather than from the top of the file.
    const restarted = aWatcher(context, [jobId])
    restarted.codexSessions.append(
      'session-1',
      rolloutLines.turnCompleted('t1'),
    )
    await restarted.watch.pass()
    expect(handoffs(context, jobId)).toEqual([])
  })

  it('does not read a session a pass of Handella’s is writing', async () => {
    const { context, jobId } = await aJobInReview()
    const harness = aWatcher(context, [jobId])
    harness.watch.passStarted(jobId)
    // What Handella's own implementation turn looks like from outside.
    harness.codexSessions.append('session-1', rolloutLines.fileChanged())

    await harness.watch.pass()

    expect(context.store.getJob(jobId).state).toBe('planReview')
    expect(harness.codexSessions.reads).toEqual([])
  })

  it('steps over its own turn when the pass ends', async () => {
    const { context, jobId } = await aJobInReview()
    const harness = aWatcher(context, [jobId])
    harness.watch.passStarted(jobId)
    harness.codexSessions.append(
      'session-1',
      rolloutLines.fileChanged(),
      rolloutLines.turnCompleted(),
    )

    await harness.watch.passEnded(jobId)
    await harness.watch.pass()

    // The fence is where the pass ended, so its own file changes are not read
    // back as the Handler approving.
    expect(context.store.getJob(jobId).state).toBe('planReview')
  })

  it('reads a replaced file from the start rather than from an offset into it', async () => {
    const context = createTestContext()
    const jobId = await anImplementingJob(context)
    const branch = branchOf(context, jobId)
    const harness = aWatcher(context, [jobId], {
      pullRequests: { [branch]: aPullRequest() },
    })
    harness.codexSessions.append(
      'session-1',
      rolloutLines.turnStarted(),
      rolloutLines.turnStarted(),
    )
    await harness.watch.pass()

    // Shorter than where the last read ended, so it is not that file.
    context.store.advanceSessionWatch({
      byteOffset: 10_000,
      jobId,
      status: 'following',
    })
    await harness.watch.pass()
    expect(context.store.getJob(jobId).state).toBe('implementing')

    // The next pass starts again from the top, and now sees the ending.
    harness.codexSessions.append('session-1', rolloutLines.turnCompleted())
    await harness.watch.pass()
    expect(context.store.getJob(jobId).state).toBe('prOpen')
  })
})

describe('what is not watched', () => {
  it('ignores a job whose pull request is already open', async () => {
    const context = createTestContext()
    const jobId = await anImplementingJob(context)
    context.store.openPullRequest({
      jobId,
      url: 'https://github.com/acme/monorepo/pull/41',
    })
    const harness = aWatcher(context, [jobId])
    harness.codexSessions.append('session-1', rolloutLines.turnCompleted())

    await harness.watch.pass()

    // The pull request is the fact from here on, and the merge check owns it.
    expect(harness.codexSessions.reads).toEqual([])
    expect(context.store.getJob(jobId).state).toBe('prOpen')
  })

  it('ignores a stopped job, and catches up once it is resumed', async () => {
    const context = createTestContext()
    const jobId = await anImplementingJob(context)
    const branch = branchOf(context, jobId)
    const harness = aWatcher(context, [jobId], {
      pullRequests: { [branch]: aPullRequest() },
    })
    context.store.suspendJob({ jobId, suspension: 'stoppedByHandler' })
    harness.codexSessions.append('session-1', rolloutLines.turnCompleted())

    await harness.watch.pass()
    expect(context.store.getJob(jobId).state).toBe('implementing')

    context.store.resumeJob(jobId)
    await harness.watch.pass()

    expect(context.store.getJob(jobId).state).toBe('prOpen')
  })
})

describe('a session Handella cannot follow', () => {
  it('says so once the rollout has been missing long enough', async () => {
    const context = createTestContext()
    const jobId = await anImplementingJob(context)
    const harness = aWatcher(context, [jobId])
    harness.codexSessions.append('session-1', rolloutLines.turnStarted())
    await harness.watch.pass()

    harness.codexSessions.hide('session-1')
    await harness.watch.pass()
    // Missing once is not lost: a session being written may not be findable
    // for a moment, and the looking carries on.
    expect(handoffs(context, jobId)).toEqual([])

    context.store.advanceSessionWatch({
      jobId,
      missingSince: new Date(Date.now() - 60 * 60_000),
      status: 'following',
    })
    await harness.watch.pass()

    expect(handoffs(context, jobId)[0]?.title).toBe(
      'Handella cannot follow this session',
    )
  })

  it('says so, rather than throwing, when this Codex keeps no rollouts', async () => {
    const context = createTestContext()
    const jobId = await anImplementingJob(context)
    const harness = aWatcher(context, [jobId])
    harness.codexSessions.available = false

    await expect(harness.watch.pass()).resolves.toBeUndefined()

    expect(handoffs(context, jobId)[0]?.title).toBe(
      'Handella cannot follow this session',
    )
    expect(context.store.getJob(jobId).state).toBe('implementing')
  })
})

/** A job the scheduler has planned, waiting on the Handler's answer. */
async function aJobInReview(): Promise<{
  context: TestContext
  jobId: string
}> {
  const context = createTestContext()
  const [jobId] = await aDispatchedQueue(context, 1)
  if (jobId === undefined) throw new Error('No job was dispatched')
  aJobAwaitingApproval(context, jobId, 'session-1')
  return { context, jobId }
}

/** A job mid-implementation with a session to read. */
async function anImplementingJob(context: TestContext): Promise<string> {
  const jobId = await anApprovedJob(context)
  context.store.transitionJob({ actor: 'system', jobId, to: 'implementing' })
  return jobId
}
