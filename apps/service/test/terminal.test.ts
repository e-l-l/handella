import { afterEach, describe, expect, it } from 'vitest'

import { unavailableTerminal } from '../src/adapters/terminal.js'
import type { Store } from '../src/domain/store.js'
import {
  aLinearIssueLink,
  buildTestApp,
  cleanupTestContexts,
  createFakeTerminalOpener,
  testRepositoryId,
} from './helpers.js'

afterEach(cleanupTestContexts)

const worktreePath = '/Users/handler/.data/worktrees/acme/eng-412'
const sessionId = '0198f2c1-7a3e-7bd2-9f10-2c4a6b8e0d31'

const aJob = (store: Store) =>
  store.createJobForLinearIssue({
    baseBranch: 'dev',
    issue: aLinearIssueLink({ branchName: 'ell/eng-412-fix-flaky-login-test' }),
    repositoryId: testRepositoryId,
    source: 'linear',
    workClass: 'routine',
  })

describe('opening a terminal on a job’s codex session', () => {
  it('opens a plain shell in the worktree of a job that has not planned yet', async () => {
    const terminal = createFakeTerminalOpener()
    const { app, store } = await buildTestApp({ terminal })
    const job = aJob(store)
    store.recordWorktree({ jobId: job.id, worktreePath })

    const response = await app.inject({
      method: 'POST',
      url: `/api/jobs/${job.id}/terminal`,
    })

    expect(response.statusCode).toBe(204)
    expect(terminal.opened()).toEqual([{ path: worktreePath, sessionId: null }])
  })

  it('resumes the session of a job that has one', async () => {
    const terminal = createFakeTerminalOpener()
    const { app, store } = await buildTestApp({ terminal })
    const job = aJob(store)
    store.recordWorktree({ jobId: job.id, worktreePath })
    store.recordCodexSession({ jobId: job.id, sessionId })

    const response = await app.inject({
      method: 'POST',
      url: `/api/jobs/${job.id}/terminal`,
    })

    expect(response.statusCode).toBe(204)
    expect(terminal.opened()).toEqual([{ path: worktreePath, sessionId }])
  })

  it('refuses a job whose worktree has not been cut, without opening anything', async () => {
    const terminal = createFakeTerminalOpener()
    const { app, store } = await buildTestApp({ terminal })
    const job = aJob(store)

    const response = await app.inject({
      method: 'POST',
      url: `/api/jobs/${job.id}/terminal`,
    })

    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ code: 'worktree_not_cut' })
    expect(terminal.opened()).toEqual([])
  })

  it('answers 404 for a job that does not exist', async () => {
    const { app } = await buildTestApp()

    const response = await app.inject({
      method: 'POST',
      url: '/api/jobs/123e4567-e89b-42d3-a456-426614174000/terminal',
    })

    expect(response.statusCode).toBe(404)
  })

  it('reports a platform with no terminal rather than failing silently', async () => {
    const { app, store } = await buildTestApp({ terminal: unavailableTerminal })
    const job = aJob(store)
    store.recordWorktree({ jobId: job.id, worktreePath })

    const response = await app.inject({
      method: 'POST',
      url: `/api/jobs/${job.id}/terminal`,
    })

    expect(response.statusCode).toBe(502)
    expect(response.json()).toMatchObject({ code: 'terminal_unavailable' })
  })
})
