import { afterEach, describe, expect, it } from 'vitest'

import { DomainError } from '../src/domain/errors.js'
import {
  aDispatchableJob,
  anIntakeJob,
  aReviewRound,
  aRunbookSnapshot,
  cleanupTestContexts,
  createTestContext,
} from './helpers.js'

afterEach(cleanupTestContexts)

const queuedJob = () => {
  const context = createTestContext()
  const job = context.store.createJob(aDispatchableJob())
  context.store.transitionJob({ actor: 'handler', jobId: job.id, to: 'queued' })
  return { context, jobId: job.id }
}

describe('creating a job', () => {
  it('starts at intake with nothing dispatched', () => {
    const { store } = createTestContext()

    const job = store.createJob(anIntakeJob())

    expect(job.state).toBe('intake')
    expect(job.suspension).toBeNull()
    expect(job.canonicalBranch).toBeNull()
    expect(job.linearIssueKey).toBeNull()
  })

  it('announces itself', () => {
    const { published, store } = createTestContext()

    const job = store.createJob(anIntakeJob())

    expect(published).toEqual([
      {
        name: 'job.changed',
        data: { jobId: job.id, state: 'intake', suspension: null },
      },
    ])
  })
})

describe('transitioning a job', () => {
  it('records the move in the append-only log', () => {
    const { store } = createTestContext()
    const job = store.createJob(aDispatchableJob())

    store.transitionJob({
      actor: 'handler',
      jobId: job.id,
      reason: 'Branch confirmed',
      to: 'queued',
    })

    const history = store.listJobTransitions(job.id)
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({
      fromState: 'intake',
      toState: 'queued',
      actor: 'handler',
      reason: 'Branch confirmed',
    })
  })

  it('refuses an edge the state machine does not declare', () => {
    const { store } = createTestContext()
    const job = store.createJob(aDispatchableJob())

    expect(() =>
      store.transitionJob({ actor: 'handler', jobId: job.id, to: 'planning' }),
    ).toThrowError(
      expect.objectContaining({ code: 'illegal_transition' }) as Error,
    )
  })

  it('refuses to queue a job Linear has not given a branch name', () => {
    const { store } = createTestContext()
    const job = store.createJob(anIntakeJob())

    expect(() =>
      store.transitionJob({ actor: 'handler', jobId: job.id, to: 'queued' }),
    ).toThrowError(
      expect.objectContaining({ code: 'transition_guard_failed' }) as Error,
    )
  })

  it('rejects a move decided against a state the job has already left', () => {
    const { store } = createTestContext()
    const job = store.createJob(aDispatchableJob())
    store.transitionJob({ actor: 'handler', jobId: job.id, to: 'queued' })

    expect(() =>
      store.transitionJob({
        actor: 'handler',
        expectedState: 'intake',
        jobId: job.id,
        to: 'planning',
      }),
    ).toThrowError(expect.objectContaining({ code: 'state_conflict' }) as Error)
  })

  it('reports an unknown job rather than inventing one', () => {
    const { store } = createTestContext()

    expect(() =>
      store.transitionJob({
        actor: 'handler',
        jobId: '123e4567-e89b-42d3-a456-426614174000',
        to: 'queued',
      }),
    ).toThrowError(DomainError)
  })

  it('writes nothing and publishes nothing when the move is refused', () => {
    const { published, store } = createTestContext()
    const job = store.createJob(anIntakeJob())
    published.length = 0

    expect(() =>
      store.transitionJob({ actor: 'handler', jobId: job.id, to: 'queued' }),
    ).toThrow()

    expect(published).toEqual([])
    expect(store.listJobTransitions(job.id)).toEqual([])
    expect(store.getJob(job.id).state).toBe('intake')
  })
})

describe('suspension', () => {
  it('leaves the lifecycle state alone', () => {
    const { context, jobId } = queuedJob()

    const suspended = context.store.suspendJob({
      jobId,
      suspension: 'stoppedByHandler',
    })

    expect(suspended.state).toBe('queued')
    expect(suspended.suspension).toBe('stoppedByHandler')
  })

  it('clears on resume without touching the state', () => {
    const { context, jobId } = queuedJob()
    context.store.suspendJob({ jobId, suspension: 'interrupted' })

    const resumed = context.store.resumeJob(jobId)

    expect(resumed.state).toBe('queued')
    expect(resumed.suspension).toBeNull()
  })

  it('refuses to suspend a job that has reached the end of its life', () => {
    const { context, jobId } = queuedJob()
    context.store.transitionJob({ actor: 'handler', jobId, to: 'cancelled' })

    expect(() =>
      context.store.suspendJob({ jobId, suspension: 'stoppedBySystem' }),
    ).toThrowError(
      expect.objectContaining({ code: 'suspension_not_allowed' }) as Error,
    )
  })

  it('leaves the emptied inbox of a finished job alone when suspension is refused', () => {
    const { context, jobId } = queuedJob()
    const { store } = context
    store.transitionJob({ actor: 'handler', jobId, to: 'cancelled' })

    expect(() =>
      store.suspendJob({ jobId, suspension: 'stoppedBySystem' }),
    ).toThrow()

    expect(store.listAttentionItems()).toEqual([])
    expect(store.getJob(jobId).suspension).toBeNull()
  })

  it('is not recorded as a transition', () => {
    const { context, jobId } = queuedJob()
    const before = context.store.listJobTransitions(jobId).length

    context.store.suspendJob({ jobId, suspension: 'stoppedBySystem' })
    context.store.resumeJob(jobId)

    expect(context.store.listJobTransitions(jobId)).toHaveLength(before)
  })
})

