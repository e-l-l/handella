import type {
  IntakeIssue,
  Job,
  LinearIssueSummary,
  LinearTeamSummary,
  LinearWorkflowStateSummary,
  Repository,
} from '@handella/contracts'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { installFakeEventSource } from './test/fakeEventSource.ts'
import { aLinearJob as aJob, aStatus } from './test/fixtures.ts'
import { renderAt } from './test/renderApp.tsx'
import {
  jsonResponse as json,
  postsTo,
  stubApi as stubSharedApi,
} from './test/stubApi.ts'

const anIssue = (
  overrides: Partial<LinearIssueSummary> = {},
): LinearIssueSummary => ({
  id: 'issue-412',
  identifier: 'ENG-412',
  title: 'Fix the flaky login test',
  description: null,
  priority: 2,
  url: 'https://linear.app/acme/issue/ENG-412',
  branchName: 'ell/eng-412-fix-flaky-login-test',
  stateName: 'In Progress',
  stateType: 'started',
  updatedAt: '2026-09-18T10:00:00.000Z',
  ...overrides,
})

/**
 * The local service answers both halves, so a test says what it answered
 * rather than seeding jobs and hoping the page derives the same thing.
 */
const anOffer = (overrides: Partial<IntakeIssue> = {}): IntakeIssue => {
  const issue = overrides.issue ?? anIssue()
  return {
    issue,
    heldByJobId: null,
    plannedBranch: issue.branchName,
    round: 1,
    ...overrides,
  }
}

interface Routes {
  configured?: boolean
  /** Stands for the service being down, which is not the same as having no key. */
  statusUnreachable?: boolean
  /** What Dispatch answers with, when a test needs the second half to fail. */
  dispatchFailure?: { code: string; message: string }
  intakeFailures?: Record<string, { code: string; message: string }>
  issues?: LinearIssueSummary[]
  jobs?: Job[]
  /** Overrides `issues` when a test cares what Handella knows about them. */
  offers?: IntakeIssue[]
  /** The checkouts Intake can bind a job to; empty stands for none configured. */
  repositories?: Repository[]
  /** What the cursor from the first page answers with. */
  nextPage?: IntakeIssue[]
  /** What a search answers with, when a test needs the list to change. */
  searchResults?: IntakeIssue[]
  states?: LinearWorkflowStateSummary[]
  teams?: LinearTeamSummary[]
}

/**
 * The intake arms are handed to the shared stub as `extra`, so they are tried
 * before its `/api/jobs/` catch-all, which is prefix matched and would
 * otherwise swallow anything that merely starts the same way.
 */
const stubApi = (routes: Routes = {}) =>
  stubSharedApi({
    jobs: routes.jobs,
    repositories: routes.repositories,
    status: aStatus({
      integrations: {
        linear: { configured: routes.configured ?? true },
        codex: { configured: true },
        github: { configured: true },
      },
    }),
    extra: (url, init) => {
      // What the dev proxy answers when nothing is listening on the service
      // port: a 500 whose body is not the service's own error record.
      if (url === '/api/status' && routes.statusUnreachable === true) {
        return Promise.resolve(
          new Response('Error: connect ECONNREFUSED 127.0.0.1:4310', {
            status: 500,
          }),
        )
      }
      if (url.startsWith('/api/intake/linear/issues')) {
        if (url.includes('cursor=')) {
          return json({ issues: routes.nextPage ?? [], nextCursor: null })
        }
        if (url.includes('search=') && routes.searchResults !== undefined) {
          return json({ issues: routes.searchResults, nextCursor: null })
        }
        const offers =
          routes.offers ??
          (routes.issues ?? [anIssue()]).map((issue) => anOffer({ issue }))
        return json({
          issues: offers,
          nextCursor: routes.nextPage === undefined ? null : 'page-2',
        })
      }
      if (/^\/api\/intake\/linear\/teams\/[^/]+\/states$/.test(url)) {
        return json(
          routes.states ?? [{ id: 'state-1', name: 'Todo', type: 'unstarted' }],
        )
      }
      if (url === '/api/intake/linear/teams') {
        return json(
          routes.teams ?? [{ id: 'team-1', key: 'ENG', name: 'Engineering' }],
        )
      }
      if (url === '/api/intake/base-branches') {
        return json({ defaultBranch: 'dev', recent: ['main'] })
      }
      if (
        url.endsWith('/dispatch') &&
        init?.method === 'POST' &&
        routes.dispatchFailure !== undefined
      ) {
        return json(routes.dispatchFailure, 409)
      }
      if (url === '/api/intake/linear' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { issueId: string }
        const failure = routes.intakeFailures?.[body.issueId]
        if (failure !== undefined) return json(failure, 409)
        return json(aJob(), 201)
      }
      if (url === '/api/intake/adhoc' && init?.method === 'POST') {
        return json(aJob({ source: 'adhoc' }), 201)
      }
      return undefined
    },
  })

