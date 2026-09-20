import { availableSlots } from '@handella/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { CodexAdapter } from '../src/adapters/codex.js'
import { createScheduler } from '../src/domain/scheduler.js'
import type { TestContext } from './helpers.js'
import {
  aDispatchedQueue,
  aTemporaryDirectory,
  createFakeGitAdapter,
  createFakeGitHubAdapter,
  aFailingCodex,
  aHeldCodex,
  aLinearIssueLink,
  anAbortableCodex,
  aQueueableIssue,
  cleanupTestContexts,
  createFakeCodexAdapter,
  createTestContext,
  testRepositoryId,
} from './helpers.js'

afterEach(cleanupTestContexts)

const aScheduler = (
  context: TestContext,
  codex: CodexAdapter = createFakeCodexAdapter(),
) =>
  createScheduler({
    broadcaster: context.broadcaster,
    codex,
    git: createFakeGitAdapter(),
    github: createFakeGitHubAdapter(),
    linear: context.linear,
    logRoot: aTemporaryDirectory('handella-logs-'),
    store: context.store,
  })

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
    const codex = createFakeCodexAdapter()
    const plan = vi.fn(codex.plan)
    const scheduler = aScheduler(context, { ...codex, plan })

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
    const codex = createFakeCodexAdapter()
    codex.failNextWith(new Error('codex fell over'))
    const scheduler = aScheduler(context, codex)

    scheduler.start()
    await scheduler.whenIdle()
    scheduler.stop()

    const failed = context.store.getJob(ids[0] ?? '')
    // ADR 0003: the failure itself is the suspension and not a state of its
    // own. The move is the slot being handed back rather than merely freed —
    // `planning` is not a state the scheduler starts from, so a job left
    // there would take a slot with it the moment it was resumed.
    expect(failed.suspension).toBe('stoppedBySystem')
    expect(failed.state).toBe('queued')
    expect(context.store.getJob(ids[1] ?? '').state).toBe('planReview')
  })
})

describe('what a planning pass is given', () => {
  it('sends the worktree, the live issue and the runbook in force', async () => {
    const context = createTestContext()
    const ids = await aDispatchedQueue(context, 1)
    context.store.createRunbookVersion({ content: 'Run the suite' })
    const codex = createFakeCodexAdapter()
    const scheduler = aScheduler(context, codex)

    scheduler.start()
    await scheduler.whenIdle()
    scheduler.stop()

    const call = codex.calls[0]
    expect(call?.job.id).toBe(ids[0])
    expect(call?.worktreePath).toBe(
      context.store.getJob(ids[0] ?? '').worktreePath,
    )
    expect(call?.runbook).toBe('Run the suite')
    expect(call?.issue.identifier).toBeTruthy()
    // Nothing to revise yet, so nothing to resume.
    expect(call?.sessionId).toBeUndefined()
    expect(call?.feedback).toBeUndefined()
  })

  it('records the session the pass ran in, so the next one can resume it', async () => {
    const context = createTestContext()
    const ids = await aDispatchedQueue(context, 1)
    const scheduler = aScheduler(
      context,
      createFakeCodexAdapter({ sessionId: 'session-abc' }),
    )

    scheduler.start()
    await scheduler.whenIdle()
    scheduler.stop()

    expect(context.store.getJob(ids[0] ?? '').codexSessionId).toBe(
      'session-abc',
    )
  })

  it('stores the plan as a structured revision rather than text', async () => {
    const context = createTestContext()
    const ids = await aDispatchedQueue(context, 1)
    const scheduler = aScheduler(context)

    scheduler.start()
    await scheduler.whenIdle()
    scheduler.stop()

    const versions = context.store.listPlanVersions(ids[0] ?? '')
    expect(versions).toHaveLength(1)
    expect(versions[0]?.revision).toBe(1)
    expect(versions[0]?.approvalState).toBe('pending')
    expect(versions[0]?.content.steps[0]?.id).toBe('await-cookie')
  })
})

