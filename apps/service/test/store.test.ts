import { afterEach, describe, expect, it } from 'vitest'

import { DomainError } from '../src/domain/errors.js'
import type { Store } from '../src/domain/store.js'
import {
  aDispatchableJob,
  aLinearIssueLink,
  anIntakeJob,
  aReviewRound,
  aPlanAwaitingApproval,
  cleanupTestContexts,
  createTestContext,
  testRepositoryId,
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

    const version = aPlanAwaitingApproval(context, jobId)

    const open = store.listAttentionItems()
    expect(open).toHaveLength(1)
    expect(open[0]).toMatchObject({ jobId, kind: 'planApproval' })

    store.approvePlan({ jobId, planVersionId: version.id })

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
    const runbook = context.store.createRunbookVersion({
      content: '1. Reproduce the failure',
    })
    const version = aPlanAwaitingApproval(context, jobId)

    context.store.approvePlan({ jobId, planVersionId: version.id })
    const snapshots = context.store.listRunbookSnapshots(jobId)

    expect(snapshots).toHaveLength(1)
    expect(snapshots[0]).toMatchObject({
      jobId,
      runbookVersionId: runbook.id,
      content: '1. Reproduce the failure',
    })
  })

  it('freezes the runbook as it was, not as it later becomes', () => {
    const { context, jobId } = queuedJob()
    context.store.createRunbookVersion({ content: 'Run the suite' })
    const version = aPlanAwaitingApproval(context, jobId)
    context.store.approvePlan({ jobId, planVersionId: version.id })

    context.store.createRunbookVersion({ content: 'Run the suite twice' })

    expect(context.store.listRunbookSnapshots(jobId)[0]?.content).toBe(
      'Run the suite',
    )
    expect(context.store.activeRunbook().content).toBe('Run the suite twice')
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
    const context = createTestContext()
    const { store } = context
    const job = store.createJob(aDispatchableJob())

    store.transitionJob({ actor: 'handler', jobId: job.id, to: 'queued' })
    // Approval is the one step with writes behind it, so it is taken the way
    // the Handler takes it rather than as a bare move.
    const version = aPlanAwaitingApproval(context, job.id)
    store.approvePlan({ jobId: job.id, planVersionId: version.id })

    for (const to of [
      'implementing',
      'prOpen',
      'merged',
      'archived',
    ] as const) {
      store.transitionJob({ actor: 'system', jobId: job.id, to })
    }

    expect(store.getJob(job.id).state).toBe('archived')
    expect(store.listJobTransitions(job.id)).toHaveLength(8)
    expect(store.listAttentionItems()).toEqual([])
  })
})

describe('creating a job for a Linear issue', () => {
  it('announces the new job exactly once', () => {
    const context = createTestContext()

    const job = context.store.createJobForLinearIssue({
      repositoryId: testRepositoryId,
      baseBranch: 'dev',
      issue: aLinearIssueLink(),
      source: 'linear',
      workClass: 'routine',
    })

    expect(context.published).toEqual([
      {
        name: 'job.changed',
        data: { jobId: job.id, state: 'intake', suspension: null },
      },
    ])
  })

  it('takes its title and its branch from Linear, not from the caller', () => {
    const { store } = createTestContext()

    const job = store.createJobForLinearIssue({
      repositoryId: testRepositoryId,
      baseBranch: 'main',
      issue: aLinearIssueLink(),
      source: 'adhoc',
      workClass: 'feature',
    })

    expect(job).toMatchObject({
      source: 'adhoc',
      title: 'Fix the flaky login test',
      linearIssueKey: 'ENG-412',
      canonicalBranch: 'ell/eng-412-fix-flaky-login-test',
    })
  })

  it('refuses a second live job for one issue', () => {
    const { store } = createTestContext()
    store.createJobForLinearIssue({
      repositoryId: testRepositoryId,
      baseBranch: 'dev',
      issue: aLinearIssueLink(),
      source: 'linear',
      workClass: 'routine',
    })

    expect(() =>
      store.createJobForLinearIssue({
        repositoryId: testRepositoryId,
        baseBranch: 'dev',
        issue: aLinearIssueLink(),
        source: 'linear',
        workClass: 'routine',
      }),
    ).toThrowError(
      expect.objectContaining({ code: 'linear_issue_already_linked' }) as Error,
    )
  })

  it('keys that refusal on the issue id, not the identifier Linear rewrites', () => {
    const { store } = createTestContext()
    store.createJobForLinearIssue({
      repositoryId: testRepositoryId,
      baseBranch: 'dev',
      issue: aLinearIssueLink(),
      source: 'linear',
      workClass: 'routine',
    })

    // The same issue after it moved team: new identifier, new branch name.
    expect(() =>
      store.createJobForLinearIssue({
        repositoryId: testRepositoryId,
        baseBranch: 'dev',
        issue: aLinearIssueLink({
          identifier: 'OPS-7',
          branchName: 'ell/ops-7-fix-flaky-login-test',
        }),
        source: 'linear',
        workClass: 'routine',
      }),
    ).toThrowError(
      expect.objectContaining({ code: 'linear_issue_already_linked' }) as Error,
    )
  })

  it('never reuses a branch name, even after a cancellation', () => {
    const { store } = createTestContext()

    const first = store.createJobForLinearIssue({
      repositoryId: testRepositoryId,
      baseBranch: 'dev',
      issue: aLinearIssueLink(),
      source: 'linear',
      workClass: 'routine',
    })
    store.transitionJob({ actor: 'handler', jobId: first.id, to: 'cancelled' })

    const second = store.createJobForLinearIssue({
      repositoryId: testRepositoryId,
      baseBranch: 'dev',
      issue: aLinearIssueLink(),
      source: 'linear',
      workClass: 'routine',
    })

    expect(second.canonicalBranch).toBe('ell/eng-412-fix-flaky-login-test-2')
  })
})