beforeEach(() => {
  installFakeEventSource()
})

describe('an installation with no Linear API key', () => {
  it('explains the setup rather than failing a request', async () => {
    stubApi({ configured: false })
    renderAt('/intake')

    expect(
      await screen.findByText('Linear is not configured'),
    ).toBeInTheDocument()
    expect(screen.getByText(/HANDELLA_LINEAR_API_KEY/)).toBeInTheDocument()
  })

  it('never asks for issues it knows it cannot have', async () => {
    const fetchMock = stubApi({ configured: false })
    renderAt('/intake')

    await screen.findByText('Linear is not configured')

    expect(
      fetchMock.mock.calls.filter(([url]) =>
        String(url).startsWith('/api/intake/linear/issues'),
      ),
    ).toHaveLength(0)
  })
})

describe('an installation whose local service is down', () => {
  it('says the service is unreachable rather than blaming the key', async () => {
    stubApi({ statusUnreachable: true })
    renderAt('/intake')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Service unavailable',
    )
    expect(screen.queryByText('Linear is not configured')).toBeNull()
    expect(screen.queryByText(/HANDELLA_LINEAR_API_KEY/)).toBeNull()
  })

  it('offers a retry that asks the service again', async () => {
    const fetchMock = stubApi({ statusUnreachable: true })
    renderAt('/intake')

    await screen.findByRole('alert')
    const asked = () =>
      fetchMock.mock.calls.filter(([url]) => String(url) === '/api/status')
        .length
    const before = asked()

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))

    await waitFor(() => expect(asked()).toBeGreaterThan(before))
  })
})

