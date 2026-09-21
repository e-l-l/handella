import { existsSync } from 'node:fs'

import { afterEach, describe, expect, it } from 'vitest'

import type { GitAdapter } from '../src/adapters/git.js'
import { createDispatcher, worktreePathFor } from '../src/domain/dispatch.js'
import type { Store } from '../src/domain/store.js'
import {
  aGitFailure,
  aLinearIssue,
  aLinearIssueLink,
  aTemporaryDirectory,
  buildTestApp,
  cleanupTestContexts,
  createFakeGitAdapter,
  createFakeLinearAdapter,
  createTestContext,
  testRepositoryId,
  testRepositoryPath,
} from './helpers.js'

afterEach(cleanupTestContexts)

const branchName = 'ell/eng-412-fix-flaky-login-test'

const aJob = (store: Store, overrides: Record<string, unknown> = {}) =>
  store.createJobForLinearIssue({
    baseBranch: 'dev',
    issue: aLinearIssueLink({ branchName }),
    repositoryId: testRepositoryId,
    source: 'linear',
    workClass: 'routine',
    ...overrides,
  })

interface DispatcherOverrides {
  git?: ReturnType<typeof createFakeGitAdapter>
  linear?: ReturnType<typeof createFakeLinearAdapter>
}

const aDispatcher = (store: Store, overrides: DispatcherOverrides = {}) => {
  const git = overrides.git ?? createFakeGitAdapter()
  const worktreeRoot = aTemporaryDirectory('handella-worktrees-')
  return {
    git,
    worktreeRoot,
    dispatcher: createDispatcher({
      git,
      linear: overrides.linear ?? createFakeLinearAdapter(),
      store,
      worktreeRoot,
    }),
  }
}

describe('claiming the branch', () => {
  it('queues the job and fixes its canonical branch before git runs', async () => {
    const { store } = createTestContext()
    const job = aJob(store)
    const { dispatcher } = aDispatcher(store)

    const outcome = await dispatcher.dispatch(job.id)

    // The 202 carries this: queued, branch fixed, worktree not yet cut.
    expect(outcome.job).toMatchObject({
      state: 'queued',
      canonicalBranch: branchName,
      worktreePath: null,
    })
  })

  it('cuts the worktree under the repository, at the branch name', async () => {
    const { store } = createTestContext()
    const job = aJob(store)
    const { dispatcher, worktreeRoot } = aDispatcher(store)

    const outcome = await dispatcher.dispatch(job.id)
    const settled = await outcome.worktree

    const expected = worktreePathFor(worktreeRoot, testRepositoryId, branchName)
    expect(settled.worktreePath).toBe(expected)
    expect(existsSync(expected)).toBe(true)
  })

  it('fetches the base before cutting anything from it', async () => {
    const { store } = createTestContext()
    const job = aJob(store, { baseBranch: 'main' })
    const { dispatcher, git } = aDispatcher(store)

    await (
      await dispatcher.dispatch(job.id)
    ).worktree

    expect(git.fetched).toEqual([
      { base: 'main', repositoryPath: testRepositoryPath },
    ])
    expect(git.added[0]).toMatchObject({ base: 'main', branch: branchName })
  })

  it('re-reads the branch from Linear rather than trusting what intake stored', async () => {
    const { store } = createTestContext()
    const job = aJob(store, {
      issue: aLinearIssueLink({ branchName: 'ell/stale-name-from-intake' }),
    })
    const { dispatcher } = aDispatcher(store)

    const outcome = await dispatcher.dispatch(job.id)

    // The fake answers with its own branch name, which is what Linear holds now.
    expect(outcome.job.canonicalBranch).toBe(branchName)
  })

  it('refuses a job that names no repository', async () => {
    const { store } = createTestContext()
    const job = store.createJob({
      source: 'adhoc',
      title: 'Recovery job',
      workClass: 'routine',
      baseBranch: 'dev',
    })
    const { dispatcher } = aDispatcher(store)

    await expect(dispatcher.dispatch(job.id)).rejects.toMatchObject({
      code: 'transition_guard_failed',
    })
  })

  it('refuses a second live job on the same branch', async () => {
    const { store } = createTestContext()
    const otherIssue = aLinearIssue({
      branchName,
      id: 'f1e2d3c4-b5a6-4978-8a9b-0c1d2e3f4a5b',
      identifier: 'ENG-999',
    })
    // Two issues Linear happens to name the same branch. A repeat of one issue
    // would take ADR 0004's suffix instead, so this is the only way two live
    // jobs can want one name.
    const linear = createFakeLinearAdapter({
      issues: [aLinearIssue(), otherIssue],
    })

    const first = aJob(store)
    const { dispatcher } = aDispatcher(store, { linear })
    await dispatcher.dispatch(first.id)

    const second = aJob(store, { issue: aLinearIssueLink(otherIssue) })

    await expect(dispatcher.dispatch(second.id)).rejects.toMatchObject({
      code: 'canonical_branch_claimed',
    })
  })

  it('applies ADR 0004 suffix to the round it actually is', async () => {
    const { store } = createTestContext()
    const first = aJob(store)
    store.transitionJob({ actor: 'handler', jobId: first.id, to: 'cancelled' })
    const second = aJob(store)
    const { dispatcher } = aDispatcher(store)

    const outcome = await dispatcher.dispatch(second.id)

    expect(outcome.job.canonicalBranch).toBe(`${branchName}-2`)
  })
})

