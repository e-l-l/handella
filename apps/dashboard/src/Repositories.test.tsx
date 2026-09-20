import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { installFakeEventSource } from './test/fakeEventSource.ts'
import { aRepository } from './test/fixtures.ts'
import { renderAt } from './test/renderApp.tsx'
import { jsonResponse, stubApi } from './test/stubApi.ts'

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

    // Absolute because a worktree outlives the process that cut it, and a
    // disabled button that says nothing is indistinguishable from a broken one.
    expect(
      screen.getByRole('button', { name: 'Add repository' }),
    ).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'This has to start with /',
    )
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

describe('choosing a path instead of typing one', () => {
  const stubChooser = (path: string | null) =>
    stubApi({
      repositories: [],
      extra: (url, init) =>
        url.endsWith('/api/repositories/choose-path') && init?.method === 'POST'
          ? jsonResponse({ path })
          : undefined,
    })

  it('fills the field from the native dialog', async () => {
    stubChooser('/Users/handler/workspace/acme')

    renderAt('/system')
    await userEvent.click(
      await screen.findByRole('button', { name: 'Choose…' }),
    )

    await waitFor(() =>
      expect(screen.getByLabelText('Path')).toHaveValue(
        '/Users/handler/workspace/acme',
      ),
    )
    // The folder's own name is a better first guess than an empty box, and the
    // Handler can still overwrite it.
    expect(screen.getByLabelText('Name')).toHaveValue('acme')
  })

  it('keeps a name the Handler already wrote', async () => {
    stubChooser('/Users/handler/workspace/acme')

    renderAt('/system')
    await userEvent.type(await screen.findByLabelText('Name'), 'work monorepo')
    await userEvent.click(screen.getByRole('button', { name: 'Choose…' }))

    await waitFor(() =>
      expect(screen.getByLabelText('Path')).toHaveValue(
        '/Users/handler/workspace/acme',
      ),
    )
    expect(screen.getByLabelText('Name')).toHaveValue('work monorepo')
  })

  it('leaves the draft alone when the dialog is cancelled', async () => {
    stubChooser(null)

    renderAt('/system')
    await userEvent.type(await screen.findByLabelText('Path'), '/tmp/typed')
    await userEvent.click(screen.getByRole('button', { name: 'Choose…' }))

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Choose…' }),
      ).not.toBeDisabled(),
    )
    expect(screen.getByLabelText('Path')).toHaveValue('/tmp/typed')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
