import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { aStatus } from './test/fixtures.ts'
import { renderAt } from './test/renderApp.tsx'

const status = aStatus()

describe('system status page', () => {
  it('shows a loading state while the service responds', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => undefined)),
    )
    renderAt('/system')
    expect(screen.getByLabelText('Checking service status')).toBeInTheDocument()
  })

  it('renders the service, database, and installation status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(status), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    )
    renderAt('/system')

    expect(await screen.findByText('All systems local')).toBeInTheDocument()
    expect(screen.getByText('SQLite ready')).toBeInTheDocument()
    expect(screen.getByText(status.installation.id)).toBeInTheDocument()
  })

  it('recovers after the Handler retries a failed status request', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: 'error',
            code: 'database_unavailable',
            message: 'Database unavailable',
          }),
          { status: 503 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(status), { status: 200 }),
      )
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    renderAt('/system')

    expect(await screen.findByText('Service unavailable')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('All systems local')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
