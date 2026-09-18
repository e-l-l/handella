import type { Job } from '@handella/contracts'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { installFakeEventSource } from './test/fakeEventSource.ts'
import { aJob } from './test/fixtures.ts'
import { renderAt } from './test/renderApp.tsx'
import { stubApi } from './test/stubApi.ts'

const aQueuedJob = (index: number, overrides: Partial<Job> = {}): Job =>
  aJob({
    id: `0000000${index}-0000-4000-8000-00000000000${index}`,
    title: `Job ${index}`,
    state: 'queued',
    canonicalBranch: `ell/eng-${index}-something`,
    worktreePath: `/tmp/worktrees/ell/eng-${index}-something`,
    queuePriority: index,
    ...overrides,
  })

const postedOrder = (fetchMock: ReturnType<typeof stubApi>) =>
  fetchMock.mock.calls
    .filter(([url]) => String(url) === '/api/queue/order')
    .map(([, init]) =>
      JSON.parse(String((init as RequestInit | undefined)?.body ?? '{}')),
    )

beforeEach(() => {
  installFakeEventSource()
  localStorage.clear()
})

describe('the queue panel', () => {
  it('lists the queued jobs in the order the scheduler will read them', async () => {
    stubApi({ jobs: [aQueuedJob(2), aQueuedJob(1)] })

    renderAt('/jobs')

    const items = await screen.findAllByRole('listitem')
    const queued = items.filter((item) => item.textContent?.includes('Job '))
    expect(queued[0]).toHaveTextContent('Job 1')
    expect(queued[1]).toHaveTextContent('Job 2')
  })

  it('says how many slots are in use', async () => {
    stubApi({
      jobs: [aQueuedJob(1), aJob({ id: 'running-1', state: 'planning' })],
    })

    renderAt('/jobs')

    expect(await screen.findByText(/1\/3 slots in use/)).toBeInTheDocument()
  })

  it('sends the whole order when one job is moved', async () => {
    const fetchMock = stubApi({
      jobs: [aQueuedJob(1), aQueuedJob(2), aQueuedJob(3)],
    })

    renderAt('/jobs')
    await userEvent.click(
      await screen.findByRole('button', {
        name: 'Move Job 3 up the queue',
      }),
    )

    await waitFor(() => {
      // The whole list, not one job's position: two writes renumbering the same
      // rows is what sending a single priority would be.
      expect(postedOrder(fetchMock)).toEqual([
        {
          jobIds: [aQueuedJob(1).id, aQueuedJob(3).id, aQueuedJob(2).id],
        },
      ])
    })
  })

  it('cannot move the first job up or the last one down', async () => {
    stubApi({ jobs: [aQueuedJob(1), aQueuedJob(2)] })

    renderAt('/jobs')

    expect(
      await screen.findByRole('button', { name: 'Move Job 1 up the queue' }),
    ).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'Move Job 2 down the queue' }),
    ).toBeDisabled()
  })

  it('shows nothing at all when the queue is empty', async () => {
    stubApi({ jobs: [aJob({ state: 'intake' })] })

    renderAt('/jobs')

    await screen.findByRole('link', { name: 'New job' })
    expect(screen.queryByRole('heading', { name: 'Queue' })).toBeNull()
  })

  it('leaves out a suspended job, which the scheduler would skip', async () => {
    stubApi({
      jobs: [aQueuedJob(1), aQueuedJob(2, { suspension: 'stoppedByHandler' })],
    })

    renderAt('/jobs')

    await screen.findByRole('heading', { name: 'Queue' })
    expect(
      screen.queryByRole('button', { name: 'Move Job 2 up the queue' }),
    ).toBeNull()
  })
})
