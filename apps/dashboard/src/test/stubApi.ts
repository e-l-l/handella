import type {
  AttentionItem,
  Job,
  PlanVersion,
  Repository,
  RunbookVersion,
  StatusResponse,
} from '@handella/contracts'
import { vi } from 'vitest'

import { aRepository, aRunbookVersion, aStatus } from './fixtures.ts'

export const jsonResponse = (body: unknown, status = 200): Promise<Response> =>
  Promise.resolve(
    new Response(status === 204 ? null : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  )

export interface ApiRoutes {
  attention?: AttentionItem[] | undefined
  jobs?: Job[] | undefined
  planVersions?: PlanVersion[] | undefined
  repositories?: Repository[] | undefined
  runbookVersions?: RunbookVersion[] | undefined
  status?: StatusResponse | undefined
  /**
   * The arms one suite needs and the rest do not. Tried before the shared
   * table, so a path the catch-alls below would swallow — anything under
   * `/api/jobs/`, anything ending `/transitions` — can still be answered.
   * Returning `undefined` falls through to the shared table.
   */
  extra?: (
    url: string,
    init: RequestInit | undefined,
  ) => Promise<Response> | undefined
}

/**
 * The endpoints every suite's screen reaches for, answered once. A new route
 * on a shared screen is added here rather than in each suite that happens to
 * render it — four copies of this table is four places to remember.
 */
export const stubApi = (routes: ApiRoutes = {}) => {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'

    const bespoke = routes.extra?.(url, init)
    if (bespoke !== undefined) return bespoke

    if (url === '/api/status') return jsonResponse(routes.status ?? aStatus())
    if (url === '/api/attention') return jsonResponse(routes.attention ?? [])
    if (url === '/api/queue/order') return jsonResponse([])

    if (url === '/api/repositories') {
      // The created row echoes what was posted, the way the service does.
      if (method === 'POST')
        return jsonResponse(
          aRepository(JSON.parse(String(init?.body)) as Partial<Repository>),
          201,
        )
      return jsonResponse(routes.repositories ?? [aRepository()])
    }
    if (url.startsWith('/api/repositories/') && method === 'DELETE')
      return jsonResponse(null, 204)

    if (url === '/api/runbook-versions') {
      if (method === 'POST')
        return jsonResponse(
          aRunbookVersion(
            JSON.parse(String(init?.body)) as { content: string },
          ),
          201,
        )
      return jsonResponse(routes.runbookVersions ?? [aRunbookVersion()])
    }

    if (url === '/api/jobs') return jsonResponse(routes.jobs ?? [])
    if (url.endsWith('/transitions')) return jsonResponse([])
    if (url.endsWith('/plan-versions'))
      return jsonResponse(routes.planVersions ?? [])
    if (url.startsWith('/api/jobs/'))
      return jsonResponse((routes.jobs ?? [])[0])

    return Promise.resolve(new Response('{}', { status: 404 }))
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}
