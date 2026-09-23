import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { installFakeEventSource } from './test/fakeEventSource.ts'
import { aJob, aPlanVersion } from './test/fixtures.ts'
import { renderAt } from './test/renderApp.tsx'
import { jsonResponse, stubApi } from './test/stubApi.ts'

beforeEach(() => {
  installFakeEventSource()
  localStorage.clear()
})

const aJobInPlanReview = () => aJob({ state: 'planReview' })

/**
 * The plan is a tab on the job page now rather than a card always on it, so
 * these land straight on it. A Handler reaching it by hand presses the state
 * banner's "Review the plan", which navigates to this same URL.
 */
const planTabOf = (jobId: string) => `/jobs/${jobId}?tab=plan`

describe('reviewing a plan', () => {
  it('shows the plan itself rather than only its revision number', async () => {
    const job = aJobInPlanReview()
    stubApi({ jobs: [job], planVersions: [aPlanVersion()] })

    renderAt(planTabOf(job.id))

    expect(
      await screen.findByText(
        'Make the login test wait for the session cookie.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Await the session cookie before asserting'),
    ).toBeInTheDocument()
    expect(screen.getByText('test/login.test.ts')).toBeInTheDocument()
    expect(screen.getByText('npm test -- login')).toBeInTheDocument()
  })

  it('approves through the revision it is showing', async () => {
    const job = aJobInPlanReview()
    const version = aPlanVersion()
    let approved: string | undefined
    stubApi({
      jobs: [job],
      planVersions: [version],
      extra: (url, init) => {
        if (url.endsWith('/approve') && init?.method === 'POST') {
          approved = url
          return jsonResponse({ ...job, state: 'approved' })
        }
        return undefined
      },
    })

    renderAt(planTabOf(job.id))
    await userEvent.click(
      await screen.findByRole('button', { name: 'Approve plan' }),
    )

    await waitFor(() =>
      expect(approved).toBe(
        `/api/jobs/${job.id}/plan-versions/${version.id}/approve`,
      ),
    )
  })

  it('will not send an empty change request', async () => {
    const job = aJobInPlanReview()
    stubApi({ jobs: [job], planVersions: [aPlanVersion()] })

    renderAt(planTabOf(job.id))

    expect(
      await screen.findByRole('button', { name: 'Request changes' }),
    ).toBeDisabled()
  })

  it('sends the feedback the Handler typed', async () => {
    const job = aJobInPlanReview()
    const version = aPlanVersion()
    let body: string | undefined
    stubApi({
      jobs: [job],
      planVersions: [version],
      extra: (url, init) => {
        if (url.endsWith('/request-changes') && init?.method === 'POST') {
          body = String(init.body)
          return jsonResponse({ ...job, state: 'queued' })
        }
        return undefined
      },
    })

    renderAt(planTabOf(job.id))
    await userEvent.type(
      await screen.findByLabelText('Ask for changes'),
      'Cover the signup test too',
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Request changes' }),
    )

    await waitFor(() =>
      expect(body).toBe(
        JSON.stringify({ feedback: 'Cover the signup test too' }),
      ),
    )
  })

  it('offers no answer once the job has moved past review', async () => {
    const job = aJob({ state: 'approved' })
    stubApi({
      jobs: [job],
      planVersions: [aPlanVersion({ approvalState: 'approved' })],
    })

    renderAt(planTabOf(job.id))

    expect(
      await screen.findByText(
        'Make the login test wait for the session cookie.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Approve plan' }),
    ).not.toBeInTheDocument()
  })

  it('keeps earlier revisions with the feedback that closed them', async () => {
    const job = aJobInPlanReview()
    stubApi({
      jobs: [job],
      planVersions: [
        aPlanVersion({
          id: '11111111-2222-4333-8444-555555555555',
          approvalState: 'changesRequested',
          feedback: 'Cover the signup test too',
        }),
        aPlanVersion({ revision: 2 }),
      ],
    })

    renderAt(planTabOf(job.id))

    expect(await screen.findByText('1 earlier revision')).toBeInTheDocument()
    expect(
      screen.getByText('Asked for: Cover the signup test too'),
    ).toBeInTheDocument()
  })
})
