import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  aDispatchableJob,
  aJobAwaitingMerge,
  aPullRequest,
  aTemporaryDirectory,
  anIntakeJob,
  buildTestApp,
  cleanupTestContexts,
  type FakeGitHubAdapter,
} from './helpers.js'

afterEach(cleanupTestContexts)

describe('POST /api/jobs', () => {
  it('creates a job at intake', async () => {
    const { app } = await buildTestApp()

    const response = await app.inject({
      method: 'POST',
      url: '/api/jobs',
      payload: anIntakeJob(),
    })

    expect(response.statusCode).toBe(201)
    expect(response.json()).toMatchObject({
      state: 'intake',
      suspension: null,
      canonicalBranch: null,
    })
  })

  it('rejects an unknown work class before it reaches the store', async () => {
    const { app } = await buildTestApp()

    const response = await app.inject({
      method: 'POST',
      url: '/api/jobs',
      payload: { ...anIntakeJob(), workClass: 'chore' },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ code: 'validation_failed' })
  })

  it('rejects properties the contract does not declare', async () => {
    const { app } = await buildTestApp()

    const response = await app.inject({
      method: 'POST',
      url: '/api/jobs',
      payload: { ...anIntakeJob(), state: 'merged' },
    })

    expect(response.statusCode).toBe(400)
  })
})

describe('reading jobs', () => {
  it('lists what has been created', async () => {
    const { app, store } = await buildTestApp()
    store.createJob(anIntakeJob())

    const response = await app.inject({ method: 'GET', url: '/api/jobs' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toHaveLength(1)
  })

  it('reports an unknown job as a typed 404', async () => {
    const { app } = await buildTestApp()

    const response = await app.inject({
      method: 'GET',
      url: '/api/jobs/123e4567-e89b-42d3-a456-426614174000',
    })

    expect(response.statusCode).toBe(404)
    expect(response.json()).toMatchObject({ code: 'job_not_found' })
  })
})

describe('POST /api/jobs/:jobId/transitions', () => {
  it('moves a job and refuses the same move twice', async () => {
    const { app, store } = await buildTestApp()
    const job = store.createJob(aDispatchableJob())

    const first = await app.inject({
      method: 'POST',
      url: `/api/jobs/${job.id}/transitions`,
      payload: { to: 'queued' },
    })
    expect(first.statusCode).toBe(200)
    expect(first.json()).toMatchObject({ state: 'queued' })

    const second = await app.inject({
      method: 'POST',
      url: `/api/jobs/${job.id}/transitions`,
      payload: { to: 'queued' },
    })
    expect(second.statusCode).toBe(409)
    expect(second.json()).toMatchObject({ code: 'illegal_transition' })
  })

  it('reports a failed guard separately from an illegal edge', async () => {
    const { app, store } = await buildTestApp()
    const job = store.createJob(anIntakeJob())

    const response = await app.inject({
      method: 'POST',
      url: `/api/jobs/${job.id}/transitions`,
      payload: { to: 'queued' },
    })

    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ code: 'transition_guard_failed' })
  })

  it('rejects a target that is not a state', async () => {
    const { app, store } = await buildTestApp()
    const job = store.createJob(aDispatchableJob())

    const response = await app.inject({
      method: 'POST',
      url: `/api/jobs/${job.id}/transitions`,
      payload: { to: 'paused' },
    })

    expect(response.statusCode).toBe(400)
  })

  it('records history a client can read back', async () => {
    const { app, store } = await buildTestApp()
    const job = store.createJob(aDispatchableJob())
    await app.inject({
      method: 'POST',
      url: `/api/jobs/${job.id}/transitions`,
      payload: { to: 'queued', reason: 'Branch confirmed' },
    })

    const response = await app.inject({
      method: 'GET',
      url: `/api/jobs/${job.id}/transitions`,
    })

    expect(response.json()).toMatchObject([
      { fromState: 'intake', toState: 'queued', reason: 'Branch confirmed' },
    ])
  })
})