describe('the issue list', () => {
  it('shows each assigned actionable issue with its branch', async () => {
    stubApi()
    renderAt('/intake')

    expect(await screen.findByText('ENG-412')).toBeInTheDocument()
    expect(screen.getByText('Fix the flaky login test')).toBeInTheDocument()
    expect(
      screen.getByText(/ell\/eng-412-fix-flaky-login-test/),
    ).toBeInTheDocument()
  })

  it("names the issue's own state, not the category behind it", async () => {
    stubApi({ issues: [anIssue({ stateName: 'In Dev (QA)' })] })
    renderAt('/intake')

    // The category would read "In progress", which is the same six words for
    // six different states and tells the Handler nothing about where it sits.
    expect(await screen.findByText(/In Dev \(QA\)/)).toBeInTheDocument()
  })

  it('offers no state until the Handler has said which team', async () => {
    stubApi()
    renderAt('/intake')

    // A state belongs to one team's workflow, and two teams can name a state
    // the same thing, so there is nothing to offer before a team is chosen.
    expect(await screen.findByLabelText('Linear state')).toBeDisabled()
  })

  it("filters by one team's own state", async () => {
    const fetchMock = stubApi({
      states: [
        { id: 'state-1', name: 'Todo', type: 'unstarted' },
        { id: 'state-2', name: 'In Dev (QA)', type: 'started' },
      ],
    })
    renderAt('/intake')

    await screen.findByRole('option', { name: 'ENG · Engineering' })
    await userEvent.selectOptions(
      screen.getByLabelText('Linear team'),
      'team-1',
    )
    await screen.findByRole('option', { name: 'In Dev (QA)' })
    await userEvent.selectOptions(
      screen.getByLabelText('Linear state'),
      'state-2',
    )

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([url]) =>
          String(url).includes('teamId=team-1&stateId=state-2'),
        ),
      ).toBe(true)
    })
  })

  it('drops a state the Handler picked when they change team', async () => {
    const fetchMock = stubApi({
      states: [{ id: 'state-2', name: 'In Dev (QA)', type: 'started' }],
      teams: [
        { id: 'team-1', key: 'ENG', name: 'Engineering' },
        { id: 'team-2', key: 'RBX', name: 'Portfolio' },
      ],
    })
    renderAt('/intake')

    await screen.findByRole('option', { name: 'ENG · Engineering' })
    const team = screen.getByLabelText('Linear team')
    await userEvent.selectOptions(team, 'team-1')
    await screen.findByRole('option', { name: 'In Dev (QA)' })
    await userEvent.selectOptions(
      screen.getByLabelText('Linear state'),
      'state-2',
    )
    await userEvent.selectOptions(team, 'team-2')

    // The old team's state id would filter the new team's issues down to
    // nothing, so it cannot survive the change.
    await waitFor(() => {
      const last = String(
        fetchMock.mock.calls
          .map(([url]) => String(url))
          .filter((url) => url.startsWith('/api/intake/linear/issues'))
          .at(-1),
      )
      expect(last).toContain('teamId=team-2')
      expect(last).not.toContain('stateId')
    })
  })

  it('searches once the Handler stops typing', async () => {
    const fetchMock = stubApi()
    renderAt('/intake')

    await screen.findByLabelText('Search')
    await userEvent.type(screen.getByLabelText('Search'), 'login')

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([url]) =>
          String(url).includes('search=login'),
        ),
      ).toBe(true)
    })
  })

  it('cannot take an issue a live job already holds', async () => {
    stubApi({
      offers: [
        anOffer({ heldByJobId: '123e4567-e89b-42d3-a456-426614174000' }),
      ],
    })
    renderAt('/intake')

    expect(await screen.findByLabelText('Select ENG-412')).toBeDisabled()
    expect(
      screen.getByText('Already the Linear issue for an active job.'),
    ).toBeInTheDocument()
  })

  it('releases the issue once that job is settled', async () => {
    stubApi({ offers: [anOffer()] })
    renderAt('/intake')

    expect(await screen.findByLabelText('Select ENG-412')).toBeEnabled()
  })

  it('shows the branch a repeat job would get, before it is taken', async () => {
    stubApi({
      offers: [
        anOffer({
          plannedBranch: 'ell/eng-412-fix-flaky-login-test-2',
          round: 2,
        }),
      ],
    })
    renderAt('/intake')

    expect(
      await screen.findByText(/ell\/eng-412-fix-flaky-login-test-2/),
    ).toBeInTheDocument()
    // The round the service counted is what says this is a repeat, rather than
    // the browser comparing the name against Linear's own.
    expect(screen.getByText(/Worked before/)).toBeInTheDocument()
  })

  it('never derives the branch itself from the jobs it is holding', async () => {
    // The jobs list says this issue has been worked before; the service said
    // otherwise, and the service is the one that counted.
    stubApi({ jobs: [aJob({ state: 'merged' })], offers: [anOffer()] })
    renderAt('/intake')

    expect(
      await screen.findByText(/ell\/eng-412-fix-flaky-login-test/),
    ).toBeInTheDocument()
    expect(
      screen.queryByText(/ell\/eng-412-fix-flaky-login-test-2/),
    ).not.toBeInTheDocument()
  })

  it('asks for the next page with the cursor the service reported', async () => {
    const fetchMock = stubApi({
      nextPage: [
        anOffer({
          issue: anIssue({
            id: 'issue-500',
            identifier: 'ENG-500',
            title: 'Retire the legacy exporter',
            branchName: 'ell/eng-500-retire-the-legacy-exporter',
          }),
        }),
      ],
    })
    renderAt('/intake')

    await userEvent.click(
      await screen.findByRole('button', { name: 'Show more issues' }),
    )

    expect(
      await screen.findByText('Retire the legacy exporter'),
    ).toBeInTheDocument()
    // The first page is kept rather than replaced.
    expect(screen.getByText('Fix the flaky login test')).toBeInTheDocument()
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).includes('cursor=page-2'),
      ),
    ).toBe(true)
  })

  it('offers no more when the service reported no cursor', async () => {
    stubApi()
    renderAt('/intake')

    await screen.findByText('Fix the flaky login test')
    expect(
      screen.queryByRole('button', { name: 'Show more issues' }),
    ).not.toBeInTheDocument()
  })
})

