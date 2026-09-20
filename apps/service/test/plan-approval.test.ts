import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'

import { planVersions } from '../src/database/schema.js'

import type { TestContext } from './helpers.js'
import {
  aDispatchableJob,
  aPlanAwaitingApproval,
  aPlanContent,
  buildTestApp,
  cleanupTestContexts,
  createTestContext,
} from './helpers.js'

afterEach(cleanupTestContexts)

/** A job sitting in planReview with one revision to answer. */
const aJobAwaitingApproval = () => {
  const context = createTestContext()
  const job = context.store.createJob(aDispatchableJob())
  context.store.transitionJob({ actor: 'handler', jobId: job.id, to: 'queued' })
  const version = aPlanAwaitingApproval(context, job.id)
  return { context, jobId: job.id, version }
}

describe('approving a plan', () => {
  it('marks the revision, freezes the runbook, and moves the job together', () => {
    const { context, jobId, version } = aJobAwaitingApproval()
    const runbook = context.store.activeRunbook()

    const job = context.store.approvePlan({ jobId, planVersionId: version.id })

    expect(job.state).toBe('approved')
    const approved = context.store.listPlanVersions(jobId)[0]
    expect(approved?.approvalState).toBe('approved')
    expect(approved?.approvedAt).not.toBeNull()
    expect(context.store.listRunbookSnapshots(jobId)[0]).toMatchObject({
      runbookVersionId: runbook.id,
      content: runbook.content,
    })
  })

  it('refuses a revision that is not the newest', () => {
    const { context, jobId, version } = aJobAwaitingApproval()
    context.store.requestPlanChanges({
      feedback: 'Cover the signup test too',
      jobId,
      planVersionId: version.id,
    })
    context.store.transitionJob({ actor: 'system', jobId, to: 'planning' })
    context.store.createPlanVersion({ content: aPlanContent(), jobId })
    context.store.transitionJob({ actor: 'system', jobId, to: 'planReview' })

    expect(() =>
      context.store.approvePlan({ jobId, planVersionId: version.id }),
    ).toThrowError(/No plan version/)
  })

  it('writes nothing when the move is refused', () => {
    const context = createTestContext()
    const job = context.store.createJob(aDispatchableJob())
    context.store.transitionJob({
      actor: 'handler',
      jobId: job.id,
      to: 'queued',
    })
    const version = aPlanAwaitingApproval(context, job.id)
    context.store.suspendJob({
      jobId: job.id,
      suspension: 'stoppedByHandler',
    })
    // A stale page answering a plan the job has already moved past.
    expect(() =>
      context.store.approvePlan({
        expectedState: 'planning',
        jobId: job.id,
        planVersionId: version.id,
      }),
    ).toThrowError()

    // The whole operation is one transaction, so a refused move takes the
    // revision and the snapshot down with it.
    expect(context.store.listPlanVersions(job.id)[0]?.approvalState).toBe(
      'pending',
    )
    expect(context.store.listRunbookSnapshots(job.id)).toEqual([])
  })
})

describe('the guard on approved', () => {
  it('refuses a bare transition that skips the approval', () => {
    const { context, jobId } = aJobAwaitingApproval()

    expect(() =>
      context.store.transitionJob({ actor: 'handler', jobId, to: 'approved' }),
    ).toThrowError(/plan revisions/)
  })

  it('refuses a job whose plan is approved but whose runbook was never frozen', () => {
    const { context, jobId, version } = aJobAwaitingApproval()

    // Only the first half of what approval writes, so the guard is asked about
    // the snapshot on its own rather than about the plan again.
    context.database.drizzle
      .update(planVersions)
      .set({ approvalState: 'approved', approvedAt: new Date() })
      .where(eq(planVersions.id, version.id))
      .run()

    expect(() =>
      context.store.transitionJob({ actor: 'handler', jobId, to: 'approved' }),
    ).toThrowError(/runbook snapshot/)
  })
})

describe('requesting changes', () => {
  it('records the feedback and returns the job to the queue', () => {
    const { context, jobId, version } = aJobAwaitingApproval()

    const job = context.store.requestPlanChanges({
      feedback: 'Cover the signup test too',
      jobId,
      planVersionId: version.id,
    })

    expect(job.state).toBe('queued')
    expect(context.store.listPlanVersions(jobId)[0]).toMatchObject({
      approvalState: 'changesRequested',
      feedback: 'Cover the signup test too',
    })
    // Leaving planReview resolves what arriving there raised.
    expect(context.store.listAttentionItems()).toEqual([])
  })

  it('has no ceiling: every revision is kept and any of them may be answered', () => {
    const { context, jobId } = aJobAwaitingApproval()

    for (let round = 0; round < 4; round += 1) {
      const latest = context.store.listPlanVersions(jobId).at(-1)
      context.store.requestPlanChanges({
        feedback: `Round ${round}`,
        jobId,
        planVersionId: latest?.id ?? '',
      })
      context.store.transitionJob({ actor: 'system', jobId, to: 'planning' })
      context.store.createPlanVersion({ content: aPlanContent(), jobId })
      context.store.transitionJob({ actor: 'system', jobId, to: 'planReview' })
    }

    const versions = context.store.listPlanVersions(jobId)
    expect(versions).toHaveLength(5)
    expect(versions.map((version) => version.revision)).toEqual([1, 2, 3, 4, 5])
    expect(versions[3]?.feedback).toBe('Round 3')
  })

  it('refuses when the job has no session to revise in', () => {
    const context = createTestContext()
    const jobId = aPlanningJob(context)
    const version = context.store.createPlanVersion({
      content: aPlanContent(),
      jobId,
    })
    context.store.transitionJob({
      actor: 'system',
      jobId,
      to: 'planReview',
    })

    expect(() =>
      context.store.requestPlanChanges({
        feedback: 'Try again',
        jobId,
        planVersionId: version.id,
      }),
    ).toThrowError(/no Codex session/)
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

describe('the plan endpoints', () => {
  it('approves through the revision in the path', async () => {
    const { context, jobId, version } = aJobAwaitingApproval()
    const { app } = await buildTestApp({ context })

    const response = await app.inject({
      method: 'POST',
      url: `/api/jobs/${jobId}/plan-versions/${version.id}/approve`,
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ state: 'approved' })
  })

  it('answers 404 for a revision that is not the newest', async () => {
    const { context, jobId } = aJobAwaitingApproval()
    const { app } = await buildTestApp({ context })

    const response = await app.inject({
      method: 'POST',
      url: `/api/jobs/${jobId}/plan-versions/3f6c1a2b-4d5e-4f60-8a1b-2c3d4e5f6071/approve`,
    })

    expect(response.statusCode).toBe(404)
    expect(response.json().code).toBe('plan_version_not_found')
  })

  it('sends a change request back to the queue', async () => {
    const { context, jobId, version } = aJobAwaitingApproval()
    const { app } = await buildTestApp({ context })

    const response = await app.inject({
      method: 'POST',
      url: `/api/jobs/${jobId}/plan-versions/${version.id}/request-changes`,
      payload: { feedback: 'Cover the signup test too' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ state: 'queued' })
  })

  it('refuses a change request with nothing in it', async () => {
    const { context, jobId, version } = aJobAwaitingApproval()
    const { app } = await buildTestApp({ context })

    const response = await app.inject({
      method: 'POST',
      url: `/api/jobs/${jobId}/plan-versions/${version.id}/request-changes`,
      payload: { feedback: '' },
    })

    expect(response.statusCode).toBe(400)
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
