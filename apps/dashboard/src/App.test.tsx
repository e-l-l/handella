import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { aStatus } from './test/fixtures.ts'
import { renderAt } from './test/renderApp.tsx'

const status = aStatus()

/**
 * The shell asks for jobs on every screen to show how many are running, so a
 * stub answers by route rather than answering everything with one body.
 */
const stubStatus = (...responses: (() => Response)[]) => {
  let call = 0
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    if (String(input) !== '/api/status')
      return Promise.resolve(new Response('[]', { status: 200 }))
    const next = responses[Math.min(call, responses.length - 1)]
    call += 1
    return Promise.resolve(next!())
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const okStatus = () =>
  new Response(JSON.stringify(status), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

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
    stubStatus(okStatus)
    renderAt('/system')

    expect(await screen.findByText('All systems local')).toBeInTheDocument()
    expect(screen.getByText('SQLite ready')).toBeInTheDocument()
    expect(screen.getByText(status.installation.id)).toBeInTheDocument()
  })

  it('recovers after the Handler retries a failed status request', async () => {
    const fetchMock = stubStatus(
      () =>
        new Response(
          JSON.stringify({
            status: 'error',
            code: 'database_unavailable',
            message: 'Database unavailable',
          }),
          { status: 503 },
        ),
      okStatus,
    )
    const user = userEvent.setup()
    renderAt('/system')

    expect(await screen.findByText('Service unavailable')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('All systems local')).toBeInTheDocument()
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url) === '/api/status'),
    ).toHaveLength(2)
  })
})
