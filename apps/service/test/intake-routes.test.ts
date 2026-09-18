import type { JobState } from '@handella/contracts'
import { afterEach, describe, expect, it } from 'vitest'

import {
  linearNotConfigured,
  linearRateLimited,
  linearUnauthorized,
} from '../src/domain/errors.js'
import { unconfiguredLinearAdapter } from '../src/adapters/linear.js'
import {
  aLinearIssue,
  aLinearIssueLink,
  aLinearTeam,
  aLinearWorkflowState,
  buildTestApp,
  cleanupTestContexts,
  createFakeLinearAdapter,
  createTestContext,
  testRepositoryId,
} from './helpers.js'

afterEach(cleanupTestContexts)

/**
 * The issue `aLinearIssue` describes, and the body that takes it. Spelled once
 * so the id can never drift from the fake that answers for it.
 */
const issueId = 'b2b9e5a6-0f1e-4c6b-9a3f-2b1c4d5e6f70'
const intake = {
  issueId,
  workClass: 'routine' as const,
  repositoryId: testRepositoryId,
  baseBranch: 'dev',
}

/** The whole happy life of a job, so a test can put one behind it. */
const toMerged: JobState[] = [
  'queued',
  'planning',
  'planReview',
  'approved',
  'implementing',
  'prOpen',
  'merged',
]

describe('GET /api/intake/linear/issues', () => {
  it('returns the page the adapter produced', async () => {
    const linear = createFakeLinearAdapter({ nextCursor: 'more' })
    const { app } = await buildTestApp({ linear })

    const response = await app.inject({
      method: 'GET',
      url: '/api/intake/linear/issues',
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      issues: [
        {
          issue: { identifier: 'ENG-412' },
          heldByJobId: null,
          plannedBranch: 'ell/eng-412-fix-flaky-login-test',
          round: 1,
        },
      ],
      nextCursor: 'more',
    })
  })

  it('names the job already holding an issue, rather than hiding it', async () => {
    const { app } = await buildTestApp()

    const created = await app.inject({
      method: 'POST',
      url: '/api/intake/linear',
      payload: intake,
    })

    const response = await app.inject({
      method: 'GET',
      url: '/api/intake/linear/issues',
    })

    expect(response.json().issues[0]).toMatchObject({
      heldByJobId: created.json().id,
    })
  })

  it('answers the branch a repeat job would take, so the Handler sees it first', async () => {
    const { app, store } = await buildTestApp()

    const created = await app.inject({
      method: 'POST',
      url: '/api/intake/linear',
      payload: intake,
    })
    for (const to of toMerged) {
      store.transitionJob({ actor: 'handler', jobId: created.json().id, to })
    }

    const response = await app.inject({
      method: 'GET',
      url: '/api/intake/linear/issues',
    })

    // ADR 0004: settled jobs are counted, so the freed issue still gets a name
    // of its own on the next pass.
    expect(response.json().issues[0]).toMatchObject({
      heldByJobId: null,
      plannedBranch: 'ell/eng-412-fix-flaky-login-test-2',
      round: 2,
    })
  })

  it('defaults the page size, because a schema default fills nothing in', async () => {
    const linear = createFakeLinearAdapter()
    const { app } = await buildTestApp({ linear })

    await app.inject({ method: 'GET', url: '/api/intake/linear/issues' })

    expect(linear.listCalls[0]).toEqual({ limit: 25 })
  })

  it('passes the Handler filters through', async () => {
    const linear = createFakeLinearAdapter()
    const { app } = await buildTestApp({ linear })

    await app.inject({
      method: 'GET',
      url: '/api/intake/linear/issues?search=login&teamId=t1&stateId=s2&limit=10&cursor=abc',
    })

    expect(linear.listCalls[0]).toEqual({
      cursor: 'abc',
      limit: 10,
      search: 'login',
      stateId: 's2',
      teamId: 't1',
    })
  })

  it('bounds the page size', async () => {
    const { app } = await buildTestApp()

    for (const limit of [0, 51]) {
      const response = await app.inject({
        method: 'GET',
        url: `/api/intake/linear/issues?limit=${limit}`,
      })
      expect(response.statusCode).toBe(400)
    }
  })
})

