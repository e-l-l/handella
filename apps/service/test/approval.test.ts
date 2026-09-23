import { afterEach, describe, expect, it } from 'vitest'

import type { TestContext } from './helpers.js'
import {
  aDispatchableJob,
  aJobAwaitingApproval,
  buildTestApp,
  cleanupTestContexts,
  createTestContext,
} from './helpers.js'

afterEach(cleanupTestContexts)

/** A job sitting in planReview, its plan waiting in the Codex session. */
const aReviewableJob = () => {
  const context = createTestContext()
  const job = context.store.createJob(aDispatchableJob())
  context.store.transitionJob({ actor: 'handler', jobId: job.id, to: 'queued' })
  aJobAwaitingApproval(context, job.id)
  return { context, jobId: job.id }
}

describe('approving a job', () => {
  it('freezes the runbook and moves the job together', () => {
    const { context, jobId } = aReviewableJob()
    const runbook = context.store.activeRunbook()

    const job = context.store.approveJob({ jobId })

    expect(job.state).toBe('approved')
    expect(context.store.listRunbookSnapshots(jobId)[0]).toMatchObject({
      runbookVersionId: runbook.id,
      content: runbook.content,
    })
  })

  it('writes nothing when the move is refused', () => {
    const { context, jobId } = aReviewableJob()

    // A stale page approving from a state the job has already left.
    expect(() =>
      context.store.approveJob({ expectedState: 'planning', jobId }),
    ).toThrowError()

    // The whole operation is one transaction, so a refused move takes the
    // snapshot down with it.
    expect(context.store.listRunbookSnapshots(jobId)).toEqual([])
    expect(context.store.getJob(jobId).state).toBe('planReview')
  })

  it('refuses a job that is not waiting on a plan', () => {
    const context = createTestContext()
    const job = context.store.createJob(aDispatchableJob())
    context.store.transitionJob({
      actor: 'handler',
      jobId: job.id,
      to: 'queued',
    })

    let thrown: unknown
    try {
      context.store.approveJob({ jobId: job.id })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toMatchObject({ code: 'illegal_transition' })
    expect(context.store.listRunbookSnapshots(job.id)).toEqual([])
  })

  it('resolves the approval item on leaving planReview', () => {
    const { context, jobId } = aReviewableJob()
    expect(context.store.listAttentionItems()).toMatchObject([
      { jobId, kind: 'planApproval' },
    ])

    context.store.approveJob({ jobId })

    expect(context.store.listAttentionItems()).toEqual([])
  })
})

describe('the guard on approved', () => {
  it('refuses a bare transition that skips the approval', () => {
    const { context, jobId } = aReviewableJob()

    expect(() =>
      context.store.transitionJob({ actor: 'handler', jobId, to: 'approved' }),
    ).toThrowError(/runbook snapshot/)
  })
})

/** A job holding a slot: queued, then started by the scheduler. */
const aPlanningJob = (context: TestContext): string => {
  const job = context.store.createJob(aDispatchableJob())
  context.store.transitionJob({ actor: 'handler', jobId: job.id, to: 'queued' })
  context.store.transitionJob({
    actor: 'system',
    jobId: job.id,
    to: 'planning',
  })
  return job.id
}

describe('reconciling after a restart', () => {
  it('returns a stranded planning job to the queue and says why', () => {
    const context = createTestContext()
    const jobId = aPlanningJob(context)

    expect(context.store.markInterrupted()).toHaveLength(1)

    expect(context.store.getJob(jobId)).toMatchObject({
      state: 'queued',
      suspension: 'interrupted',
    })
    expect(context.store.listAttentionItems()[0]).toMatchObject({
      jobId,
      kind: 'blocker',
    })
  })

  it('leaves alone a job the Handler had already stopped', () => {
    const context = createTestContext()
    const jobId = aPlanningJob(context)
    context.store.suspendJob({
      jobId,
      suspension: 'stoppedByHandler',
    })

    expect(context.store.markInterrupted()).toEqual([])
    expect(context.store.getJob(jobId).suspension).toBe('stoppedByHandler')
  })

  it('resumes into the queue with nothing else asked of the Handler', () => {
    const context = createTestContext()
    const jobId = aPlanningJob(context)
    context.store.markInterrupted()

    const resumed = context.store.resumeJob(jobId)

    expect(resumed).toMatchObject({ state: 'queued', suspension: null })
    expect(context.store.listAttentionItems()).toEqual([])
  })
})

describe('abandoning a planning pass', () => {
  it('stops the job and returns it to the queue in one write', () => {
    const context = createTestContext()
    const jobId = aPlanningJob(context)

    context.store.abandonPlanningPass({ jobId, reason: 'codex fell over' })

    expect(context.store.getJob(jobId)).toMatchObject({
      state: 'queued',
      suspension: 'stoppedBySystem',
    })
    expect(context.store.listAttentionItems()[0]).toMatchObject({
      body: 'codex fell over',
      jobId,
    })
  })

  it('keeps the reason of a job the Handler had already stopped', () => {
    const context = createTestContext()
    const jobId = aPlanningJob(context)
    context.store.suspendJob({ jobId, suspension: 'stoppedByHandler' })

    context.store.abandonPlanningPass({ jobId, reason: 'Planning was stopped' })

    // Their stop is what ended the pass. Re-queued all the same: the slot is
    // no less idle for the reason, and resuming has to give it back.
    expect(context.store.getJob(jobId)).toMatchObject({
      state: 'queued',
      suspension: 'stoppedByHandler',
    })
  })

  it('leaves a job that has already moved on exactly where it is', () => {
    const context = createTestContext()
    const jobId = aPlanningJob(context)
    context.store.transitionJob({
      actor: 'system',
      jobId,
      to: 'planReview',
    })

    context.store.abandonPlanningPass({ jobId, reason: 'a late failure' })

    expect(context.store.getJob(jobId)).toMatchObject({
      state: 'planReview',
      suspension: null,
    })
  })
})

describe('the approve endpoint', () => {
  it('approves the job and answers with it', async () => {
    const { context, jobId } = aReviewableJob()
    const { app } = await buildTestApp({ context })

    const response = await app.inject({
      method: 'POST',
      url: `/api/jobs/${jobId}/approve`,
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ state: 'approved' })
  })

  it('refuses a job that is not in plan review', async () => {
    const context = createTestContext()
    const job = context.store.createJob(aDispatchableJob())
    const { app } = await buildTestApp({ context })

    const response = await app.inject({
      method: 'POST',
      url: `/api/jobs/${job.id}/approve`,
    })

    expect(response.statusCode).toBe(409)
    expect(response.json().code).toBe('illegal_transition')
  })
})

describe('the runbook endpoints', () => {
  it('serves the seeded version an installation starts with', async () => {
    const { app } = await buildTestApp()

    const response = await app.inject({
      method: 'GET',
      url: '/api/runbook-versions',
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toHaveLength(1)
    expect(response.json()[0]).toMatchObject({ version: 1 })
  })

  it('saves a new version rather than editing the one in force', async () => {
    const { app } = await buildTestApp()

    const created = await app.inject({
      method: 'POST',
      url: '/api/runbook-versions',
      payload: { content: 'Run the suite twice' },
    })

    expect(created.statusCode).toBe(201)
    expect(created.json()).toMatchObject({
      version: 2,
      content: 'Run the suite twice',
    })

    const listed = await app.inject({
      method: 'GET',
      url: '/api/runbook-versions',
    })
    // Newest first, which is the order settings reads them in.
    expect(
      listed.json().map((row: { version: number }) => row.version),
    ).toEqual([2, 1])
  })
})
