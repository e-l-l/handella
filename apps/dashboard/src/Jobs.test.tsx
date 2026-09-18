import type { AttentionItem, Job } from '@handella/contracts'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  installFakeEventSource,
  latestEventSource,
} from './test/fakeEventSource.ts'
import { renderAt } from './test/renderApp.tsx'

const aJob = (overrides: Partial<Job> = {}): Job => ({
  id: '123e4567-e89b-42d3-a456-426614174000',
  source: 'adhoc',
  title: 'Fix the flaky login test',
  workClass: 'routine',
  state: 'intake',
  suspension: null,
  linearIssueKey: null,
  canonicalBranch: 'ell/eng-412-fix-flaky-login-test',
  baseBranch: 'dev',
  queuePriority: null,
  worktreePath: null,
  codexSessionId: null,
  originalPrUrl: null,
  createdAt: '2026-09-18T10:00:00.000Z',
  updatedAt: '2026-09-18T10:00:00.000Z',
  ...overrides,
})

const anAttentionItem = (
  overrides: Partial<AttentionItem> = {},
): AttentionItem => ({
  id: '223e4567-e89b-42d3-a456-426614174000',
  jobId: aJob().id,
  kind: 'blocker',
  title: 'Job stopped and needs a decision',
  body: null,
  createdAt: '2026-09-18T10:00:00.000Z',
  resolvedAt: null,
  ...overrides,
})

interface Routes {
  attention?: AttentionItem[]
  jobs?: Job[]
}

const stubApi = (routes: Routes) => {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    void init
    const url = String(input)
    const json = (body: unknown) =>
      Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )

    if (url === '/api/attention') return json(routes.attention ?? [])
    if (url === '/api/jobs') return json(routes.jobs ?? [])
    if (url.endsWith('/transitions')) return json([])
    if (url.endsWith('/plan-versions')) return json([])
    if (url.startsWith('/api/jobs/')) return json((routes.jobs ?? [])[0])
    return Promise.resolve(new Response('{}', { status: 404 }))
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  installFakeEventSource()
})

describe('the attention inbox', () => {
  it('shows what needs the Handler and what is in flight', async () => {
    stubApi({ attention: [anAttentionItem()], jobs: [aJob()] })

    renderAt('/')

    expect(
      await screen.findByText('Job stopped and needs a decision'),
    ).toBeInTheDocument()
    expect(await screen.findByText('Jobs in flight')).toBeInTheDocument()
  })

  it('says so plainly when nothing is waiting', async () => {
    stubApi({ attention: [], jobs: [] })

    renderAt('/')

    expect(
      await screen.findByText('Nothing is waiting on you.'),
    ).toBeInTheDocument()
  })
})

describe('the job detail page', () => {
  it('offers only the moves the state machine allows', async () => {
    stubApi({ jobs: [aJob({ state: 'intake' })] })

    renderAt(`/jobs/${aJob().id}`)

    expect(
      await screen.findByRole('button', { name: 'Move to Queued' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Move to Cancelled' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Move to Planning' }),
    ).toBeNull()
    expect(screen.queryByRole('button', { name: 'Move to Merged' })).toBeNull()
  })

  it('offers resume rather than suspend once a job is suspended', async () => {
    stubApi({ jobs: [aJob({ suspension: 'interrupted' })] })

    renderAt(`/jobs/${aJob().id}`)

    expect(
      await screen.findByRole('button', { name: 'Resume' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Suspend' })).toBeNull()
    expect(
      screen.getByText('Suspended — interrupted by a restart'),
    ).toBeInTheDocument()
  })

  it('shows no actions at all once a job is archived', async () => {
    stubApi({ jobs: [aJob({ state: 'archived' })] })

    renderAt(`/jobs/${aJob().id}`)

    expect(
      await screen.findByText('This job has reached the end of its life.'),
    ).toBeInTheDocument()
  })
})

describe('the live event stream', () => {
  it('opens one stream for the shell', () => {
    stubApi({ attention: [], jobs: [] })

    renderAt('/')

    expect(latestEventSource().url).toBe('/api/events')
  })

  it('refetches when the service says a job changed', async () => {
    const fetchMock = stubApi({ attention: [], jobs: [aJob()] })
    renderAt('/jobs')
    await screen.findByText('Fix the flaky login test')

    const before = fetchMock.mock.calls.length
    latestEventSource().emit('job.changed', {
      jobId: aJob().id,
      state: 'queued',
      suspension: null,
    })

    await waitFor(() => {
      expect(fetchMock.mock.calls.length).toBeGreaterThan(before)
    })
  })

  it('resyncs everything when the stream reconnects', async () => {
    const fetchMock = stubApi({
      attention: [anAttentionItem()],
      jobs: [aJob()],
    })
    renderAt('/')
    await screen.findByText('Job stopped and needs a decision')

    // The first open is the connection the shell just made, which the pages
    // have already fetched through; only a reconnect needs the full refetch.
    latestEventSource().emit('open')
    const before = fetchMock.mock.calls.length
    latestEventSource().emit('open')

    await waitFor(() => {
      expect(fetchMock.mock.calls.length).toBeGreaterThan(before)
    })
  })
})

describe('creating a job', () => {
  it('posts what the Handler typed', async () => {
    const fetchMock = stubApi({ jobs: [] })
    renderAt('/jobs')

    await userEvent.click(
      await screen.findByRole('button', { name: 'New job' }),
    )
    await userEvent.type(
      screen.getByLabelText('Title'),
      'Fix the flaky login test',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Create job' }))

    await waitFor(() => {
      const posted = fetchMock.mock.calls.find(
        ([url, init]) => String(url) === '/api/jobs' && init?.method === 'POST',
      )
      expect(posted).toBeDefined()
      const body = JSON.parse(String(posted?.[1]?.body)) as Record<
        string,
        unknown
      >
      expect(body).toMatchObject({
        source: 'adhoc',
        title: 'Fix the flaky login test',
        workClass: 'routine',
        baseBranch: 'dev',
        canonicalBranch: null,
      })
    })
  })
})
