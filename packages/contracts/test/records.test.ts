import { Value } from 'typebox/value'
import { describe, expect, it } from 'vitest'

import {
  ApiErrorSchema,
  AttentionItemSchema,
  CreateJobSchema,
  JobChangedSchema,
  JobSchema,
  JobTransitionSchema,
  PlanVersionSchema,
  ReviewRoundSchema,
  RunbookSnapshotSchema,
  TransitionRequestSchema,
} from '../src/index.js'

const jobId = '123e4567-e89b-42d3-a456-426614174000'
const now = '2026-09-18T10:00:00.000Z'

const validJob = {
  id: jobId,
  source: 'adhoc',
  title: 'Fix the flaky login test',
  workClass: 'routine',
  state: 'intake',
  suspension: null,
  linearIssueKey: null,
  linearIssueId: null,
  linearIssueUrl: null,
  canonicalBranch: null,
  repositoryId: null,
  baseBranch: 'dev',
  queuePriority: null,
  worktreePath: null,
  codexSessionId: null,
  originalPrUrl: null,
  createdAt: now,
  updatedAt: now,
}

/** The smallest plan the schema accepts, spelled once. */
const aPlanContent = {
  summary: 'Make the login test wait for the session cookie.',
  steps: [
    {
      id: 'await-cookie',
      title: 'Await the session cookie',
      detail: 'The assertion races the redirect.',
      files: ['test/login.test.ts'],
      required: true,
    },
  ],
  verification: ['npm test -- login'],
  risks: [],
  outOfScope: [],
}

describe('job contract', () => {
  it('accepts a freshly created job with nothing dispatched yet', () => {
    expect(Value.Check(JobSchema, validJob)).toBe(true)
  })

  it('accepts a job linked to its Linear issue', () => {
    expect(
      Value.Check(JobSchema, {
        ...validJob,
        source: 'linear',
        linearIssueKey: 'ENG-412',
        linearIssueId: 'b2b9e5a6-0f1e-4c6b-9a3f-2b1c4d5e6f70',
        linearIssueUrl: 'https://linear.app/acme/issue/ENG-412',
        canonicalBranch: 'ell/eng-412-fix-flaky-login-test',
      }),
    ).toBe(true)
  })

  it('accepts a suspended job', () => {
    expect(
      Value.Check(JobSchema, {
        ...validJob,
        state: 'implementing',
        suspension: 'stoppedBySystem',
      }),
    ).toBe(true)
  })

  it('rejects a state that is really a suspension', () => {
    expect(Value.Check(JobSchema, { ...validJob, state: 'paused' })).toBe(false)
  })

  it('rejects an unknown suspension', () => {
    expect(Value.Check(JobSchema, { ...validJob, suspension: 'napping' })).toBe(
      false,
    )
  })

  it('rejects unknown properties', () => {
    expect(Value.Check(JobSchema, { ...validJob, mystery: 1 })).toBe(false)
  })
})

describe('create job contract', () => {
  it('accepts the minimum a Handler must supply', () => {
    expect(
      Value.Check(CreateJobSchema, {
        source: 'adhoc',
        title: 'Fix the flaky login test',
        workClass: 'routine',
        baseBranch: 'dev',
      }),
    ).toBe(true)
  })

  it('refuses to link a Linear issue, because only intake may', () => {
    // `linearIssueId` is what the live-job index is keyed on and what ADR 0004
    // counts rounds by. A recovery job that could set it would skip both.
    expect(
      Value.Check(CreateJobSchema, {
        source: 'adhoc',
        title: 'Fix the flaky login test',
        workClass: 'routine',
        baseBranch: 'dev',
        linearIssueId: 'b2b9e5a6-0f1e-4c6b-9a3f-2b1c4d5e6f70',
      }),
    ).toBe(false)
  })

  it('rejects an unknown work class', () => {
    expect(
      Value.Check(CreateJobSchema, {
        source: 'adhoc',
        title: 'Fix the flaky login test',
        workClass: 'chore',
        baseBranch: 'dev',
      }),
    ).toBe(false)
  })

  it('rejects an empty title', () => {
    expect(
      Value.Check(CreateJobSchema, {
        source: 'adhoc',
        title: '',
        workClass: 'routine',
        baseBranch: 'dev',
      }),
    ).toBe(false)
  })
})