describe('creating jobs from a selection', () => {
  const twoIssues = [
    anIssue(),
    anIssue({
      id: 'issue-500',
      identifier: 'ENG-500',
      title: 'Retire the legacy exporter',
      branchName: 'ell/eng-500-retire-the-legacy-exporter',
    }),
  ]

  it('classifies each issue independently, one request each', async () => {
    const fetchMock = stubApi({ issues: twoIssues })
    renderAt('/intake')

    await userEvent.click(await screen.findByLabelText('Select ENG-412'))
    await userEvent.click(screen.getByLabelText('Select ENG-500'))

    await userEvent.click(
      within(
        screen.getByRole('group', { name: 'Work class for ENG-500' }),
      ).getByRole('radio', { name: 'Feature' }),
    )
    await userEvent.clear(screen.getByLabelText('Base branch for ENG-500'))
    await userEvent.type(
      screen.getByLabelText('Base branch for ENG-500'),
      'main',
    )

    await userEvent.click(
      screen.getByRole('button', { name: 'Create and dispatch 2 jobs' }),
    )

    await waitFor(() => {
      expect(postsTo(fetchMock, '/api/intake/linear')).toEqual([
        {
          issueId: 'issue-412',
          workClass: 'routine',
          repositoryId: '9f1d2c3b-4a5e-4b6c-8d7e-0f1a2b3c4d5e',
          baseBranch: 'dev',
        },
        {
          issueId: 'issue-500',
          workClass: 'feature',
          repositoryId: '9f1d2c3b-4a5e-4b6c-8d7e-0f1a2b3c4d5e',
          baseBranch: 'main',
        },
      ])
    })
  })

  it('dispatches each job it creates, so the work lands in the queue', async () => {
    const fetchMock = stubApi()
    renderAt('/intake')

    await userEvent.click(await screen.findByLabelText('Select ENG-412'))
    await userEvent.click(
      screen.getByRole('button', { name: 'Create and dispatch job' }),
    )

    expect(
      await screen.findByText('Job created and queued.'),
    ).toBeInTheDocument()
    expect(postsTo(fetchMock, `/api/jobs/${aJob().id}/dispatch`)).toHaveLength(
      1,
    )
  })

  it('leaves the job in intake when the Handler asks for that instead', async () => {
    const fetchMock = stubApi()
    renderAt('/intake')

    await userEvent.click(await screen.findByLabelText('Select ENG-412'))
    await userEvent.click(
      screen.getByRole('button', { name: 'Create only, without dispatching' }),
    )

    expect(
      await screen.findByText('Job created, waiting in intake.'),
    ).toBeInTheDocument()
    expect(postsTo(fetchMock, '/dispatch')).toHaveLength(0)
  })

  it('keeps a job whose dispatch was refused, rather than reporting it as untaken', async () => {
    stubApi({
      dispatchFailure: {
        code: 'canonical_branch_claimed',
        message: 'ell/eng-412-fix-flaky-login-test is already claimed',
      },
    })
    renderAt('/intake')

    await userEvent.click(await screen.findByLabelText('Select ENG-412'))
    await userEvent.click(
      screen.getByRole('button', { name: 'Create and dispatch job' }),
    )

    expect(
      await screen.findByText(
        /ell\/eng-412-fix-flaky-login-test is already claimed/,
      ),
    ).toBeInTheDocument()
    // The Job holds the issue now, whatever happened to its Dispatch, so the
    // Selection lets go of it rather than offering to take it again.
    expect(
      screen.queryByRole('group', { name: 'Work class for ENG-412' }),
    ).toBeNull()
  })

  it('never sends a canonical branch, because Linear owns it', async () => {
    const fetchMock = stubApi()
    renderAt('/intake')

    await userEvent.click(await screen.findByLabelText('Select ENG-412'))
    await userEvent.click(
      screen.getByRole('button', { name: 'Create and dispatch job' }),
    )

    await waitFor(() => {
      const [posted] = postsTo(fetchMock, '/api/intake/linear')
      expect(posted).toBeDefined()
      expect(posted).not.toHaveProperty('canonicalBranch')
    })
  })

  it('refuses the batch while Linear has not named a branch for a selection', async () => {
    // Selections survive a change of filters, so an issue can still be
    // selected once the list it came from no longer holds it. Linear owns the
    // canonical branch name and a job cannot be dispatched without one, so the
    // panel says why rather than posting a job it could not carry.
    stubApi({
      searchResults: [
        anOffer({
          issue: anIssue({
            id: 'issue-500',
            identifier: 'ENG-500',
            title: 'Retire the legacy exporter',
            branchName: 'ell/eng-500-retire-the-legacy-exporter',
          }),
        }),
      ],
    })
    renderAt('/intake')

    await userEvent.click(await screen.findByLabelText('Select ENG-412'))
    await userEvent.type(screen.getByLabelText('Search'), 'exporter')
    await screen.findByText('Retire the legacy exporter')

    expect(
      await screen.findByText(/Linear has not named a branch for this issue/),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Create and dispatch job' }),
    ).toBeDisabled()
  })

  it('keeps the good ones when one issue is already taken', async () => {
    stubApi({
      issues: twoIssues,
      intakeFailures: {
        'issue-500': {
          code: 'linear_issue_already_linked',
          message: 'ENG-500 is already the Linear issue for job abc',
        },
      },
    })
    renderAt('/intake')

    await userEvent.click(await screen.findByLabelText('Select ENG-412'))
    await userEvent.click(screen.getByLabelText('Select ENG-500'))
    await userEvent.click(
      screen.getByRole('button', { name: 'Create and dispatch 2 jobs' }),
    )

    expect(
      await screen.findByText('Job created and queued.'),
    ).toBeInTheDocument()
    expect(
      await screen.findByText(
        'ENG-500 is already the Linear issue for job abc',
      ),
    ).toBeInTheDocument()
  })
})

