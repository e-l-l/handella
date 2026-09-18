import type { AttentionItem, Job } from '@handella/contracts'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  installFakeEventSource,
  latestEventSource,
} from './test/fakeEventSource.ts'
import { aJob } from './test/fixtures.ts'
import { renderAt } from './test/renderApp.tsx'

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
  localStorage.clear()
})

describe('the attention inbox', () => {
  it('shows what needs the Handler and what is in flight', async () => {
    stubApi({
      attention: [anAttentionItem()],
      jobs: [aJob({ state: 'queued' })],
    })

    renderAt('/')

    expect(
      await screen.findByText('Job stopped and needs a decision'),
    ).toBeInTheDocument()
    // A dispatched job holds a queue position, so the rail carries it under
    // Queue rather than the inbox burying it in the list.
    expect(await screen.findByText('Queue')).toBeInTheDocument()
    expect(screen.getByText('Fix the flaky login test')).toBeInTheDocument()
  })

  it('leaves a job that is only taken out of the queue', async () => {
    // Only Dispatch puts a Job in the queue, so an `intake` job holds no
    // position and is not counted among those waiting for a slot.
    stubApi({ attention: [], jobs: [aJob({ state: 'intake' })] })

    renderAt('/')

    expect(await screen.findByText('Nothing is queued.')).toBeInTheDocument()
    expect(screen.getByText('0 waiting for a slot')).toBeInTheDocument()
  })

  it('does not seat a suspended job in the queue it cannot be started from', async () => {
    stubApi({
      attention: [],
      jobs: [aJob({ state: 'queued', suspension: 'stoppedByHandler' })],
    })

    renderAt('/')

    expect(await screen.findByText('Nothing is queued.')).toBeInTheDocument()
  })

  it('says so plainly when nothing is waiting', async () => {
    stubApi({ attention: [], jobs: [] })

    renderAt('/')

    expect(
      await screen.findByText('Nothing is waiting on you.'),
    ).toBeInTheDocument()
  })

  it('carries the count of what is waiting on the nav', async () => {
    stubApi({
      attention: [
        anAttentionItem(),
        anAttentionItem({ id: '323e4567-e89b-42d3-a456-426614174000' }),
      ],
      jobs: [],
    })

    renderAt('/jobs')

    expect(await screen.findByLabelText('2 waiting on you')).toBeInTheDocument()
  })

  it('draws no nav badge when nothing is waiting', async () => {
    stubApi({ attention: [], jobs: [] })

    renderAt('/jobs')

    await screen.findByRole('link', { name: 'New job' })
    expect(screen.queryByLabelText('0 waiting on you')).toBeNull()
  })
})

describe('the attention inbox filters', () => {
  const approval = anAttentionItem({
    id: '423e4567-e89b-42d3-a456-426614174000',
    kind: 'planApproval',
    title: 'A plan is waiting for you',
  })

  it('shows only the kinds behind the filter the Handler picked', async () => {
    stubApi({ attention: [anAttentionItem(), approval], jobs: [] })
    const user = userEvent.setup()

    renderAt('/')
    await screen.findByText('A plan is waiting for you')
    await user.click(screen.getByRole('button', { name: 'Approvals' }))

    expect(screen.getByText('A plan is waiting for you')).toBeInTheDocument()
    expect(screen.queryByText('Job stopped and needs a decision')).toBeNull()
  })

  it('keeps the count of everything waiting while a filter hides some of it', async () => {
    stubApi({ attention: [anAttentionItem(), approval], jobs: [] })
    const user = userEvent.setup()

    renderAt('/')
    await screen.findByText('A plan is waiting for you')
    await user.click(screen.getByRole('button', { name: 'Approvals' }))

    // The badge counts what needs the Handler, not what this filter shows.
    const header = screen.getByRole('heading', { name: 'Needs you' })
    expect(header.closest('div')).toHaveTextContent('2')
  })

  it('remembers the filter, so a reload does not lose the Handler their place', async () => {
    stubApi({ attention: [anAttentionItem(), approval], jobs: [] })
    const user = userEvent.setup()

    const first = renderAt('/')
    await screen.findByText('A plan is waiting for you')
    await user.click(screen.getByRole('button', { name: 'Approvals' }))
    first.unmount()

    renderAt('/')

    expect(
      await screen.findByText('A plan is waiting for you'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Job stopped and needs a decision')).toBeNull()
  })

  it('falls back to everything when the stored filter is one this build lost', async () => {
    localStorage.setItem('handella.inbox.filter', 'triage')
    stubApi({ attention: [anAttentionItem(), approval], jobs: [] })

    renderAt('/')

    expect(
      await screen.findByText('Job stopped and needs a decision'),
    ).toBeInTheDocument()
    expect(screen.getByText('A plan is waiting for you')).toBeInTheDocument()
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