describe('the optimistic lock on a transition', () => {
  it('applies a move decided against the state the job is still in', async () => {
    const { app, store } = await buildTestApp()
    const job = store.createJob(aDispatchableJob())

    const response = await app.inject({
      method: 'POST',
      url: `/api/jobs/${job.id}/transitions`,
      payload: { to: 'queued', expectedState: 'intake' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ state: 'queued' })
  })

  it('refuses a move decided against a state the job has already left', async () => {
    const { app, store } = await buildTestApp()
    const job = store.createJob(aDispatchableJob())
    store.transitionJob({ actor: 'handler', jobId: job.id, to: 'queued' })

    const response = await app.inject({
      method: 'POST',
      url: `/api/jobs/${job.id}/transitions`,
      payload: { to: 'planning', expectedState: 'intake' },
    })

    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ code: 'state_conflict' })
  })
})

describe('the supporting record endpoints', () => {
  it('serves an empty list for a job with no snapshots or rounds', async () => {
    const { app, store } = await buildTestApp()
    const job = store.createJob(anIntakeJob())

    for (const path of ['runbook-snapshots', 'review-rounds']) {
      const response = await app.inject({
        method: 'GET',
        url: `/api/jobs/${job.id}/${path}`,
      })
      expect(response.statusCode, path).toBe(200)
      expect(response.json(), path).toEqual([])
    }
  })

  it('reports an unknown job as a typed 404', async () => {
    const { app } = await buildTestApp()

    for (const path of ['runbook-snapshots', 'review-rounds']) {
      const response = await app.inject({
        method: 'GET',
        url: `/api/jobs/123e4567-e89b-42d3-a456-426614174000/${path}`,
      })
      expect(response.statusCode, path).toBe(404)
      expect(response.json(), path).toMatchObject({ code: 'job_not_found' })
    }
  })
})

describe('suspension endpoints', () => {
  it('suspends and resumes without moving the job', async () => {
    const { app, store } = await buildTestApp()
    const job = store.createJob(aDispatchableJob())

    const suspended = await app.inject({
      method: 'POST',
      url: `/api/jobs/${job.id}/suspension`,
      payload: { suspension: 'stoppedByHandler' },
    })
    expect(suspended.json()).toMatchObject({
      state: 'intake',
      suspension: 'stoppedByHandler',
    })

    const resumed = await app.inject({
      method: 'DELETE',
      url: `/api/jobs/${job.id}/suspension`,
    })
    expect(resumed.json()).toMatchObject({ state: 'intake', suspension: null })
  })

  it('refuses to suspend a job that has reached the end of its life', async () => {
    const { app, store } = await buildTestApp()
    const job = store.createJob(anIntakeJob())
    store.transitionJob({ actor: 'handler', jobId: job.id, to: 'cancelled' })

    const response = await app.inject({
      method: 'POST',
      url: `/api/jobs/${job.id}/suspension`,
      payload: { suspension: 'stoppedBySystem' },
    })

    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ code: 'suspension_not_allowed' })
  })
})

describe('POST /api/jobs/:jobId/check-merge', () => {
  const branch = 'ell/eng-0-something'

  it('confirms the merge the Handler has just made', async () => {
    const built = await buildTestApp()
    const jobId = await aJobAwaitingMerge(built.context, {
      git: built.git,
      worktreeRoot: built.worktreeRoot,
    })
    ;(built.github as FakeGitHubAdapter).pullRequests.set(
      branch,
      aPullRequest({ state: 'MERGED' }),
    )

    const response = await built.app.inject({
      method: 'POST',
      url: `/api/jobs/${jobId}/check-merge`,
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      state: 'merged',
      worktreePath: null,
    })
  })

  it('answers with the job unchanged when the pull request is still open', async () => {
    const built = await buildTestApp()
    const jobId = await aJobAwaitingMerge(built.context, {
      git: built.git,
      worktreeRoot: built.worktreeRoot,
    })
    ;(built.github as FakeGitHubAdapter).pullRequests.set(
      branch,
      aPullRequest({ state: 'OPEN' }),
    )

    const response = await built.app.inject({
      method: 'POST',
      url: `/api/jobs/${jobId}/check-merge`,
    })

    // Not an error: a pull request nobody has merged yet is an answer.
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ state: 'prOpen' })
  })

  it('reports an unknown job as a typed 404', async () => {
    const { app } = await buildTestApp()

    const response = await app.inject({
      method: 'POST',
      url: '/api/jobs/123e4567-e89b-42d3-a456-426614174000/check-merge',
    })

    expect(response.statusCode).toBe(404)
    expect(response.json()).toMatchObject({ code: 'job_not_found' })
  })
})