describe('base branch suggestions', () => {
  it('reports the default separately and never repeats it', () => {
    const { store } = createTestContext()
    store.createJob(anIntakeJob({ baseBranch: 'dev' }))

    expect(store.listBaseBranchSuggestions()).toEqual({
      defaultBranch: 'dev',
      recent: [],
    })
  })

  it('lists each branch once, most recently used first', () => {
    // Jobs created in one millisecond tie on `createdAt`, and a tie has no
    // honest order, so the clock is the test's to move.
    let tick = 0
    const { store } = createTestContext({
      now: () => new Date(Date.UTC(2026, 8, 18, 10, 0, tick++)),
    })
    for (const baseBranch of ['main', 'release/24', 'main']) {
      store.createJob(anIntakeJob({ baseBranch }))
    }

    expect(store.listBaseBranchSuggestions().recent).toEqual([
      'main',
      'release/24',
    ])
  })

  it('offers only as many as it was asked for', () => {
    const { store } = createTestContext()

    for (const baseBranch of ['main', 'release/24', 'release/25']) {
      store.createJob(anIntakeJob({ baseBranch }))
    }

    expect(store.listBaseBranchSuggestions({ limit: 2 }).recent).toHaveLength(2)
  })

  it('never lets the default eat one of the suggestions asked for', () => {
    let tick = 0
    const { store } = createTestContext({
      now: () => new Date(Date.UTC(2026, 8, 18, 10, 0, tick++)),
    })

    // The default is the most recently used, so excluding it after the limit
    // rather than before would answer with one branch instead of two.
    for (const baseBranch of ['release/25', 'release/24', 'main', 'dev']) {
      store.createJob(anIntakeJob({ baseBranch }))
    }

    expect(store.listBaseBranchSuggestions({ limit: 2 }).recent).toEqual([
      'main',
      'release/24',
    ])
  })
})

describe('describing the issues intake is about to offer', () => {
  const anIssue = (id: string) =>
    aLinearIssueLink({
      branchName: `ell/eng-${id}-something`,
      id,
      identifier: `ENG-${id}`,
      title: 'Something',
      url: `https://linear.app/acme/issue/ENG-${id}`,
    })

  const take = (store: Store, id: string) =>
    store.createJobForLinearIssue({
      repositoryId: testRepositoryId,
      baseBranch: 'dev',
      issue: anIssue(id),
      source: 'linear',
      workClass: 'routine',
    })

  it('answers an untouched issue with round one and no holder', () => {
    const { store } = createTestContext()

    expect(store.describeIssuesForIntake(['1']).get('1')).toEqual({
      heldByJobId: null,
      nextRound: 1,
    })
  })

  it('names the live job holding an issue', () => {
    const { store } = createTestContext()
    const job = take(store, '1')

    expect(store.describeIssuesForIntake(['1']).get('1')).toEqual({
      heldByJobId: job.id,
      nextRound: 2,
    })
  })

  it('still counts a settled job, though it holds nothing', () => {
    const { store } = createTestContext()
    const job = take(store, '1')
    store.transitionJob({ actor: 'handler', jobId: job.id, to: 'cancelled' })

    // ADR 0004: cancelling never frees a branch name for reuse.
    expect(store.describeIssuesForIntake(['1']).get('1')).toEqual({
      heldByJobId: null,
      nextRound: 2,
    })
  })

  it('answers for every issue it was given, in one read', () => {
    const { store } = createTestContext()
    take(store, '1')

    const facts = store.describeIssuesForIntake(['1', '2'])

    expect(facts.get('2')).toEqual({ heldByJobId: null, nextRound: 1 })
    expect(facts.has('3')).toBe(false)
  })
})
