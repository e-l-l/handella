import { afterEach, describe, expect, it } from 'vitest'

import { DomainError } from '../src/domain/errors.js'
import {
  aLinearIssueLink,
  buildTestApp,
  cleanupTestContexts,
  createTestContext,
  testRepositoryId,
  testRepositoryPath,
} from './helpers.js'

afterEach(cleanupTestContexts)

const aCheckout = (overrides: Record<string, unknown> = {}) => ({
  name: 'other checkout',
  path: '/Users/ell/workspace/work/other',
  defaultBaseBranch: 'main',
  ...overrides,
})

describe('keeping repositories', () => {
  it('reads back what it was given', () => {
    const { store } = createTestContext()

    const created = store.createRepository(aCheckout())

    expect(created).toMatchObject({
      name: 'other checkout',
      path: '/Users/ell/workspace/work/other',
      defaultBaseBranch: 'main',
    })
    expect(store.getRepository(created.id)).toEqual(created)
  })

  it('lists them by name, so the order does not move as they are edited', () => {
    const { store } = createTestContext()
    store.createRepository(aCheckout({ name: 'zebra', path: '/tmp/z' }))
    store.createRepository(aCheckout({ name: 'alpha', path: '/tmp/a' }))

    expect(store.listRepositories().map((row) => row.name)).toEqual([
      'acme monorepo',
      'alpha',
      'zebra',
    ])
  })

  it('edits one field without disturbing the rest', () => {
    const { store } = createTestContext()
    const created = store.createRepository(aCheckout())

    const updated = store.updateRepository(created.id, { name: 'renamed' })

    expect(updated).toMatchObject({
      name: 'renamed',
      path: '/Users/ell/workspace/work/other',
      defaultBaseBranch: 'main',
    })
  })

  it('answers a missing repository with a typed 404', () => {
    const { store } = createTestContext()

    expect(() => store.getRepository('nope')).toThrow(DomainError)
    try {
      store.getRepository('nope')
    } catch (error) {
      expect((error as DomainError).code).toBe('repository_not_found')
      expect((error as DomainError).statusCode).toBe(404)
    }
  })
})

describe('removing a repository', () => {
  const aJobOn = (
    context: ReturnType<typeof createTestContext>,
    repositoryId: string,
  ) =>
    context.store.createJobForLinearIssue({
      baseBranch: 'dev',
      issue: aLinearIssueLink(),
      repositoryId,
      source: 'linear',
      workClass: 'routine',
    })

  it('refuses while a live job is still working in it', () => {
    const context = createTestContext()
    const job = aJobOn(context, testRepositoryId)

    try {
      context.store.deleteRepository(testRepositoryId)
      expect.unreachable('the delete should have been refused')
    } catch (error) {
      expect((error as DomainError).code).toBe('repository_in_use')
      expect((error as DomainError).message).toContain(job.id)
    }
  })

  it('lets go once every job on it has settled, keeping their history', () => {
    const context = createTestContext()
    const job = aJobOn(context, testRepositoryId)
    context.store.transitionJob({
      actor: 'handler',
      jobId: job.id,
      to: 'cancelled',
    })

    context.store.deleteRepository(testRepositoryId)

    expect(context.store.listRepositories()).toEqual([])
    // The job survives its repository; only the link is gone.
    expect(context.store.getJob(job.id)).toMatchObject({
      id: job.id,
      repositoryId: null,
    })
  })

  it('refuses a repository that was never there', () => {
    const { store } = createTestContext()

    expect(() => store.deleteRepository('nope')).toThrow(DomainError)
  })
})

describe('the repositories API', () => {
  it('creates, lists and removes over the wire', async () => {
    const { app } = await buildTestApp()

    const created = await app.inject({
      method: 'POST',
      url: '/api/repositories',
      payload: aCheckout(),
    })
    expect(created.statusCode).toBe(201)

    const listed = await app.inject({ method: 'GET', url: '/api/repositories' })
    expect(listed.json()).toHaveLength(2)

    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/repositories/${created.json().id}`,
    })
    expect(removed.statusCode).toBe(204)
  })

  it('refuses a relative path before it reaches the store', async () => {
    const { app } = await buildTestApp()

    const response = await app.inject({
      method: 'POST',
      url: '/api/repositories',
      payload: aCheckout({ path: '../elsewhere' }),
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ code: 'validation_failed' })
  })

  it('refuses a second repository on the same checkout', async () => {
    const { app } = await buildTestApp()

    const response = await app.inject({
      method: 'POST',
      url: '/api/repositories',
      payload: aCheckout({ path: testRepositoryPath }),
    })

    // The unique index is the backstop; nothing above it claims to have asked.
    expect(response.statusCode).toBe(500)
  })

  it('renames one in place', async () => {
    const { app } = await buildTestApp()

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/repositories/${testRepositoryId}`,
      payload: { name: 'renamed' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ name: 'renamed' })
  })
})

describe('intake against a repository', () => {
  it('refuses an issue bound to a repository that is not there', async () => {
    const { app } = await buildTestApp()

    const response = await app.inject({
      method: 'POST',
      url: '/api/intake/linear',
      payload: {
        issueId: 'b2b9e5a6-0f1e-4c6b-9a3f-2b1c4d5e6f70',
        workClass: 'routine',
        repositoryId: '00000000-0000-4000-8000-000000000000',
        baseBranch: 'dev',
      },
    })

    expect(response.statusCode).toBe(404)
    expect(response.json()).toMatchObject({ code: 'repository_not_found' })
  })
})

describe('base branches once a repository is chosen', () => {
  it('answers with the remote branches, not with what was typed before', async () => {
    const { app } = await buildTestApp()

    const response = await app.inject({
      method: 'GET',
      url: `/api/intake/base-branches?repositoryId=${testRepositoryId}`,
    })

    expect(response.statusCode).toBe(200)
    // The fake's remotes are dev and main; dev is the default and is reported
    // on its own field rather than appearing in the list twice.
    expect(response.json()).toEqual({
      defaultBranch: 'dev',
      recent: ['main'],
    })
  })

  it('still answers from history before a repository is chosen', async () => {
    const { app } = await buildTestApp()

    const response = await app.inject({
      method: 'GET',
      url: '/api/intake/base-branches',
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ defaultBranch: 'dev', recent: [] })
  })

  it('answers 404 for a repository that is not there', async () => {
    const { app } = await buildTestApp()

    const response = await app.inject({
      method: 'GET',
      url: '/api/intake/base-branches?repositoryId=00000000-0000-4000-8000-000000000000',
    })

    expect(response.statusCode).toBe(404)
    expect(response.json()).toMatchObject({ code: 'repository_not_found' })
  })
})
