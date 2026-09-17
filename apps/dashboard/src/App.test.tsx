import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import App from './App.tsx'

const status = {
  status: 'ok',
  version: '0.1.0',
  startedAt: '2026-09-18T10:00:00.000Z',
  uptimeSeconds: 93,
  installation: {
    id: '123e4567-e89b-42d3-a456-426614174000',
    createdAt: '2026-09-18T09:00:00.000Z',
    lastStartedAt: '2026-09-18T10:00:00.000Z',
  },
  database: { status: 'ok', journalMode: 'wal' },
}

function renderApp() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/system']}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('system status page', () => {
  it('shows a loading state while the service responds', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => undefined)),
    )
    renderApp()
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
    renderApp()

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
    renderApp()

    expect(await screen.findByText('Service unavailable')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('All systems local')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
