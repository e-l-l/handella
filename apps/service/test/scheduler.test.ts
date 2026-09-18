import { afterEach, describe, expect, it, vi } from 'vitest'

import type { CodexAdapter } from '../src/adapters/codex.js'
import { stubCodexAdapter } from '../src/adapters/codex.js'
import { createScheduler } from '../src/domain/scheduler.js'
import type { TestContext } from './helpers.js'
import {
  aDispatchedQueue,
  aLinearIssueLink,
  aQueueableIssue,
  cleanupTestContexts,
  createTestContext,
  testRepositoryId,
} from './helpers.js'

afterEach(cleanupTestContexts)

const aScheduler = (
  context: TestContext,
  codex: CodexAdapter = stubCodexAdapter,
) =>
  createScheduler({
    broadcaster: context.broadcaster,
    codex,
    store: context.store,
  })

/** A pass the test decides when to finish, for watching a slot while it is held. */
const aHeldCodex = () => {
  let release: () => void = () => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  const codex: CodexAdapter = {
    configured: false,
    plan: async () => {
      await held
      return { content: 'planned' }
    },
  }
  return { codex, release: () => release() }
}

describe('the three-slot ceiling', () => {
  it('starts no more than three jobs at once', async () => {
    const context = createTestContext()
    await aDispatchedQueue(context, 4)
    const { codex, release } = aHeldCodex()
    const scheduler = aScheduler(context, codex)

    scheduler.start()

    const planning = context.store
      .listJobs()
      .filter((job) => job.state === 'planning')
    expect(planning).toHaveLength(3)
    expect(
      context.store.listJobs().filter((job) => job.state === 'queued'),
    ).toHaveLength(1)

    release()
    await scheduler.whenIdle()
    scheduler.stop()
  })

  it('pulls the waiting job in as soon as a slot frees', async () => {
    const context = createTestContext()
    await aDispatchedQueue(context, 4)
    const scheduler = aScheduler(context)

    scheduler.start()
    await scheduler.whenIdle()
    scheduler.stop()

    // The stub completes each pass, so all four get through and land where the
    // Handler has to look at them.
    const states = context.store.listJobs().map((job) => job.state)
    expect(states.filter((state) => state === 'planReview')).toHaveLength(4)
  })

  it('releases the slot and raises the plan for approval', async () => {
    const context = createTestContext()
    const [jobId] = await aDispatchedQueue(context, 1)
    const scheduler = aScheduler(context)

    scheduler.start()
    await scheduler.whenIdle()
    scheduler.stop()

    expect(context.store.getJob(jobId ?? '').state).toBe('planReview')
    expect(context.store.listAttentionItems()).toMatchObject([
      { jobId, kind: 'planApproval' },
    ])
    expect(context.store.listPlanVersions(jobId ?? '')).toMatchObject([
      { revision: 1, approvalState: 'pending' },
    ])
  })

  it('moves jobs with actor system, which nothing wrote before', async () => {
    const context = createTestContext()
    const [jobId] = await aDispatchedQueue(context, 1)
    const scheduler = aScheduler(context)

    scheduler.start()
    await scheduler.whenIdle()
    scheduler.stop()

    const actors = context.store
      .listJobTransitions(jobId ?? '')
      .filter(
        (row) => row.toState === 'planning' || row.toState === 'planReview',
      )
      .map((row) => row.actor)
    expect(actors).toEqual(['system', 'system'])
  })
})

describe('what the scheduler will not start', () => {
  it('skips a suspended job and takes the next one instead', async () => {
    const context = createTestContext()
    const ids = await aDispatchedQueue(context, 2)
    const stopped = ids[0] ?? ''
    context.store.suspendJob({ jobId: stopped, suspension: 'stoppedByHandler' })
    const scheduler = aScheduler(context)

    scheduler.start()
    await scheduler.whenIdle()
    scheduler.stop()

    expect(context.store.getJob(stopped).state).toBe('queued')
    expect(context.store.getJob(ids[1] ?? '').state).toBe('planReview')
  })

  it('skips a queued job whose worktree has not been cut yet', async () => {
    const context = createTestContext()
    const job = context.store.createJobForLinearIssue({
      baseBranch: 'dev',
      issue: aLinearIssueLink(aQueueableIssue(1)),
      repositoryId: testRepositoryId,
      source: 'linear',
      workClass: 'routine',
    })
    // Claimed but never cut: what a crash between the two writes leaves behind.
    context.store.claimForDispatch({
      branchName: 'ell/eng-1-something',
      jobId: job.id,
    })
    const scheduler = aScheduler(context)

    scheduler.start()
    await scheduler.whenIdle()
    scheduler.stop()

    expect(context.store.getJob(job.id)).toMatchObject({
      state: 'queued',
      worktreePath: null,
    })
  })

  it('starts nothing at all when the queue is empty', async () => {
    const context = createTestContext()
    const plan = vi.fn(stubCodexAdapter.plan)
    const scheduler = aScheduler(context, { configured: false, plan })

    scheduler.start()
    await scheduler.whenIdle()
    scheduler.stop()

    expect(plan).not.toHaveBeenCalled()
  })
})

describe('when a planning pass fails', () => {
  it('gives the slot back rather than holding it forever', async () => {
    const context = createTestContext()
    const ids = await aDispatchedQueue(context, 2)
    let first = true
    const codex: CodexAdapter = {
      configured: false,
      plan: async () => {
        if (first) {
          first = false
          throw new Error('codex fell over')
        }
        return { content: 'planned' }
      },
    }
    const scheduler = aScheduler(context, codex)

    scheduler.start()
    await scheduler.whenIdle()
    scheduler.stop()

    const failed = context.store.getJob(ids[0] ?? '')
    expect(failed.suspension).toBe('stoppedBySystem')
    // ADR 0003: the lifecycle state is untouched; only the suspension says so.
    expect(failed.state).toBe('planning')
    expect(context.store.getJob(ids[1] ?? '').state).toBe('planReview')
  })
})

describe('the stub standing in for Phase 5', () => {
  it('says what it is rather than pretending to have planned', async () => {
    const result = await stubCodexAdapter.plan({
      job: { title: 'Fix the flaky login test' } as never,
      worktreePath: '/tmp/worktree',
    })

    expect(stubCodexAdapter.configured).toBe(false)
    expect(result.content).toContain('Phase 5')
    expect(result.content).toContain('/tmp/worktree')
  })
})