describe('the attention inbox', () => {
  it('raises a plan approval on arriving at planReview and resolves it on leaving', () => {
    const { context, jobId } = queuedJob()
    const { store } = context

    store.transitionJob({ actor: 'system', jobId, to: 'planning' })
    store.transitionJob({ actor: 'system', jobId, to: 'planReview' })

    const open = store.listAttentionItems()
    expect(open).toHaveLength(1)
    expect(open[0]).toMatchObject({ jobId, kind: 'planApproval' })

    store.transitionJob({ actor: 'handler', jobId, to: 'approved' })

    expect(store.listAttentionItems()).toEqual([])
    expect(store.listAttentionItems({ includeResolved: true })).toHaveLength(1)
  })

  it('leaves waiting phases unsuspended', () => {
    const { context, jobId } = queuedJob()
    const { store } = context

    store.transitionJob({ actor: 'system', jobId, to: 'planning' })
    store.transitionJob({ actor: 'system', jobId, to: 'planReview' })

    expect(store.getJob(jobId).suspension).toBeNull()
  })

  it('raises a blocker when the system stops a job, and clears it on resume', () => {
    const { context, jobId } = queuedJob()
    const { store } = context

    store.suspendJob({
      jobId,
      reason: 'Repair limit reached',
      suspension: 'stoppedBySystem',
    })

    const open = store.listAttentionItems()
    expect(open).toHaveLength(1)
    expect(open[0]).toMatchObject({
      kind: 'blocker',
      body: 'Repair limit reached',
    })

    store.resumeJob(jobId)
    expect(store.listAttentionItems()).toEqual([])
  })

  it('raises nothing when the Handler stops a job deliberately', () => {
    const { context, jobId } = queuedJob()

    context.store.suspendJob({ jobId, suspension: 'stoppedByHandler' })

    expect(context.store.listAttentionItems()).toEqual([])
  })

  it('treats an interruption as a decision to make rather than a failure', () => {
    const { context, jobId } = queuedJob()
    const { store } = context

    store.suspendJob({ jobId, suspension: 'interrupted' })

    const open = store.listAttentionItems()
    expect(open).toHaveLength(1)
    expect(open[0]).toMatchObject({
      kind: 'blocker',
      title: 'Job was interrupted and needs a resume',
    })

    store.resumeJob(jobId)
    expect(store.listAttentionItems()).toEqual([])
  })

  it('does not raise a second item for a condition already open', () => {
    const { context, jobId } = queuedJob()

    context.store.suspendJob({ jobId, suspension: 'stoppedBySystem' })
    context.store.suspendJob({ jobId, suspension: 'stoppedBySystem' })

    expect(context.store.listAttentionItems()).toHaveLength(1)
  })

  it('resolves everything outstanding when a job reaches a terminal state', () => {
    const { context, jobId } = queuedJob()
    const { store } = context

    store.suspendJob({ jobId, suspension: 'stoppedBySystem' })
    expect(store.listAttentionItems()).toHaveLength(1)

    store.transitionJob({ actor: 'handler', jobId, to: 'cancelled' })

    expect(store.listAttentionItems()).toEqual([])
  })

  it('resolves an item on request and stays resolved', () => {
    const { context, jobId } = queuedJob()
    const { store } = context
    store.suspendJob({ jobId, suspension: 'stoppedBySystem' })
    const item = store.listAttentionItems()[0]

    if (item === undefined) throw new Error('expected an attention item')
    const resolved = store.resolveAttentionItem(item.id)
    expect(resolved.resolvedAt).not.toBeNull()

    const again = store.resolveAttentionItem(item.id)
    expect(again.resolvedAt).toBe(resolved.resolvedAt)
  })
})

describe('the supporting records', () => {
  it('reads back the runbook snapshot a job will execute', () => {
    const { context, jobId } = queuedJob()
    aRunbookSnapshot(context, jobId, '1. Reproduce the failure')

    const snapshots = context.store.listRunbookSnapshots(jobId)

    expect(snapshots).toHaveLength(1)
    expect(snapshots[0]).toMatchObject({
      jobId,
      content: '1. Reproduce the failure',
    })
  })

  it('reads back review rounds in the order they happened', () => {
    const { context, jobId } = queuedJob()
    aReviewRound(context, jobId, 2)
    aReviewRound(context, jobId, 1)

    expect(
      context.store.listReviewRounds(jobId).map((round) => round.roundNumber),
    ).toEqual([1, 2])
  })

  it('reports an unknown job rather than an empty list', () => {
    const { store } = createTestContext()

    for (const read of [store.listRunbookSnapshots, store.listReviewRounds]) {
      expect(() => read('123e4567-e89b-42d3-a456-426614174000')).toThrowError(
        DomainError,
      )
    }
  })
})

describe('the full lifecycle', () => {
  it('walks a job from intake to archived', () => {
    const { store } = createTestContext()
    const job = store.createJob(aDispatchableJob())
    const path = [
      'queued',
      'planning',
      'planReview',
      'approved',
      'implementing',
      'prOpen',
      'merged',
      'archived',
    ] as const

    for (const to of path) {
      store.transitionJob({ actor: 'system', jobId: job.id, to })
    }

    expect(store.getJob(job.id).state).toBe('archived')
    expect(store.listJobTransitions(job.id)).toHaveLength(path.length)
    expect(store.listAttentionItems()).toEqual([])
  })
})