describe('GET /api/intake/linear/teams/:teamId/states', () => {
  it("answers the team's states, so the filter can name them", async () => {
    const linear = createFakeLinearAdapter({
      states: [
        aLinearWorkflowState({ id: 's1', name: 'Todo', type: 'unstarted' }),
        aLinearWorkflowState({ id: 's2', name: 'In Dev (QA)' }),
      ],
    })
    const { app } = await buildTestApp({ linear })

    const response = await app.inject({
      method: 'GET',
      url: '/api/intake/linear/teams/t1/states',
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual([
      { id: 's1', name: 'Todo', type: 'unstarted' },
      { id: 's2', name: 'In Dev (QA)', type: 'started' },
    ])
    expect(linear.stateCalls).toEqual(['t1'])
  })
})

describe('an installation with no Linear API key', () => {
  it('answers every Linear endpoint with a setup error', async () => {
    const { app } = await buildTestApp({ linear: unconfiguredLinearAdapter })

    const responses = await Promise.all([
      app.inject({ method: 'GET', url: '/api/intake/linear/issues' }),
      app.inject({ method: 'GET', url: '/api/intake/linear/teams' }),
      app.inject({
        method: 'GET',
        url: '/api/intake/linear/teams/t1/states',
      }),
      app.inject({
        method: 'POST',
        url: '/api/intake/linear',
        payload: {
          issueId: 'x',
          workClass: 'routine',
          repositoryId: testRepositoryId,
          baseBranch: 'dev',
        },
      }),
      app.inject({
        method: 'POST',
        url: '/api/intake/adhoc',
        payload: {
          teamId: 't1',
          title: 'Anything',
          workClass: 'routine',
          repositoryId: testRepositoryId,
          baseBranch: 'dev',
        },
      }),
    ])

    for (const response of responses) {
      expect(response.statusCode).toBe(503)
      expect(response.json()).toMatchObject({ code: 'linear_not_configured' })
    }
  })

  it('still answers the local half of intake', async () => {
    const { app } = await buildTestApp({ linear: unconfiguredLinearAdapter })

    const response = await app.inject({
      method: 'GET',
      url: '/api/intake/base-branches',
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ defaultBranch: 'dev', recent: [] })
  })

  it('tells the dashboard so, rather than making it find out by failing', async () => {
    const { app } = await buildTestApp({ linear: unconfiguredLinearAdapter })

    const response = await app.inject({ method: 'GET', url: '/api/status' })

    expect(response.json()).toMatchObject({
      integrations: { linear: { configured: false } },
    })
  })

  it('reports a configured installation the same way', async () => {
    const { app } = await buildTestApp()

    const response = await app.inject({ method: 'GET', url: '/api/status' })

    expect(response.json()).toMatchObject({
      integrations: { linear: { configured: true } },
    })
  })
})

describe('POST /api/intake/linear', () => {
  it('produces a dispatchable job linked to its issue and branch', async () => {
    const { app } = await buildTestApp()

    const response = await app.inject({
      method: 'POST',
      url: '/api/intake/linear',
      payload: { ...intake, workClass: 'feature', baseBranch: 'main' },
    })

    expect(response.statusCode).toBe(201)
    expect(response.json()).toMatchObject({
      source: 'linear',
      state: 'intake',
      title: 'Fix the flaky login test',
      workClass: 'feature',
      baseBranch: 'main',
      linearIssueKey: 'ENG-412',
      linearIssueId: 'b2b9e5a6-0f1e-4c6b-9a3f-2b1c4d5e6f70',
      linearIssueUrl: 'https://linear.app/acme/issue/ENG-412',
      canonicalBranch: 'ell/eng-412-fix-flaky-login-test',
    })
  })

  it('satisfies the guard that kept a job out of the queue', async () => {
    const { app } = await buildTestApp()

    const created = await app.inject({
      method: 'POST',
      url: '/api/intake/linear',
      payload: intake,
    })

    const queued = await app.inject({
      method: 'POST',
      url: `/api/jobs/${created.json().id}/transitions`,
      payload: { to: 'queued' },
    })

    expect(queued.statusCode).toBe(200)
    expect(queued.json()).toMatchObject({ state: 'queued' })
  })

  it('refuses to let the browser name the canonical branch', async () => {
    const { app } = await buildTestApp()

    const response = await app.inject({
      method: 'POST',
      url: '/api/intake/linear',
      payload: { ...intake, canonicalBranch: 'ell/whatever-i-like' },
    })

    expect(response.statusCode).toBe(400)
  })

  it('refuses an issue that closed since the list was drawn', async () => {
    const linear = createFakeLinearAdapter({
      issues: [aLinearIssue({ stateName: 'Done', stateType: 'completed' })],
    })
    const { app } = await buildTestApp({ linear })

    const response = await app.inject({
      method: 'POST',
      url: '/api/intake/linear',
      payload: intake,
    })

    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({
      code: 'linear_issue_not_actionable',
    })
  })

  it('surfaces rate limiting and a rejected key distinctly', async () => {
    for (const [failure, status, code] of [
      [linearRateLimited(), 429, 'linear_rate_limited'],
      [linearUnauthorized(), 502, 'linear_unauthorized'],
      [linearNotConfigured(), 503, 'linear_not_configured'],
    ] as const) {
      const { app } = await buildTestApp({
        linear: createFakeLinearAdapter({ failWith: failure }),
      })

      const response = await app.inject({
        method: 'GET',
        url: '/api/intake/linear/teams',
      })

      expect(response.statusCode).toBe(status)
      expect(response.json()).toMatchObject({ code })
    }
  })
})

describe('one Linear issue over its whole life', () => {
  it('belongs to at most one live job', async () => {
    const { app } = await buildTestApp()

    await app.inject({
      method: 'POST',
      url: '/api/intake/linear',
      payload: intake,
    })
    const second = await app.inject({
      method: 'POST',
      url: '/api/intake/linear',
      payload: intake,
    })

    expect(second.statusCode).toBe(409)
    expect(second.json()).toMatchObject({
      code: 'linear_issue_already_linked',
    })
  })

  it('is released when the job that held it is cancelled', async () => {
    const { app, store } = await buildTestApp()

    const first = await app.inject({
      method: 'POST',
      url: '/api/intake/linear',
      payload: intake,
    })
    store.transitionJob({
      actor: 'handler',
      jobId: first.json().id,
      to: 'cancelled',
    })

    const second = await app.inject({
      method: 'POST',
      url: '/api/intake/linear',
      payload: intake,
    })

    expect(second.statusCode).toBe(201)
  })

  it('can be taken again after it merges, on its own branch', async () => {
    const { app, store } = await buildTestApp()

    const first = await app.inject({
      method: 'POST',
      url: '/api/intake/linear',
      payload: intake,
    })
    expect(first.json().canonicalBranch).toBe(
      'ell/eng-412-fix-flaky-login-test',
    )

    for (const to of toMerged) {
      store.transitionJob({ actor: 'handler', jobId: first.json().id, to })
    }

    const second = await app.inject({
      method: 'POST',
      url: '/api/intake/linear',
      payload: intake,
    })
    expect(second.statusCode).toBe(201)
    expect(second.json().canonicalBranch).toBe(
      'ell/eng-412-fix-flaky-login-test-2',
    )

    for (const to of toMerged) {
      store.transitionJob({ actor: 'handler', jobId: second.json().id, to })
    }

    const third = await app.inject({
      method: 'POST',
      url: '/api/intake/linear',
      payload: intake,
    })
    expect(third.json().canonicalBranch).toBe(
      'ell/eng-412-fix-flaky-login-test-3',
    )
  })
})

describe('POST /api/intake/adhoc', () => {
  it('creates the Linear issue before the job, and links what came back', async () => {
    const linear = createFakeLinearAdapter({ teams: [aLinearTeam()] })
    const { app } = await buildTestApp({ linear })

    const response = await app.inject({
      method: 'POST',
      url: '/api/intake/adhoc',
      payload: {
        teamId: 'e3f4a5b6-7c8d-49e0-b1f2-3a4b5c6d7e8f',
        title: 'Retire the legacy exporter',
        description: 'Nothing calls it any more.',
        priority: 3,
        workClass: 'feature',
        repositoryId: testRepositoryId,
        baseBranch: 'dev',
      },
    })

    expect(response.statusCode).toBe(201)
    expect(linear.createCalls[0]).toEqual({
      teamId: 'e3f4a5b6-7c8d-49e0-b1f2-3a4b5c6d7e8f',
      title: 'Retire the legacy exporter',
      description: 'Nothing calls it any more.',
      priority: 3,
    })
    expect(response.json()).toMatchObject({
      source: 'adhoc',
      state: 'intake',
      title: 'Retire the legacy exporter',
      // Honoured verbatim: nothing proposes a work class.
      workClass: 'feature',
      linearIssueKey: 'ENG-901',
      canonicalBranch: 'ell/eng-901-retire-the-legacy-exporter',
    })
  })
})

describe('GET /api/intake/base-branches', () => {
  it('offers the default on its own, before anything has been used', async () => {
    const { app } = await buildTestApp()

    const response = await app.inject({
      method: 'GET',
      url: '/api/intake/base-branches',
    })

    expect(response.json()).toEqual({ defaultBranch: 'dev', recent: [] })
  })

  it('offers what this installation has actually used, newest first', async () => {
    const context = createTestContext()
    const { app } = await buildTestApp({ context })

    for (const [index, baseBranch] of ['dev', 'main', 'release/24'].entries()) {
      context.store.createJobForLinearIssue({
        baseBranch,
        repositoryId: testRepositoryId,
        issue: aLinearIssueLink({
          branchName: `ell/eng-${index}-something`,
          id: `issue-${index}`,
          identifier: `ENG-${index}`,
          title: 'Something',
          url: `https://linear.app/acme/issue/ENG-${index}`,
        }),
        source: 'linear',
        workClass: 'routine',
      })
    }

    const response = await app.inject({
      method: 'GET',
      url: '/api/intake/base-branches',
    })

    expect(response.json()).toEqual({
      defaultBranch: 'dev',
      recent: ['release/24', 'main'],
    })
  })
})