describe('when git fails', () => {
  it('gives the claim back and says why', async () => {
    const { store } = createTestContext()
    const job = aJob(store)
    const git = createFakeGitAdapter()
    git.failNextWith = aGitFailure('fatal: not a git repository')
    const { dispatcher } = aDispatcher(store, { git })

    const outcome = await dispatcher.dispatch(job.id)
    const settled = await outcome.worktree

    expect(settled).toMatchObject({
      state: 'intake',
      canonicalBranch: null,
      worktreePath: null,
    })
  })

  it('raises a failure attention item rather than leaving it to be noticed', async () => {
    const { store } = createTestContext()
    const job = aJob(store)
    const git = createFakeGitAdapter()
    git.failNextWith = aGitFailure('fatal: not a git repository')
    const { dispatcher } = aDispatcher(store, { git })

    await (
      await dispatcher.dispatch(job.id)
    ).worktree

    const items = store.listAttentionItems()
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ jobId: job.id, kind: 'failure' })
    expect(items[0]?.body).toContain('not a git repository')
  })

  it('leaves the branch free for the next attempt', async () => {
    const { store } = createTestContext()
    const job = aJob(store)
    const failing = createFakeGitAdapter()
    failing.failNextWith = aGitFailure()
    await (
      await aDispatcher(store, { git: failing }).dispatcher.dispatch(job.id)
    ).worktree

    const outcome = await aDispatcher(store).dispatcher.dispatch(job.id)
    const settled = await outcome.worktree

    expect(settled).toMatchObject({
      state: 'queued',
      canonicalBranch: branchName,
    })
    expect(settled.worktreePath).not.toBeNull()
  })

  it('refuses a branch that exists in git but no job owns', async () => {
    const { store } = createTestContext()
    const job = aJob(store)
    const git = createFakeGitAdapter({ existingBranches: [branchName] })
    const { dispatcher } = aDispatcher(store, { git })

    const settled = await (await dispatcher.dispatch(job.id)).worktree

    expect(settled.state).toBe('intake')
    expect(store.listAttentionItems()[0]?.body).toContain(branchName)
    expect(git.added).toEqual([])
  })
})

describe('POST /api/jobs/:jobId/dispatch', () => {
  it('answers 202 with the queued job', async () => {
    const { app, store } = await buildTestApp()
    const job = aJob(store)

    const response = await app.inject({
      method: 'POST',
      url: `/api/jobs/${job.id}/dispatch`,
    })

    expect(response.statusCode).toBe(202)
    expect(response.json()).toMatchObject({
      state: 'queued',
      canonicalBranch: branchName,
    })
  })

  it('answers 404 for a job that is not there', async () => {
    const { app } = await buildTestApp()

    const response = await app.inject({
      method: 'POST',
      url: '/api/jobs/00000000-0000-4000-8000-000000000000/dispatch',
    })

    expect(response.statusCode).toBe(404)
  })

  it('answers 409 when the job has already been dispatched', async () => {
    const { app, store } = await buildTestApp()
    const job = aJob(store)
    await app.inject({ method: 'POST', url: `/api/jobs/${job.id}/dispatch` })

    const again = await app.inject({
      method: 'POST',
      url: `/api/jobs/${job.id}/dispatch`,
    })

    expect(again.statusCode).toBe(409)
    expect(again.json()).toMatchObject({ code: 'illegal_transition' })
  })
})

/**
 * A git that takes a tick to fetch, so a second cut allowed to start would be
 * running while the first still is. The fake underneath resolves immediately,
 * which is exactly why nothing else in this file can see an overlap.
 */
const anObservedGit = () => {
  const fake = createFakeGitAdapter()
  let live = 0
  let overlapped = false

  const git: GitAdapter = {
    ...fake,
    async fetchBase(repositoryPath, base) {
      live += 1
      if (live > 1) overlapped = true
      await new Promise((resolve) => setTimeout(resolve, 0))
      await fake.fetchBase(repositoryPath, base)
    },
    async addWorktree(input) {
      await fake.addWorktree(input)
      live -= 1
    },
  }

  return { fake, git, overlapped: () => overlapped }
}

describe('two jobs dispatched at once', () => {
  it('cuts one worktree at a time in a checkout', async () => {
    const { store } = createTestContext()
    const other = aLinearIssue({
      id: 'c3c0f6b7-1a2f-4d7c-8b4a-3c2d5e6f7081',
      identifier: 'ENG-413',
      title: 'Drop the retry loop',
      branchName: 'ell/eng-413-drop-the-retry-loop',
    })

    const first = aJob(store)
    const second = aJob(store, { issue: aLinearIssueLink(other) })
    const { fake, git, overlapped } = anObservedGit()
    const { dispatcher } = aDispatcher(store, {
      git,
      linear: createFakeLinearAdapter({ issues: [aLinearIssue(), other] }),
    })

    // Both claims first, the way Intake takes a Selection: the 202 lands long
    // before the cut it started.
    const outcomes = await Promise.all([
      dispatcher.dispatch(first.id),
      dispatcher.dispatch(second.id),
    ])
    const cut = await Promise.all(outcomes.map((outcome) => outcome.worktree))

    // Two git processes in one checkout is two writers on one `.git`, which
    // is a lock contention failure rather than a slow dispatch.
    expect(overlapped()).toBe(false)
    expect(fake.added.map((input) => input.branch)).toEqual([
      branchName,
      other.branchName,
    ])
    expect(cut.map((job) => job.worktreePath)).not.toContain(null)
  })
})
