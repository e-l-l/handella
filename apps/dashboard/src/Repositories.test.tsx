import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { installFakeEventSource } from './test/fakeEventSource.ts'
import { aRepository } from './test/fixtures.ts'
import { renderAt } from './test/renderApp.tsx'
import { stubApi } from './test/stubApi.ts'

beforeEach(() => {
  installFakeEventSource()
  localStorage.clear()
})

describe('repository settings', () => {
  it('lists the checkouts Handella can cut worktrees from', async () => {
    stubApi()

    renderAt('/system')

    expect(await screen.findByText('acme monorepo')).toBeInTheDocument()
    expect(
      screen.getByText('/Users/ell/workspace/work/monorepo'),
    ).toBeInTheDocument()
  })

  it('says so plainly when there is none, because nothing can be dispatched', async () => {
    stubApi({ repositories: [] })

    renderAt('/system')

    expect(
      await screen.findByText(
        'No repository yet, so nothing can be dispatched.',
      ),
    ).toBeInTheDocument()
  })

  it('refuses to submit a relative path', async () => {
    stubApi({ repositories: [] })

    renderAt('/system')
    await userEvent.type(await screen.findByLabelText('Name'), 'acme')
    await userEvent.type(screen.getByLabelText('Path'), '../acme')

    // Absolute because a worktree outlives the process that cut it.
    expect(
      screen.getByRole('button', { name: 'Add repository' }),
    ).toBeDisabled()
  })

  it('adds one from an absolute path', async () => {
    const fetchMock = stubApi({ repositories: [] })

    renderAt('/system')
    await userEvent.type(await screen.findByLabelText('Name'), 'acme')
    await userEvent.type(screen.getByLabelText('Path'), '/Users/ell/acme')
    await userEvent.click(
      screen.getByRole('button', { name: 'Add repository' }),
    )

    await waitFor(() => {
      const posted = fetchMock.mock.calls.find(
        ([url, init]) =>
          String(url) === '/api/repositories' &&
          (init as RequestInit | undefined)?.method === 'POST',
      )
      expect(
        JSON.parse(String((posted?.[1] as RequestInit | undefined)?.body)),
      ).toEqual({
        name: 'acme',
        path: '/Users/ell/acme',
        defaultBaseBranch: 'dev',
      })
    })
  })

  it('removes one', async () => {
    const fetchMock = stubApi()

    renderAt('/system')
    await userEvent.click(await screen.findByRole('button', { name: 'Remove' }))

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            String(url) === `/api/repositories/${aRepository().id}` &&
            (init as RequestInit | undefined)?.method === 'DELETE',
        ),
      ).toBe(true)
    })
  })
})
