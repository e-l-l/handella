import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  installFakeEventSource,
  latestEventSource,
} from './test/fakeEventSource.ts'
import { aJob, aMilestone, anAttempt } from './test/fixtures.ts'
import { renderAt } from './test/renderApp.tsx'
import { stubApi } from './test/stubApi.ts'

beforeEach(() => {
  installFakeEventSource()
  localStorage.clear()
})

const anImplementingJob = () =>
  aJob({
    state: 'implementing',
    codexSessionId: 'session-1',
    worktreePath: '/tmp/worktrees/ell/eng-412',
  })

describe('the implementation spine', () => {
  it('groups milestones under the turn that produced them', async () => {
    const job = anImplementingJob()
    stubApi({
      jobs: [job],
      attempts: [
        anAttempt({ endedAt: '2026-09-18T10:40:00.000Z', outcome: 'failed' }),
        anAttempt({
          id: 'cccccccc-e89b-42d3-a456-426614174000',
          startedAt: '2026-09-18T10:41:00.000Z',
        }),
      ],
      milestones: [
        aMilestone({ summary: 'npm ci', exitCode: 0 }),
        aMilestone({
          id: 'dddddddd-e89b-42d3-a456-426614174000',
          attemptId: 'cccccccc-e89b-42d3-a456-426614174000',
          seq: 0,
          summary: 'npm test',
          exitCode: 1,
        }),
      ],
    })

    renderAt(`/jobs/${job.id}`)

    // The running turn is open; the one that is over stays closed until asked.
    // Two turns only because the job went back through the queue: ordinarily
    // there is one, and it is called "Codex turn" with no count at all.
    const running = await screen.findByText(/Turn 2 of 2/)
    expect(await screen.findByText('npm test')).toBeVisible()

    const finished = screen.getByText(/Turn 1 of 2/)
    expect(finished).toHaveTextContent('failed')
    expect(running).toBeInTheDocument()
  })

  it('calls the one turn a job ordinarily takes by name rather than by count', async () => {
    const job = anImplementingJob()
    stubApi({ jobs: [job], attempts: [anAttempt()] })

    renderAt(`/jobs/${job.id}`)

    expect(await screen.findByText(/Codex turn/)).toBeVisible()
    expect(screen.queryByText(/of 1/)).toBeNull()
  })

  /**
   * The logs are their own tab now, and opening the tab is not the same ask as
   * opening a log: the default tail is a quarter of a megabyte per turn.
   */
  it('reads the raw log only when the Handler opens it', async () => {
    const job = anImplementingJob()
    const fetchMock = stubApi({ jobs: [job], attempts: [anAttempt()] })

    renderAt(`/jobs/${job.id}?tab=logs`)
    await screen.findByText(/Codex turn/)

    const logRequests = () =>
      fetchMock.mock.calls.filter(([url]) => String(url).includes('/log'))
    expect(logRequests()).toHaveLength(0)

    await userEvent.click(screen.getByRole('button', { name: 'Show log' }))

    await waitFor(() => expect(logRequests().length).toBeGreaterThan(0))
  })

  it('states what Handella overrides in the Handler’s Codex config', async () => {
    const job = anImplementingJob()
    stubApi({ jobs: [job] })

    renderAt(`/jobs/${job.id}`)

    expect(
      await screen.findByText(
        'approvals off · network on · otherwise your Codex config',
      ),
    ).toBeVisible()
  })

  it('refetches only the milestones a progress event names', async () => {
    const job = anImplementingJob()
    const fetchMock = stubApi({ jobs: [job], attempts: [anAttempt()] })

    renderAt(`/jobs/${job.id}`)
    await screen.findByText(/Codex turn/)
    const before = fetchMock.mock.calls.length

    latestEventSource().emit('job.progress', { jobId: job.id })

    await waitFor(() => {
      const after = fetchMock.mock.calls
        .slice(before)
        .map(([url]) => String(url))
      expect(after.some((url) => url.endsWith('/milestones'))).toBe(true)
      // The job list is not one of them: a progress event names one job, and
      // refetching every job for it is what the coalescing is meant to avoid.
      expect(after).not.toContain('/api/jobs')
    })
  })
})

describe('a running job in the inbox', () => {
  it('shows the line the agent just wrote', async () => {
    const job = anImplementingJob()
    stubApi({
      jobs: [job],
      attempts: [anAttempt()],
      milestones: [
        aMilestone({ summary: 'npm ci', exitCode: 0 }),
        aMilestone({
          id: 'eeeeeeee-e89b-42d3-a456-426614174000',
          seq: 1,
          summary: 'npm test',
          exitCode: 1,
        }),
      ],
    })

    renderAt('/')

    const running = await screen.findByText(job.title)
    // The row is no longer an anchor: it carries an "Open session" button, and
    // a button may not sit inside a link — so the link is an overlay over the
    // row rather than the row itself.
    const row = running.closest('li')
    expect(row).not.toBeNull()
    // The overlay still opens the job, which the anchor used to be for.
    expect(row?.querySelector(`a[href="/jobs/${job.id}"]`)).not.toBeNull()
    // Read as text rather than by element: the line is assembled from several
    // spans, and what the Handler sees is the sentence they make together.
    await waitFor(() => {
      expect(row?.textContent).toContain('Codex turn')
      expect(row?.textContent).toContain('npm test · exit 1')
    })
  })
})