describe('ad hoc intake', () => {
  it('creates the Linear issue and the job in one submission', async () => {
    const fetchMock = stubApi()
    renderAt('/intake')

    const form = await screen.findByRole('form', {
      name: 'Create an ad hoc issue',
    })
    await userEvent.type(
      within(form).getByLabelText('Title'),
      'Retire the legacy exporter',
    )
    await userEvent.click(
      within(within(form).getByRole('group', { name: 'Work class' })).getByRole(
        'radio',
        { name: 'Feature' },
      ),
    )
    await userEvent.click(
      within(form).getByRole('button', { name: 'Create and dispatch' }),
    )

    await waitFor(() => {
      expect(postsTo(fetchMock, '/api/intake/adhoc')).toEqual([
        {
          teamId: 'team-1',
          title: 'Retire the legacy exporter',
          workClass: 'feature',
          repositoryId: '9f1d2c3b-4a5e-4b6c-8d7e-0f1a2b3c4d5e',
          baseBranch: 'dev',
          priority: 0,
        },
      ])
    })
  })
})

describe('an installation with no repository', () => {
  it('points at the one screen that can fix it', async () => {
    stubApi({ repositories: [] })
    renderAt('/intake')

    // Both the panel and the ad hoc form say it, and both point at the same
    // screen, so neither is a dead end.
    const links = await screen.findAllByRole('link', {
      name: 'Add one in System',
    })

    expect(links).toHaveLength(2)
    for (const link of links) expect(link).toHaveAttribute('href', '/system')
    // Nothing to choose between, so the choice is not offered.
    expect(screen.queryByLabelText('Repository')).not.toBeInTheDocument()
  })

  it('refuses ad hoc work before Linear is asked for an issue', async () => {
    const fetchMock = stubApi({ repositories: [] })
    renderAt('/intake')

    const form = await screen.findByRole('form', {
      name: 'Create an ad hoc issue',
    })
    await userEvent.type(
      within(form).getByLabelText('Title'),
      'Retire the legacy exporter',
    )
    const submit = within(form).getByRole('button', {
      name: 'Create and dispatch',
    })

    expect(submit).toBeDisabled()

    await userEvent.click(submit)

    expect(postsTo(fetchMock, '/api/intake/adhoc')).toEqual([])
  })
})

describe('the jobs page', () => {
  it('sends the Handler to intake rather than a form that cannot dispatch', async () => {
    stubApi()
    renderAt('/jobs')

    const link = await screen.findByRole('link', { name: 'New job' })
    expect(link).toHaveAttribute('href', '/intake')
  })
})

/**
 * Intake is the one screen whose state is held above the router. Everything
 * here is about what survives leaving it, and what that saves the local
 * service: every issue list it rebuilds is a round trip to Linear per issue.
 */
