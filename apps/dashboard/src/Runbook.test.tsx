import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { installFakeEventSource } from './test/fakeEventSource.ts'
import { aRunbookVersion } from './test/fixtures.ts'
import { renderAt } from './test/renderApp.tsx'
import { jsonResponse, stubApi } from './test/stubApi.ts'

beforeEach(() => {
  installFakeEventSource()
  localStorage.clear()
})

describe('the runbook in settings', () => {
  it('shows the version in force', async () => {
    stubApi({ runbookVersions: [aRunbookVersion({ version: 3 })] })

    renderAt('/system')

    expect(await screen.findByText(/v3 in force/)).toBeInTheDocument()
    expect(screen.getByLabelText('Runbook')).toHaveValue(
      'Run the suite. Open a pull request.',
    )
  })

  it('saves an edit as the next version rather than changing this one', async () => {
    let body: string | undefined
    stubApi({
      runbookVersions: [aRunbookVersion({ version: 3 })],
      extra: (url, init) => {
        if (url === '/api/runbook-versions' && init?.method === 'POST') {
          body = String(init.body)
          return jsonResponse(aRunbookVersion({ version: 4 }), 201)
        }
        return undefined
      },
    })

    renderAt('/system')
    await screen.findByText(/v3 in force/)
    await userEvent.type(screen.getByLabelText('Runbook'), ' Twice.')
    await userEvent.click(screen.getByRole('button', { name: 'Save as v4' }))

    await waitFor(() =>
      expect(body).toBe(
        JSON.stringify({
          content: 'Run the suite. Open a pull request. Twice.',
        }),
      ),
    )
  })

  it('will not save until something actually changed', async () => {
    stubApi({ runbookVersions: [aRunbookVersion()] })

    renderAt('/system')
    await screen.findByText(/v1 in force/)

    expect(screen.getByRole('button', { name: 'Save as v2' })).toBeDisabled()
  })

  it('keeps the earlier versions readable', async () => {
    stubApi({
      runbookVersions: [
        aRunbookVersion({ version: 2 }),
        aRunbookVersion({
          id: '99999999-8888-4777-8666-555555555555',
          version: 1,
          content: 'Run the suite.',
        }),
      ],
    })

    renderAt('/system')

    expect(await screen.findByText('1 earlier version')).toBeInTheDocument()
    expect(screen.getByText('Run the suite.')).toBeInTheDocument()
  })
})
