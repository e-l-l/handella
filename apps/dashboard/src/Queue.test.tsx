import type { Job } from '@handella/contracts'
import { screen, waitFor, within } from '@testing-library/react'
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

/**
 * Reordering lives in the row's own `···` now rather than in a separate panel
 * of Up and Down buttons above the list. The queue is a group of rows in the
 * one list, so there is one place a job is shown and one place it is acted on.
 */
const openMenuFor = async (title: string) => {
  await userEvent.click(
    await screen.findByRole('button', { name: `More actions for ${title}` }),
  )
  return screen.getByRole('menu')
}

beforeEach(() => {
  installFakeEventSource()
  localStorage.clear()
})

describe('the queue on the jobs list', () => {
  it('lists the queued jobs in the order the scheduler will read them', async () => {
    stubApi({ jobs: [aQueuedJob(2), aQueuedJob(1)] })

    renderAt('/jobs')

    const items = await screen.findAllByRole('listitem')
    const queued = items.filter((item) => item.textContent?.includes('Job '))
    expect(queued[0]).toHaveTextContent('Job 1')
    expect(queued[1]).toHaveTextContent('Job 2')
    // The position is on the row, so it says where in the queue it actually is
    // rather than only that it is in one. Matched as the whole text of an
    // element, since "Job 1" would satisfy a substring match on its own.
    expect(within(queued[0]!).getByText('1')).toBeInTheDocument()
    expect(within(queued[1]!).getByText('2')).toBeInTheDocument()
  })

  it('groups them under a rule counting what is waiting', async () => {
    stubApi({ jobs: [aQueuedJob(1), aQueuedJob(2)] })

    renderAt('/jobs')

    expect(
      await screen.findByRole('heading', { name: 'WAITING · 2' }),
    ).toBeInTheDocument()
  })

  it('draws no waiting group when nothing is waiting', async () => {
    stubApi({ jobs: [aJob({ state: 'implementing', title: 'Busy' })] })

    renderAt('/jobs')

    await screen.findByText('Busy')
    expect(screen.queryByRole('heading', { name: /^WAITING/ })).toBeNull()
  })

  /**
   * The capacity readout is on the nav now rather than on this screen: it is
   * the same fact from every screen, and a bare `0/3 running` pill in the
   * middle of a list looked pressable.
   */
  it('says how many slots are in use, from the nav', async () => {
    stubApi({
      jobs: [aQueuedJob(1), aJob({ id: 'running-1', state: 'planning' })],
    })

    renderAt('/jobs')

    expect(await screen.findByText('1 of 3 slots busy')).toBeInTheDocument()
  })

  it('sends the whole order when one job is moved', async () => {
    const fetchMock = stubApi({
      jobs: [aQueuedJob(1), aQueuedJob(2), aQueuedJob(3)],
    })

    renderAt('/jobs')
    const menu = await openMenuFor('Job 3')
    await userEvent.click(
      within(menu).getByRole('menuitem', { name: 'Move up the queue' }),
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

  it('moves a job to the front in one step', async () => {
    const fetchMock = stubApi({
      jobs: [aQueuedJob(1), aQueuedJob(2), aQueuedJob(3)],
    })

    renderAt('/jobs')
    const menu = await openMenuFor('Job 3')
    await userEvent.click(
      within(menu).getByRole('menuitem', { name: 'Move to the front' }),
    )

    await waitFor(() => {
      expect(postedOrder(fetchMock)).toEqual([
        {
          jobIds: [aQueuedJob(3).id, aQueuedJob(1).id, aQueuedJob(2).id],
        },
      ])
    })
  })

  it('cannot move the first job up or the last one down', async () => {
    stubApi({ jobs: [aQueuedJob(1), aQueuedJob(2)] })

    renderAt('/jobs')

    const first = await openMenuFor('Job 1')
    expect(
      within(first).getByRole('menuitem', { name: 'Move up the queue' }),
    ).toBeDisabled()

    await userEvent.keyboard('{Escape}')

    const second = await openMenuFor('Job 2')
    expect(
      within(second).getByRole('menuitem', { name: 'Move down the queue' }),
    ).toBeDisabled()
  })

  it('offers no reorder at all for a job that holds no position', async () => {
    stubApi({ jobs: [aJob({ state: 'intake', title: 'Not dispatched' })] })

    renderAt('/jobs')

    const menu = await openMenuFor('Not dispatched')
    expect(
      within(menu).queryByRole('menuitem', { name: 'Move up the queue' }),
    ).toBeNull()
  })

  it('leaves out a suspended job, which the scheduler would skip', async () => {
    const fetchMock = stubApi({
      jobs: [
        aQueuedJob(1),
        aQueuedJob(2),
        aQueuedJob(3, { suspension: 'stoppedByHandler' }),
      ],
    })

    renderAt('/jobs')
    // It is under NEEDS YOU rather than in the queue, so its own menu offers
    // the resume and no position to move.
    const suspended = await openMenuFor('Job 3')
    expect(
      within(suspended).queryByRole('menuitem', { name: 'Move up the queue' }),
    ).toBeNull()

    await userEvent.keyboard('{Escape}')

    // And the order the other two send never mentions it.
    const menu = await openMenuFor('Job 2')
    await userEvent.click(
      within(menu).getByRole('menuitem', { name: 'Move up the queue' }),
    )
    await waitFor(() => {
      expect(postedOrder(fetchMock)).toEqual([
        { jobIds: [aQueuedJob(2).id, aQueuedJob(1).id] },
      ])
    })
  })
})