describe('the attention inbox endpoints', () => {
  it('lists open items and resolves one', async () => {
    const { app, store } = await buildTestApp()
    const job = store.createJob(aDispatchableJob())
    store.suspendJob({ jobId: job.id, suspension: 'stoppedBySystem' })

    const listed = await app.inject({ method: 'GET', url: '/api/attention' })
    const items = listed.json() as Array<{ id: string; kind: string }>
    expect(items).toHaveLength(1)
    expect(items[0]?.kind).toBe('blocker')

    const resolved = await app.inject({
      method: 'POST',
      url: `/api/attention/${items[0]?.id ?? ''}/resolve`,
    })
    expect(resolved.statusCode).toBe(200)

    const after = await app.inject({ method: 'GET', url: '/api/attention' })
    expect(after.json()).toEqual([])
  })

  it('reports an unknown item as a typed 404', async () => {
    const { app } = await buildTestApp()

    const response = await app.inject({
      method: 'POST',
      url: '/api/attention/123e4567-e89b-42d3-a456-426614174000/resolve',
    })

    expect(response.statusCode).toBe(404)
    expect(response.json()).toMatchObject({ code: 'attention_item_not_found' })
  })
})

describe('GET /api/events', () => {
  it('streams a named event when a job changes', async () => {
    const { app, store } = await buildTestApp()
    await app.listen({ host: '127.0.0.1', port: 0 })
    const address = app.server.address()
    if (address === null || typeof address === 'string') {
      throw new Error('expected a TCP address')
    }

    const connection = new AbortController()
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/events`,
      { headers: { accept: 'text/event-stream' }, signal: connection.signal },
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')

    const body = response.body
    if (body === null) throw new Error('expected a stream body')
    const reader = body.getReader()
    const decoder = new TextDecoder()

    const job = store.createJob(anIntakeJob())

    let received = ''
    while (!received.includes('job.changed')) {
      const chunk = await reader.read()
      if (chunk.done) throw new Error('stream closed before an event arrived')
      received += decoder.decode(chunk.value)
    }

    expect(received).toContain('event: job.changed')
    expect(received).toContain(job.id)

    connection.abort()
  })
})

describe('GET /api/jobs/:jobId/attempts/:attemptId/log', () => {
  it('starts a tail at a line boundary', async () => {
    const { app, store } = await buildTestApp()
    const job = store.createJob(aDispatchableJob())
    const logRoot = aTemporaryDirectory('handella-logs-')
    const attempt = store.startAttempt({
      jobId: job.id,
      logRoot,
      sessionId: 'session-1',
    })
    const logPath = store.attemptLogPath({
      attemptId: attempt.id,
      jobId: job.id,
    })
    mkdirSync(dirname(logPath), { recursive: true })
    // Comfortably longer than the tail the endpoint serves, so the cut lands
    // in the middle of a line rather than on one.
    const line = `{"filler":"${'x'.repeat(200)}"}`
    writeFileSync(
      logPath,
      `${Array.from({ length: 2_000 }, () => line).join('\n')}\n`,
    )

    const response = await app.inject({
      method: 'GET',
      url: `/api/jobs/${job.id}/attempts/${attempt.id}/log`,
    })

    expect(response.statusCode).toBe(200)
    expect(response.headers['x-handella-truncated']).toBe('true')
    const served = response.body.trim().split('\n')
    expect(served.length).toBeGreaterThan(0)
    for (const jsonl of served) {
      expect(() => JSON.parse(jsonl)).not.toThrow()
    }
  })
})
