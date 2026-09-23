import type { AttentionItem } from '@handella/contracts'
import { screen, waitFor, within } from '@testing-library/react'
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

/**
 * Home's rail is a list of key/value facts, so a value is read as the `dd`
 * after its `dt` rather than on its own: "0" appears three times on a quiet
 * screen and means something different each time.
 */
const railValue = (label: string): string =>
  within(screen.getByLabelText('Right now')).getByText(label, {
    selector: 'dt',
  }).nextElementSibling?.textContent ?? ''

/** Resuming is the removal of a Suspension, so it is a DELETE and not a POST. */
const resumesIn = (fetchMock: ReturnType<typeof stubApi>): string[] =>
  fetchMock.mock.calls
    .filter(
      ([url, init]) =>
        String(url).endsWith('/suspension') &&
        (init as RequestInit | undefined)?.method === 'DELETE',
    )
    .map(([url]) => String(url))

/**
 * Everything that is not a row's one action lives behind its `···`. Opening it
 * is a deliberate click, which is the whole point of the menu — so a test that
 * asserts on a move opens the menu the Handler would have to open.
 */
const openMenu = async (name: string) => {
  await userEvent.click(await screen.findByRole('button', { name }))
  return screen.getByRole('menu')
}

const openJobMenu = () => openMenu('More actions for this job')

