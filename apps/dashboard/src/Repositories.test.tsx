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

/**
 * The add form is behind a disclosure now rather than permanently open beneath
 * the list: System is a settings screen, and a settings screen that is half an
 * open form reads as a form. Every test that fills it in opens it first.
 *
 * While it is open the trigger reads "Cancel", so the only control named "Add
 * repository" at any one moment is the one that submits.
 */
const openTheAddForm = async () =>
  userEvent.click(await screen.findByRole('button', { name: 'Add repository' }))

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
        /No repository yet, so nothing can be dispatched/,
      ),
    ).toBeInTheDocument()
  })

  it('refuses to submit a relative path', async () => {
    stubApi({ repositories: [] })

    renderAt('/system')
    await openTheAddForm()
    await userEvent.type(screen.getByLabelText('Name'), 'acme')
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
    await openTheAddForm()
    await userEvent.type(screen.getByLabelText('Name'), 'acme')
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

  /**
   * Removing one is destructive, so it asks first and the question names the
   * consequence rather than asking whether the Handler is sure.
   */
  it('confirms before removing one, naming what is left alone', async () => {
    const fetchMock = stubApi()

    renderAt('/system')
    await userEvent.click(await screen.findByRole('button', { name: 'Remove' }))

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('The directory on disk')
    expect(
      fetchMock.mock.calls.some(
        ([, init]) => (init as RequestInit | undefined)?.method === 'DELETE',
      ),
    ).toBe(false)

    await userEvent.click(
      screen.getByRole('button', { name: 'Remove repository' }),
    )

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

  it('removes nothing when the Handler backs out of the confirmation', async () => {
    const fetchMock = stubApi()

    renderAt('/system')
    await userEvent.click(await screen.findByRole('button', { name: 'Remove' }))
    await userEvent.click(
      await screen.findByRole('button', { name: 'Keep it' }),
    )

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(
      fetchMock.mock.calls.some(
        ([, init]) => (init as RequestInit | undefined)?.method === 'DELETE',
      ),
    ).toBe(false)
  })

  /** The name, path and default base branch are all editable in place. */
  it('edits one through the same three fields it was added with', async () => {
    const fetchMock = stubApi()

    renderAt('/system')
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    expect(screen.getByLabelText('Name')).toHaveValue('acme monorepo')

    await userEvent.clear(screen.getByLabelText('Name'))
    await userEvent.type(screen.getByLabelText('Name'), 'acme')
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => {
      const patched = fetchMock.mock.calls.find(
        ([url, init]) =>
          String(url) === `/api/repositories/${aRepository().id}` &&
          (init as RequestInit | undefined)?.method === 'PATCH',
      )
      expect(
        JSON.parse(String((patched?.[1] as RequestInit | undefined)?.body)),
      ).toEqual({
        name: 'acme',
        path: '/Users/ell/workspace/work/monorepo',
        defaultBaseBranch: 'dev',
      })
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
    await openTheAddForm()
    await userEvent.click(screen.getByRole('button', { name: 'Choose…' }))

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
    await openTheAddForm()
    await userEvent.type(screen.getByLabelText('Name'), 'work monorepo')
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
    await openTheAddForm()
    await userEvent.type(screen.getByLabelText('Path'), '/tmp/typed')
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