describe('coming back to intake', () => {
  const issueRequests = (fetchMock: ReturnType<typeof stubApi>) =>
    fetchMock.mock.calls
      .map(([url]) => String(url))
      .filter((url) => url.startsWith('/api/intake/linear/issues'))

  const leaveAndReturn = async () => {
    await userEvent.click(screen.getByRole('link', { name: 'Jobs' }))
    await userEvent.click(await screen.findByRole('link', { name: 'Intake' }))
  }

  it('keeps the filters, and asks for no list it already has', async () => {
    const fetchMock = stubApi({
      states: [{ id: 'state-2', name: 'In Dev (QA)', type: 'started' }],
    })
    renderAt('/intake')

    await screen.findByRole('option', { name: 'ENG · Engineering' })
    await userEvent.selectOptions(
      screen.getByLabelText('Linear team'),
      'team-1',
    )
    await screen.findByRole('option', { name: 'In Dev (QA)' })
    await userEvent.selectOptions(
      screen.getByLabelText('Linear state'),
      'state-2',
    )
    await waitFor(() => {
      expect(issueRequests(fetchMock).at(-1)).toContain('stateId=state-2')
    })
    const asked = issueRequests(fetchMock).length

    await leaveAndReturn()

    expect(await screen.findByLabelText('Linear team')).toHaveValue('team-1')
    expect(screen.getByLabelText('Linear state')).toHaveValue('state-2')
    // The filters are what the key is made of, so keeping them is what keeps
    // the list: a reset would have asked Linear for the unfiltered one.
    expect(issueRequests(fetchMock)).toHaveLength(asked)
  })

  it('keeps the Selection, with the choices made for each issue', async () => {
    stubApi({
      issues: [
        anIssue(),
        anIssue({
          id: 'issue-500',
          identifier: 'ENG-500',
          title: 'Retire the legacy exporter',
          branchName: 'ell/eng-500-retire-the-legacy-exporter',
        }),
      ],
    })
    renderAt('/intake')

    await userEvent.click(await screen.findByLabelText('Select ENG-412'))
    await userEvent.click(screen.getByLabelText('Select ENG-500'))
    await userEvent.click(
      within(
        screen.getByRole('group', { name: 'Work class for ENG-500' }),
      ).getByRole('radio', { name: 'Feature' }),
    )
    await userEvent.clear(screen.getByLabelText('Base branch for ENG-500'))
    await userEvent.type(
      screen.getByLabelText('Base branch for ENG-500'),
      'main',
    )

    await leaveAndReturn()

    expect(
      await screen.findByRole('button', { name: 'Create and dispatch 2 jobs' }),
    ).toBeEnabled()
    expect(screen.getByLabelText('Base branch for ENG-500')).toHaveValue('main')
    expect(
      within(
        screen.getByRole('group', { name: 'Work class for ENG-500' }),
      ).getByRole('radio', { name: 'Feature' }),
    ).toBeChecked()
  })

  it('refreshes when the Handler asks, rather than on sight', async () => {
    // Read per request by the stub, so mutating it is the list changing
    // underneath a Handler who has already chosen from it.
    const offers = [anOffer()]
    const fetchMock = stubApi({ offers })
    renderAt('/intake')

    await userEvent.click(await screen.findByLabelText('Select ENG-412'))
    const asked = issueRequests(fetchMock).length

    offers[0] = anOffer({
      heldByJobId: '123e4567-e89b-42d3-a456-426614174000',
    })
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }))

    await screen.findByText(
      'A live job already holds this issue, and its canonical branch with it.',
    )
    expect(issueRequests(fetchMock)).toHaveLength(asked + 1)
    // Still selected, and refused: a Selection is not silently emptied by the
    // list moving under it.
    expect(
      screen.getByRole('button', { name: 'Create and dispatch job' }),
    ).toBeDisabled()
  })

  it('lets a selection go once its issue has left the list', async () => {
    const offers = [anOffer()]
    stubApi({ offers })
    renderAt('/intake')

    await userEvent.click(await screen.findByLabelText('Select ENG-412'))
    offers.length = 0
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }))

    // One blocked selection blocks the batch, and the row that would untick
    // this one is no longer on the screen, so the card has to carry the way
    // out or there is none short of a reload.
    await userEvent.click(
      await screen.findByRole('button', {
        name: 'Remove this issue from the Selection',
      }),
    )

    expect(
      screen.getByText(
        'Pick an issue to classify it and give it a base branch.',
      ),
    ).toBeInTheDocument()
  })
})
