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
          attempt: 2,
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
    const running = await screen.findByText(/Attempt 2 of 3/)
    expect(await screen.findByText('npm test')).toBeVisible()

    const finished = screen.getByText(/Attempt 1 of 3/)
    expect(finished).toHaveTextContent('failed')
    expect(running).toBeInTheDocument()
  })

  it('names the round once a Handler resume has started another', async () => {
    const job = anImplementingJob()
    stubApi({
      jobs: [job],
      attempts: [anAttempt({ round: 2, attempt: 1 })],
    })

    renderAt(`/jobs/${job.id}`)

    expect(await screen.findByText(/round 2/)).toBeVisible()
  })

  it('reads the raw log only when the Handler opens it', async () => {
    const job = anImplementingJob()
    const fetchMock = stubApi({ jobs: [job], attempts: [anAttempt()] })

    renderAt(`/jobs/${job.id}`)
    await screen.findByText(/Attempt 1 of 3/)

    const logRequests = () =>
      fetchMock.mock.calls.filter(([url]) => String(url).includes('/log'))
    expect(logRequests()).toHaveLength(0)

    await userEvent.click(screen.getByRole('button', { name: 'Raw log' }))

    await waitFor(() => expect(logRequests().length).toBeGreaterThan(0))
  })

  it('shows the sandbox the job is actually under', async () => {
    const job = anImplementingJob()
    stubApi({ jobs: [job] })

    renderAt(`/jobs/${job.id}`)

    expect(await screen.findByText('workspace-write · network')).toBeVisible()
  })

  it('refetches only the milestones a progress event names', async () => {
    const job = anImplementingJob()
    const fetchMock = stubApi({ jobs: [job], attempts: [anAttempt()] })

    renderAt(`/jobs/${job.id}`)
    await screen.findByText(/Attempt 1 of 3/)
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
    const slot = running.closest('a')
    expect(slot).not.toBeNull()
    // Read as text rather than by element: the line is assembled from several
    // spans, and what the Handler sees is the sentence they make together.
    await waitFor(() => {
      expect(slot?.textContent).toContain('attempt 1 of 3')
      expect(slot?.textContent).toContain('npm test · exit 1')
    })
  })
})
