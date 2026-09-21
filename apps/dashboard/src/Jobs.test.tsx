import type { AttentionItem } from '@handella/contracts'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  installFakeEventSource,
  latestEventSource,
} from './test/fakeEventSource.ts'
import { aJob } from './test/fixtures.ts'
import { renderAt } from './test/renderApp.tsx'
import { jsonResponse, postsTo, stubApi } from './test/stubApi.ts'

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

describe('the housekeeping Reconciliation reports', () => {
  const orphans = anAttentionItem({
    body: '- /Users/handler/.data/worktrees/repo/ell/abandoned',
    id: '523e4567-e89b-42d3-a456-426614174000',
    // Standalone: the whole point is that no Job claims these.
    jobId: null,
    kind: 'orphanWorktree',
    title: 'Worktrees no job claims',
  })

  const overlap = anAttentionItem({
    body: 'ENG-9 — Rework the session store also plans to touch:\n- src/store.ts',
    id: '623e4567-e89b-42d3-a456-426614174000',
    kind: 'overlapWarning',
    title: 'Another job plans to touch the same files',
  })

  it('names the paths it found and promises not to delete them', async () => {
    stubApi({ attention: [orphans], jobs: [] })

    renderAt('/')

    expect(
      await screen.findByText('Worktrees no job claims'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('- /Users/handler/.data/worktrees/repo/ell/abandoned'),
    ).toBeInTheDocument()
    expect(screen.getByText(/never deletes them/)).toBeInTheDocument()
    // Standalone, so there is no job to open.
    expect(screen.queryByRole('link', { name: 'Open job' })).toBeNull()
  })

  it('says an overlap costs the jobs nothing', async () => {
    stubApi({ attention: [overlap], jobs: [aJob({ state: 'approved' })] })

    renderAt('/')

    expect(
      await screen.findByText('Another job plans to touch the same files'),
    ).toBeInTheDocument()
    expect(screen.getByText(/src\/store\.ts/)).toBeInTheDocument()
    // masterplan.md:56 — a warning, and never a reason to serialise.
    expect(screen.getByText(/nothing is serialised/)).toBeInTheDocument()
  })

  it('collects both behind one filter, away from the failures', async () => {
    stubApi({
      attention: [anAttentionItem(), orphans, overlap],
      jobs: [],
    })
    const user = userEvent.setup()

    renderAt('/')
    await screen.findByText('Worktrees no job claims')
    await user.click(screen.getByRole('button', { name: 'Housekeeping' }))

    expect(screen.getByText('Worktrees no job claims')).toBeInTheDocument()
    expect(
      screen.getByText('Another job plans to touch the same files'),
    ).toBeInTheDocument()
    // Neither is a Job that has stopped, so neither belongs with the blockers.
    expect(screen.queryByText('Job stopped and needs a decision')).toBeNull()
  })
})

describe('the job detail page', () => {
  it('offers only the moves the state machine allows', async () => {
    stubApi({ jobs: [aJob({ state: 'intake' })] })

    renderAt(`/jobs/${aJob().id}`)

    expect(
      await screen.findByRole('button', { name: 'Move to Cancelled' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Move to Planning' }),
    ).toBeNull()
    expect(screen.queryByRole('button', { name: 'Move to Merged' })).toBeNull()
  })

  it('offers Dispatch in place of a move to queued', async () => {
    stubApi({ jobs: [aJob({ state: 'intake' })] })

    renderAt(`/jobs/${aJob().id}`)

    expect(
      await screen.findByRole('button', { name: 'Dispatch' }),
    ).toBeInTheDocument()
    // The edge exists, but walking it by hand would claim no branch and cut no
    // worktree, so the derived buttons leave it out.
    expect(screen.queryByRole('button', { name: 'Move to Queued' })).toBeNull()
  })

  it('will not dispatch a job Linear has not named a branch for', async () => {
    stubApi({
      jobs: [aJob({ state: 'intake', canonicalBranch: null })],
    })

    renderAt(`/jobs/${aJob().id}`)

    expect(
      await screen.findByRole('button', { name: 'Dispatch' }),
    ).toBeDisabled()
  })

  it('dispatches through its own endpoint, not through a transition', async () => {
    const fetchMock = stubApi({ jobs: [aJob({ state: 'intake' })] })

    renderAt(`/jobs/${aJob().id}`)
    await userEvent.click(
      await screen.findByRole('button', { name: 'Dispatch' }),
    )

    await waitFor(() => {
      expect(postsTo(fetchMock, '/dispatch')).toHaveLength(1)
    })
  })

  it('stops offering Dispatch once the job is queued', async () => {
    stubApi({ jobs: [aJob({ state: 'queued' })] })

    renderAt(`/jobs/${aJob().id}`)

    expect(
      await screen.findByRole('button', { name: 'Move to Planning' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Dispatch' })).toBeNull()
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
    // Including Suspend: a job that is over is not a job that is stopped, and
    // the service refuses to suspend one.
    expect(screen.queryByRole('button', { name: 'Suspend' })).toBeNull()
  })
})

describe('the jobs list', () => {
  it('dispatches from the row, without opening the job first', async () => {
    const fetchMock = stubApi({ attention: [], jobs: [aJob()] })

    renderAt('/jobs')
    await userEvent.click(
      await screen.findByRole('button', { name: 'Dispatch' }),
    )

    await waitFor(() => {
      expect(postsTo(fetchMock, '/dispatch')).toHaveLength(1)
    })
  })

  it('keeps the row itself a link to the job', async () => {
    stubApi({ attention: [], jobs: [aJob()] })

    renderAt('/jobs')

    expect(
      await screen.findByRole('link', {
        name: 'Open ad hoc: Fix the flaky login test',
      }),
    ).toHaveAttribute('href', `/jobs/${aJob().id}`)
  })

  it('resumes the codex session of a job that has one', async () => {
    const fetchMock = stubApi({
      attention: [],
      jobs: [
        aJob({
          codexSessionId: '0198f2c1-7a3e-7bd2-9f10-2c4a6b8e0d31',
          state: 'planning',
          worktreePath: '/Users/ell/.data/worktrees/eng-412/job',
        }),
      ],
    })

    renderAt('/jobs')
    await userEvent.click(
      await screen.findByRole('button', { name: 'Open session' }),
    )

    await waitFor(() => {
      expect(postsTo(fetchMock, '/terminal')).toHaveLength(1)
    })
  })

  it('opens a terminal in the worktree of a job that has not planned yet', async () => {
    const fetchMock = stubApi({
      attention: [],
      jobs: [
        aJob({
          state: 'planning',
          worktreePath: '/Users/ell/.data/worktrees/eng-412/job',
        }),
      ],
    })

    renderAt('/jobs')
    await userEvent.click(
      await screen.findByRole('button', { name: 'Open terminal' }),
    )

    await waitFor(() => {
      expect(postsTo(fetchMock, '/terminal')).toHaveLength(1)
    })
  })

  it('offers no terminal before dispatch has cut a worktree', async () => {
    stubApi({ attention: [], jobs: [aJob({ state: 'intake' })] })

    renderAt('/jobs')
    await screen.findByText('Fix the flaky login test')

    expect(screen.queryByRole('button', { name: 'Open terminal' })).toBeNull()
  })

  it('says so when there is no terminal to open', async () => {
    stubApi({
      attention: [],
      jobs: [aJob({ state: 'planning', worktreePath: '/tmp/worktree' })],
      extra: (url, init) =>
        String(url).endsWith('/terminal') && init?.method === 'POST'
          ? jsonResponse(
              {
                code: 'terminal_unavailable',
                message: 'Terminal could not be opened at /tmp/worktree',
              },
              502,
            )
          : undefined,
    })

    renderAt('/jobs')
    await userEvent.click(
      await screen.findByRole('button', { name: 'Open terminal' }),
    )

    expect(
      await screen.findByText('Terminal could not be opened at /tmp/worktree'),
    ).toBeInTheDocument()
  })

  it('leaves cancelling to the job page, where there is room to mean it', async () => {
    stubApi({ attention: [], jobs: [aJob()] })

    renderAt('/jobs')
    await screen.findByText('Fix the flaky login test')

    expect(
      screen.queryByRole('button', { name: 'Move to Cancelled' }),
    ).toBeNull()
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

  it('offers to ask GitHub about a merge while a pull request is open', async () => {
    const fetchMock = stubApi({
      jobs: [
        aJob({
          state: 'prOpen',
          originalPrUrl: 'https://github.com/acme/monorepo/pull/41',
          worktreePath: '/Users/handler/.data/worktrees/repo/ell/eng-412',
        }),
      ],
    })
    const user = userEvent.setup()

    renderAt(`/jobs/${aJob().id}`)
    await user.click(await screen.findByRole('button', { name: 'Check merge' }))

    expect(postsTo(fetchMock, '/check-merge')).toHaveLength(1)
  })

  it('does not offer it for a job with no pull request to ask about', async () => {
    stubApi({ jobs: [aJob({ state: 'implementing' })] })

    renderAt(`/jobs/${aJob().id}`)
    await screen.findByText('Fix the flaky login test')

    // The dashboard does not offer what the service would do nothing about.
    expect(screen.queryByRole('button', { name: 'Check merge' })).toBeNull()
  })

  it('reads a merged job’s missing worktree as the end of its life', async () => {
    stubApi({ jobs: [aJob({ state: 'merged', worktreePath: null })] })

    renderAt(`/jobs/${aJob().id}`)

    // Removed once the merge was confirmed, which is not the same absence as
    // a cut that never finished.
    expect(await screen.findByText('removed after merge')).toBeInTheDocument()
  })

  it('still reads a lost cut as a lost cut', async () => {
    stubApi({ jobs: [aJob({ state: 'queued', worktreePath: null })] })

    renderAt(`/jobs/${aJob().id}`)

    expect(await screen.findByText('not cut')).toBeInTheDocument()
  })
})