describe('supporting record contracts', () => {
  it('accepts a transition log entry', () => {
    expect(
      Value.Check(JobTransitionSchema, {
        id: jobId,
        jobId,
        fromState: 'intake',
        toState: 'queued',
        actor: 'handler',
        reason: null,
        occurredAt: now,
      }),
    ).toBe(true)
  })

  it('accepts an attention item that belongs to no job', () => {
    expect(
      Value.Check(AttentionItemSchema, {
        id: jobId,
        jobId: null,
        kind: 'failure',
        title: 'Slack thread was not accessible',
        body: null,
        createdAt: now,
        resolvedAt: null,
      }),
    ).toBe(true)
  })

  it('accepts a pending plan version', () => {
    expect(
      Value.Check(PlanVersionSchema, {
        id: jobId,
        jobId,
        revision: 1,
        content: aPlanContent,
        feedback: null,
        approvalState: 'pending',
        approvedAt: null,
        createdAt: now,
      }),
    ).toBe(true)
  })

  it('carries the feedback behind a change request', () => {
    expect(
      Value.Check(PlanVersionSchema, {
        id: jobId,
        jobId,
        revision: 2,
        content: aPlanContent,
        feedback: 'Cover the expired-token case too',
        approvalState: 'changesRequested',
        approvedAt: null,
        createdAt: now,
      }),
    ).toBe(true)
  })

  it('rejects a plan that is text rather than a structured plan', () => {
    expect(
      Value.Check(PlanVersionSchema, {
        id: jobId,
        jobId,
        revision: 1,
        content: '# Plan\n\n1. Fix it',
        feedback: null,
        approvalState: 'pending',
        approvedAt: null,
        createdAt: now,
      }),
    ).toBe(false)
  })

  it('rejects a plan revision below one', () => {
    expect(
      Value.Check(PlanVersionSchema, {
        id: jobId,
        jobId,
        revision: 0,
        content: aPlanContent,
        feedback: null,
        approvalState: 'pending',
        approvedAt: null,
        createdAt: now,
      }),
    ).toBe(false)
  })

  it('accepts a runbook snapshot', () => {
    expect(
      Value.Check(RunbookSnapshotSchema, {
        id: jobId,
        jobId,
        runbookVersionId: jobId,
        content: '1. Reproduce the failure',
        createdAt: now,
      }),
    ).toBe(true)
  })

  it('accepts a review round that has no child pull request yet', () => {
    expect(
      Value.Check(ReviewRoundSchema, {
        id: jobId,
        jobId,
        roundNumber: 1,
        comments: '[]',
        verdicts: null,
        childBranch: null,
        childPrUrl: null,
        createdAt: now,
      }),
    ).toBe(true)
  })

  it('rejects a review round numbered below one', () => {
    expect(
      Value.Check(ReviewRoundSchema, {
        id: jobId,
        jobId,
        roundNumber: 0,
        comments: '[]',
        verdicts: null,
        childBranch: null,
        childPrUrl: null,
        createdAt: now,
      }),
    ).toBe(false)
  })

  it('accepts a transition request and an api error', () => {
    expect(Value.Check(TransitionRequestSchema, { to: 'queued' })).toBe(true)
    expect(
      Value.Check(TransitionRequestSchema, {
        to: 'queued',
        expectedState: 'intake',
      }),
    ).toBe(true)
    expect(
      Value.Check(ApiErrorSchema, {
        code: 'illegal_transition',
        message: 'intake cannot become planning',
      }),
    ).toBe(true)
  })
})

describe('event contract', () => {
  it('carries identity and status rather than the record', () => {
    expect(
      Value.Check(JobChangedSchema, {
        jobId,
        state: 'planning',
        suspension: null,
      }),
    ).toBe(true)
  })
})