describe('the attention inbox', () => {
  it('shows what needs the Handler and what is in flight', async () => {
    stubApi({
      attention: [anAttentionItem()],
      jobs: [aJob({ state: 'implementing' })],
    })

    renderAt('/')

    expect(
      await screen.findByText('Job stopped and needs a decision'),
    ).toBeInTheDocument()
    // A running job is in flight, so it is in the left column under its own
    // sub-heading rather than in a rail panel of its own.
    expect(await screen.findByText('In flight')).toBeInTheDocument()
    expect(screen.getByText('Fix the flaky login test')).toBeInTheDocument()
  })

  /**
   * The rail counts what the jobs list can answer — running, queued, suspended
   * — rather than what happened today. A Job carries no dispatch timestamp and
   * how many pull requests opened today is in the transition history, which is
   * one request per job.
   */
  it('counts what is running, queued and suspended', async () => {
    stubApi({
      attention: [],
      jobs: [
        aJob({ state: 'implementing' }),
        aJob({ id: 'queued-1', state: 'queued' }),
        aJob({ id: 'queued-2', state: 'queued' }),
        aJob({ id: 'stopped-1', suspension: 'interrupted' }),
      ],
    })

    renderAt('/')

    // Waited for rather than read once: the rail renders its labels before the
    // jobs land, so a bare assertion here would be reading three zeroes.
    await waitFor(() => expect(railValue('Running')).toBe('1'))
    expect(railValue('Queued')).toBe('2')
    expect(railValue('Suspended')).toBe('1')
  })

  it('leaves a job that is only taken out of the queue', async () => {
    // Only Dispatch puts a Job in the queue, so an `intake` job holds no
    // position and is not counted among those waiting for a slot.
    stubApi({ attention: [], jobs: [aJob({ state: 'intake' })] })

    renderAt('/')

    await screen.findByText('In flight')
    expect(railValue('Queued')).toBe('0')
  })

  it('does not seat a suspended job in the queue it cannot be started from', async () => {
    stubApi({
      attention: [],
      jobs: [aJob({ state: 'queued', suspension: 'stoppedByHandler' })],
    })

    renderAt('/')

    await waitFor(() => expect(railValue('Suspended')).toBe('1'))
    expect(railValue('Queued')).toBe('0')
  })

  it('says what a free slot means for the next dispatch', async () => {
    stubApi({ attention: [], jobs: [] })

    renderAt('/')

    // The consequence rather than the count, which the numbers beside it have
    // already given.
    expect(
      await screen.findByText(
        /3 slots free\. The next job you dispatch starts/,
      ),
    ).toBeInTheDocument()
  })

  it('says so plainly when nothing is waiting', async () => {
    stubApi({ attention: [], jobs: [] })

    renderAt('/')

    expect(
      await screen.findByText(/Nothing is waiting on you/),
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

  /**
   * One primary per card, and it performs the recovery rather than sending the
   * Handler to another screen to press the same button. Two mint-weight
   * buttons competing in every card is the complaint this fixes.
   */
  it('resumes a stopped job from the card itself', async () => {
    const fetchMock = stubApi({
      attention: [anAttentionItem()],
      jobs: [aJob({ suspension: 'interrupted' })],
    })

    renderAt('/')
    await userEvent.click(
      await screen.findByRole('button', { name: 'Resume job' }),
    )

    await waitFor(() =>
      expect(resumesIn(fetchMock)).toEqual([
        `/api/jobs/${aJob().id}/suspension`,
      ]),
    )
  })

  it('links a ready pull request straight at the pull request', async () => {
    stubApi({
      attention: [anAttentionItem({ kind: 'readyPr' })],
      jobs: [
        aJob({
          state: 'prOpen',
          originalPrUrl: 'https://github.com/acme/monorepo/pull/41',
        }),
      ],
    })

    renderAt('/')

    expect(
      await screen.findByRole('link', { name: 'Review pull request' }),
    ).toHaveAttribute('href', 'https://github.com/acme/monorepo/pull/41')
  })

  /**
   * CONTEXT.md has an Attention Item resolved rather than deleted, so this is
   * the word — and it is quiet on every card, because whatever raised it will
   * raise it again.
   */
  it('resolves an item without competing with the primary', async () => {
    const fetchMock = stubApi({ attention: [anAttentionItem()], jobs: [] })

    renderAt('/')
    await userEvent.click(
      await screen.findByRole('button', { name: 'Resolve' }),
    )

    await waitFor(() => expect(postsTo(fetchMock, '/resolve')).toHaveLength(1))
  })
})

describe('the attention inbox filters', () => {
  const approval = anAttentionItem({
    id: '423e4567-e89b-42d3-a456-426614174000',
    kind: 'planApproval',
    title: 'A plan is waiting for you',
  })

  /**
   * The filters are severities now rather than kinds: what a Handler triages in
   * one pass is everything that has stopped, or everything waiting on a
   * signature, and the pills carry the count so the choice is which number to
   * look at.
   */
  it('shows only the kinds behind the filter the Handler picked', async () => {
    stubApi({ attention: [anAttentionItem(), approval], jobs: [] })
    const user = userEvent.setup()

    renderAt('/')
    await screen.findByText('A plan is waiting for you')
    await user.click(screen.getByRole('button', { name: /^Reviews/ }))

    expect(screen.getByText('A plan is waiting for you')).toBeInTheDocument()
    expect(screen.queryByText('Job stopped and needs a decision')).toBeNull()
  })

  it('counts each severity on its own pill', async () => {
    stubApi({ attention: [anAttentionItem(), approval], jobs: [] })

    renderAt('/')

    await screen.findByText('A plan is waiting for you')
    expect(screen.getByRole('button', { name: 'All 2' })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Blockers 1' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Reviews 1' }),
    ).toBeInTheDocument()
  })

  it('keeps the count of everything waiting while a filter hides some of it', async () => {
    stubApi({ attention: [anAttentionItem(), approval], jobs: [] })
    const user = userEvent.setup()

    renderAt('/')
    await screen.findByText('A plan is waiting for you')
    await user.click(screen.getByRole('button', { name: /^Reviews/ }))

    // The count beside the title counts what needs the Handler, not what this
    // filter shows.
    const header = screen.getByRole('heading', { name: 'Needs you' })
    expect(header.closest('div')).toHaveTextContent('2')
  })

  it('remembers the filter, so a reload does not lose the Handler their place', async () => {
    stubApi({ attention: [anAttentionItem(), approval], jobs: [] })
    const user = userEvent.setup()

    const first = renderAt('/')
    await screen.findByText('A plan is waiting for you')
    await user.click(screen.getByRole('button', { name: /^Reviews/ }))
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
    // Standalone, so there is nowhere to go and no primary at all: the card is
    // a report, and the only control it needs is the quiet one.
    expect(screen.queryByRole('link', { name: 'Open job' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Open the job' })).toBeNull()
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
    await user.click(screen.getByRole('button', { name: /^Housekeeping/ }))

    expect(screen.getByText('Worktrees no job claims')).toBeInTheDocument()
    expect(
      screen.getByText('Another job plans to touch the same files'),
    ).toBeInTheDocument()
    // Neither is a Job that has stopped, so neither belongs with the blockers.
    expect(screen.queryByText('Job stopped and needs a decision')).toBeNull()
  })
})

describe('the job detail page', () => {
  /**
   * The state transitions moved into the `···`. What replaced the old card of
   * five identical "Move to…" buttons is a banner saying what is wrong and
   * offering the one thing that fixes it.
   */
  it('offers only the moves the state machine allows', async () => {
    stubApi({ jobs: [aJob({ state: 'intake' })] })

    renderAt(`/jobs/${aJob().id}`)
    const menu = await openJobMenu()

    // Cancelling is destructive, so it is named for what it does rather than
    // spelled as a move like the rest.
    expect(
      within(menu).getByRole('menuitem', { name: 'Cancel job' }),
    ).toBeInTheDocument()
    expect(
      within(menu).queryByRole('menuitem', { name: 'Move to Planning' }),
    ).toBeNull()
    expect(
      within(menu).queryByRole('menuitem', { name: 'Move to Merged' }),
    ).toBeNull()
  })

  it('offers Dispatch as the screen’s one primary, in place of a move to queued', async () => {
    stubApi({ jobs: [aJob({ state: 'intake' })] })

    renderAt(`/jobs/${aJob().id}`)

    expect(
      await screen.findByRole('button', { name: 'Dispatch' }),
    ).toBeInTheDocument()
    // The edge exists, but walking it by hand would claim no branch and cut no
    // worktree, so the derived moves leave it out.
    const menu = await openJobMenu()
    expect(
      within(menu).queryByRole('menuitem', { name: 'Move to Queued' }),
    ).toBeNull()
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
    const menu = await openJobMenu()

    expect(
      within(menu).getByRole('menuitem', { name: 'Move to Planning' }),
    ).toBeInTheDocument()
    expect(
      within(menu).queryByRole('menuitem', { name: 'Dispatch' }),
    ).toBeNull()
  })

  it('offers resume rather than suspend once a job is suspended', async () => {
    stubApi({ jobs: [aJob({ suspension: 'interrupted' })] })

    renderAt(`/jobs/${aJob().id}`)

    // The banner's primary, which is the recovery rather than a move.
    expect(
      await screen.findByRole('button', { name: 'Resume' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Stopped — interrupted by a restart'),
    ).toBeInTheDocument()
    // And the consequence, which is the thing a Handler actually wants to know.
    expect(
      screen.getByText(/worktree and branch are intact/),
    ).toBeInTheDocument()

    expect(screen.queryByRole('button', { name: 'Suspend' })).toBeNull()

    const menu = await openJobMenu()
    expect(within(menu).queryByRole('menuitem', { name: 'Suspend' })).toBeNull()
    expect(
      within(menu).getByRole('menuitem', { name: 'Resume' }),
    ).toBeInTheDocument()
  })

  it('shows no actions at all once a job is archived', async () => {
    stubApi({ jobs: [aJob({ state: 'archived' })] })

    renderAt(`/jobs/${aJob().id}`)

    expect(
      await screen.findByText(/This job has reached the end of its life/),
    ).toBeInTheDocument()
    // Including Suspend: a job that is over is not a job that is stopped, and
    // the service refuses to suspend one. With nothing left to offer there is
    // no menu to open either.
    expect(screen.queryByRole('button', { name: 'Suspend' })).toBeNull()
    expect(
      screen.queryByRole('button', { name: 'More actions for this job' }),
    ).toBeNull()
  })

  /**
   * The worktree path is elided in the header rather than printed in full: a
   * hundred and forty mono characters used to push everything else off the
   * line, and the copy affordance is what puts it back.
   */
  it('elides the worktree path and offers to copy it whole', async () => {
    stubApi({
      jobs: [
        aJob({
          state: 'planning',
          worktreePath:
            '/Users/handler/.data/worktrees/acme-monorepo/ell/eng-412-fix-the-flaky-login-test/job',
        }),
      ],
    })

    renderAt(`/jobs/${aJob().id}`)

    expect(
      await screen.findByRole('button', { name: 'Copy path' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByText(
        '/Users/handler/.data/worktrees/acme-monorepo/ell/eng-412-fix-the-flaky-login-test/job',
      ),
    ).toBeNull()
  })

  /** Cancelling names its consequence rather than asking whether you are sure. */
  it('confirms a cancel before making it, naming what is left alone', async () => {
    const fetchMock = stubApi({ jobs: [aJob({ state: 'queued' })] })

    renderAt(`/jobs/${aJob().id}`)
    await userEvent.click(
      await screen.findByRole('button', { name: 'Cancel job' }),
    )

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent(
      'The branch and the Linear issue are left alone',
    )
    expect(postsTo(fetchMock, '/transitions')).toHaveLength(0)

    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Cancel job' }),
    )

    await waitFor(() => {
      expect(postsTo(fetchMock, '/transitions')).toEqual([
        { expectedState: 'queued', to: 'cancelled' },
      ])
    })
  })

  it('keeps the job when the Handler backs out of the confirmation', async () => {
    const fetchMock = stubApi({ jobs: [aJob({ state: 'queued' })] })

    renderAt(`/jobs/${aJob().id}`)
    await userEvent.click(
      await screen.findByRole('button', { name: 'Cancel job' }),
    )
    await userEvent.click(
      await screen.findByRole('button', { name: 'Keep it' }),
    )

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(postsTo(fetchMock, '/transitions')).toHaveLength(0)
  })

  /** Timeline, Plan and Logs. No Changes tab: there is no diff endpoint. */
  it('switches between the views of one job', async () => {
    stubApi({ jobs: [aJob({ state: 'implementing' })] })

    renderAt(`/jobs/${aJob().id}`)

    await userEvent.click(await screen.findByRole('tab', { name: 'Plan' }))
    expect(await screen.findByText(/No plan captured yet/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('tab', { name: 'Logs' }))
    expect(
      await screen.findByText(/No implementation turn has run yet/),
    ).toBeInTheDocument()

    expect(screen.queryByRole('tab', { name: 'Changes' })).toBeNull()
  })
  it('offers no Suspend on a merged job, whose worktree is gone', async () => {
    stubApi({ jobs: [aJob({ state: 'merged', worktreePath: null })] })

    renderAt(`/jobs/${aJob().id}`)

    const menu = await openJobMenu()
    expect(within(menu).queryByRole('menuitem', { name: 'Suspend' })).toBeNull()
  })

  it('leaves approving a plan to the Plan tab rather than the menu', async () => {
    stubApi({ jobs: [aJob({ state: 'planReview' })] })

    renderAt(`/jobs/${aJob().id}`)

    // The service only lets a job into `approved` once a plan version is
    // approved, so the bare move would be refused every time.
    const menu = await openJobMenu()
    expect(
      within(menu).queryByRole('menuitem', { name: /Move to Approved/ }),
    ).toBeNull()
    expect(
      within(menu).getByRole('menuitem', { name: /Move to Queued/ }),
    ).toBeInTheDocument()
  })

  it('follows a pull request with no URL to the job, not to the plan', async () => {
    stubApi({ jobs: [aJob({ originalPrUrl: null, state: 'prOpen' })] })

    renderAt(`/jobs/${aJob().id}`)

    const review = await screen.findByRole('link', {
      name: 'Review pull request',
    })
    expect(review).toHaveAttribute('href', `/jobs/${aJob().id}`)
  })
})

describe('the jobs list', () => {
  it('groups rows by what they need from the Handler', async () => {
    stubApi({
      attention: [],
      jobs: [
        aJob({ suspension: 'interrupted' }),
        aJob({ id: 'running-1', state: 'implementing' }),
        aJob({ id: 'queued-1', state: 'queued' }),
      ],
    })

    renderAt('/jobs')

    expect(
      await screen.findByRole('heading', { name: 'NEEDS YOU · 1' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'RUNNING · 1' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'WAITING · 1' }),
    ).toBeInTheDocument()
  })

  /** The row that needs the Handler says why, beneath itself. */
  it('explains a needs-you row without explaining every other row', async () => {
    stubApi({
      attention: [],
      jobs: [
        aJob({ suspension: 'interrupted' }),
        aJob({ id: 'queued-1', state: 'queued' }),
      ],
    })

    renderAt('/jobs')

    expect(
      await screen.findByText(/A restart interrupted this job/),
    ).toBeInTheDocument()
    expect(screen.queryByText(/holds its issue but has claimed/)).toBeNull()
  })

  it('narrows the list to the lane the Handler picked', async () => {
    stubApi({
      attention: [],
      jobs: [
        aJob({ state: 'implementing' }),
        aJob({ id: 'merged-1', state: 'merged', title: 'Already landed' }),
      ],
    })
    const user = userEvent.setup()

    renderAt('/jobs')
    await screen.findByRole('button', { name: 'Active 1' })
    await user.click(screen.getByRole('button', { name: 'Done 1' }))

    expect(screen.getByText('Already landed')).toBeInTheDocument()
    expect(screen.queryByText('Fix the flaky login test')).toBeNull()
  })

  it('filters by anything the Handler might remember the job by', async () => {
    stubApi({
      attention: [],
      jobs: [
        aJob({ state: 'implementing' }),
        aJob({
          canonicalBranch: 'ell/eng-900-something-else',
          id: 'other-1',
          state: 'implementing',
          title: 'Something else',
        }),
      ],
    })

    renderAt('/jobs')
    await userEvent.type(await screen.findByLabelText('Filter jobs'), 'eng-900')

    expect(screen.getByText('Something else')).toBeInTheDocument()
    expect(screen.queryByText('Fix the flaky login test')).toBeNull()
  })

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
    const menu = await openMenu('More actions for Fix the flaky login test')

    expect(
      within(menu).queryByRole('menuitem', { name: 'Open terminal' }),
    ).toBeNull()
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

  it('clears a failure once a later action on the row works', async () => {
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
    await screen.findByText('Terminal could not be opened at /tmp/worktree')

    const menu = await openMenu('More actions for Fix the flaky login test')
    await userEvent.click(
      within(menu).getByRole('menuitem', { name: 'Suspend' }),
    )

    // Each mutation keeps its own error until it next runs, so the old
    // failure would otherwise sit on the row beside a suspend that worked.
    await waitFor(() => {
      expect(
        screen.queryByText('Terminal could not be opened at /tmp/worktree'),
      ).toBeNull()
    })
  })

  /**
   * Cancelling is on the row now, which it was not before — behind the `···`
   * and behind the confirmation, which is two deliberate clicks and a sentence
   * rather than the one mis-click the old row was away from a state a job never
   * comes back from.
   */
  it('cancels from the row only behind the menu and a confirmation', async () => {
    const fetchMock = stubApi({ attention: [], jobs: [aJob()] })

    renderAt('/jobs')
    await screen.findByText('Fix the flaky login test')
    const menu = await openMenu('More actions for Fix the flaky login test')
    await userEvent.click(
      within(menu).getByRole('menuitem', { name: 'Cancel job' }),
    )

    const dialog = await screen.findByRole('dialog')
    expect(postsTo(fetchMock, '/transitions')).toHaveLength(0)

    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Cancel job' }),
    )

    await waitFor(() => {
      expect(postsTo(fetchMock, '/transitions')).toEqual([
        { expectedState: 'intake', to: 'cancelled' },
      ])
    })
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
    // The banner's one secondary: it is the thing that actually advances the
    // job, so it wins the slot over a terminal.
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
    expect(await screen.findByText(/removed after merge/)).toBeInTheDocument()
  })

  it('still reads a lost cut as a lost cut', async () => {
    stubApi({ jobs: [aJob({ state: 'queued', worktreePath: null })] })

    renderAt(`/jobs/${aJob().id}`)

    expect(await screen.findByText(/not cut/)).toBeInTheDocument()
  })
})
