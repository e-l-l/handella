import { afterEach, describe, expect, it } from 'vitest'

import { unavailableFolderPicker } from '../src/adapters/folders.js'
import { DomainError } from '../src/domain/errors.js'
import {
  aCheckoutDirectory,
  aLinearIssueLink,
  aTemporaryDirectory,
  buildTestApp,
  cleanupTestContexts,
  createFakeFolderPicker,
  createTestContext,
  testRepositoryId,
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
      payload: aCheckout({ path: aCheckoutDirectory() }),
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
    // A real one, because the path check now runs before the index does and
    // this test is about the index.
    const path = aCheckoutDirectory()
    const payload = aCheckout({ path })
    await app.inject({ method: 'POST', url: '/api/repositories', payload })

    const response = await app.inject({
      method: 'POST',
      url: '/api/repositories',
      payload: { ...payload, name: 'the same checkout again' },
    })

    // The unique index is the backstop; nothing above it claims to have asked.
    expect(response.statusCode).toBe(500)
  })

  it('refuses a path that is not there at all', async () => {
    const { app } = await buildTestApp()

    const response = await app.inject({
      method: 'POST',
      url: '/api/repositories',
      payload: aCheckout({
        // A child of a directory that does exist: missing on any machine,
        // rather than missing on this one.
        path: `${aTemporaryDirectory('handella-missing-')}/no-such-checkout`,
      }),
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ code: 'repository_path_invalid' })
  })

  it('refuses a directory that is not a checkout', async () => {
    const { app } = await buildTestApp()

    const response = await app.inject({
      method: 'POST',
      url: '/api/repositories',
      payload: aCheckout({ path: aTemporaryDirectory('handella-plain-') }),
    })

    expect(response.statusCode).toBe(400)
    expect(response.json().message).toMatch(/no \.git/)
  })

  it('checks a path an update moves, and leaves a rename alone', async () => {
    const { app } = await buildTestApp()

    const moved = await app.inject({
      method: 'PATCH',
      url: `/api/repositories/${testRepositoryId}`,
      payload: { path: '/nowhere/at/all' },
    })
    expect(moved.statusCode).toBe(400)

    // The seeded row's own path does not exist either, which is the point:
    // a rename is not the moment to relitigate where a checkout went.
    const renamed = await app.inject({
      method: 'PATCH',
      url: `/api/repositories/${testRepositoryId}`,
      payload: { name: 'still fine' },
    })
    expect(renamed.statusCode).toBe(200)
  })
})

describe('choosing a path with the native dialog', () => {
  it('answers with what the Handler picked', async () => {
    const folders = createFakeFolderPicker({ path: '/Users/handler/acme' })
    const { app } = await buildTestApp({ folders })

    const response = await app.inject({
      method: 'POST',
      url: '/api/repositories/choose-path',
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ path: '/Users/handler/acme' })
    expect(folders.opened()).toBe(1)
  })

  it('treats a cancelled dialog as an answer rather than a failure', async () => {
    const folders = createFakeFolderPicker({ path: null })
    const { app } = await buildTestApp({ folders })

    const response = await app.inject({
      method: 'POST',
      url: '/api/repositories/choose-path',
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ path: null })
  })

  it('reports a platform with no dialog without refusing the form', async () => {
    const { app } = await buildTestApp({ folders: unavailableFolderPicker })

    const response = await app.inject({
      method: 'POST',
      url: '/api/repositories/choose-path',
    })

    expect(response.statusCode).toBe(502)
    expect(response.json()).toMatchObject({
      code: 'folder_picker_unavailable',
    })
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