describe('a change request', () => {
  it('re-queues the job and revises in the same session', async () => {
    const context = createTestContext()
    const ids = await aDispatchedQueue(context, 1)
    const jobId = ids[0] ?? ''
    const codex = createFakeCodexAdapter({ sessionId: 'session-abc' })
    const scheduler = aScheduler(context, codex)

    scheduler.start()
    await scheduler.whenIdle()

    const first = context.store.listPlanVersions(jobId)[0]
    context.store.requestPlanChanges({
      feedback: 'Cover the signup test too',
      jobId,
      planVersionId: first?.id ?? '',
    })
    await scheduler.whenIdle()
    scheduler.stop()

    expect(codex.calls).toHaveLength(2)
    expect(codex.calls[1]?.sessionId).toBe('session-abc')
    expect(codex.calls[1]?.feedback).toBe('Cover the signup test too')
    expect(context.store.listPlanVersions(jobId)).toHaveLength(2)
    expect(context.store.getJob(jobId).state).toBe('planReview')
  })
})

describe('stopping a pass', () => {
  it('aborts the process when the Handler suspends the job', async () => {
    const context = createTestContext()
    const ids = await aDispatchedQueue(context, 1)
    const jobId = ids[0] ?? ''
    const { codex, whenStarted } = anAbortableCodex()
    const scheduler = aScheduler(context, codex)

    scheduler.start()
    await whenStarted

    context.store.suspendJob({ jobId, suspension: 'stoppedByHandler' })
    await scheduler.whenIdle()
    scheduler.stop()

    // The Handler's reason survives: the abort is a consequence of the stop,
    // not a second opinion about it. The job is still re-queued, because the
    // slot is no less idle for the reason its pass ended.
    expect(context.store.getJob(jobId)).toMatchObject({
      state: 'queued',
      suspension: 'stoppedByHandler',
    })
  })

  it('aborts in-flight passes on shutdown and leaves them to the restart', async () => {
    const context = createTestContext()
    const ids = await aDispatchedQueue(context, 1)
    const jobId = ids[0] ?? ''
    const { codex, whenStarted } = anAbortableCodex()
    const scheduler = aScheduler(context, codex)

    scheduler.start()
    await whenStarted
    scheduler.stop()
    await scheduler.whenIdle()

    // Untouched: shutdown is not a fault, and markInterrupted is what knows
    // the difference on the way back up.
    expect(context.store.getJob(jobId)).toMatchObject({
      state: 'planning',
      suspension: null,
    })

    expect(context.store.markInterrupted()).toHaveLength(1)
    expect(context.store.getJob(jobId)).toMatchObject({
      state: 'queued',
      suspension: 'interrupted',
    })
  })

  it('suspends a job whose pass simply failed', async () => {
    const context = createTestContext()
    const ids = await aDispatchedQueue(context, 1)
    const scheduler = aScheduler(context, aFailingCodex('codex fell over'))

    scheduler.start()
    await scheduler.whenIdle()
    scheduler.stop()

    expect(context.store.getJob(ids[0] ?? '').suspension).toBe(
      'stoppedBySystem',
    )
  })

  /**
   * The failure worth naming: an installation without Codex fails all three
   * passes, and the Handler's answer is to install it and press Resume. If a
   * failed pass left its job in `planning`, resuming would hand it a slot that
   * nothing is running in, and the third one would stop the scheduler dead.
   */
  it('gives every slot back when a failed pass is resumed', async () => {
    const context = createTestContext()
    const ids = await aDispatchedQueue(context, 3)
    const failing = aFailingCodex('codex is not installed')
    const working = createFakeCodexAdapter()
    let codex = failing
    const scheduler = aScheduler(context, {
      get configured() {
        return codex.configured
      },
      plan: (request) => codex.plan(request),
    })

    scheduler.start()
    await scheduler.whenIdle()

    // Codex arrives, and the Handler resumes what failed without it.
    codex = working
    for (const jobId of ids) context.store.resumeJob(jobId)
    await scheduler.whenIdle()
    scheduler.stop()

    for (const jobId of ids) {
      expect(context.store.getJob(jobId)).toMatchObject({
        state: 'planReview',
        suspension: null,
      })
    }
    expect(availableSlots(context.store.listJobs())).toBe(3)
  })
})
