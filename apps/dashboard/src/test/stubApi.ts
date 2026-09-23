import type {
  Attempt,
  AttentionItem,
  Job,
  Milestone,
  Repository,
  RunbookVersion,
  StatusResponse,
} from '@handella/contracts'
import { vi } from 'vitest'

import { aJob, aRepository, aRunbookVersion, aStatus } from './fixtures.ts'

export const jsonResponse = (body: unknown, status = 200): Promise<Response> =>
  Promise.resolve(
    new Response(status === 204 ? null : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  )

export interface ApiRoutes {
  attempts?: Attempt[] | undefined
  attention?: AttentionItem[] | undefined
  jobs?: Job[] | undefined
  milestones?: Milestone[] | undefined
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
    // Editing one echoes the patch over the fixture, the way the service does.
    if (url.startsWith('/api/repositories/') && method === 'PATCH')
      return jsonResponse(
        aRepository(JSON.parse(String(init?.body)) as Partial<Repository>),
      )

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
    // 202 and 204, the way the service answers them: dispatch has committed
    // the claim but not the worktree, and opening a terminal commits nothing
    // at all. Both sit above the `/api/jobs/` catch-all, which is prefix
    // matched and would otherwise swallow them.
    if (url.endsWith('/dispatch') && method === 'POST')
      return jsonResponse(aJob({ state: 'queued' }), 202)
    if (url.endsWith('/terminal') && method === 'POST')
      return jsonResponse(null, 204)
    // Approval answers with the job as the service does: moved to `approved`.
    if (url.endsWith('/approve') && method === 'POST')
      return jsonResponse(aJob({ state: 'approved' }))
    if (url.endsWith('/transitions')) return jsonResponse([])
    if (url.endsWith('/attempts')) return jsonResponse(routes.attempts ?? [])
    if (url.endsWith('/milestones'))
      return jsonResponse(routes.milestones ?? [])
    // The one endpoint that answers with text rather than a record.
    if (url.includes('/log'))
      return Promise.resolve(
        new Response('{"type":"turn.started"}\n', {
          headers: { 'content-type': 'text/plain' },
          status: 200,
        }),
      )
    if (url.startsWith('/api/jobs/'))
      return jsonResponse((routes.jobs ?? [])[0])

    return Promise.resolve(new Response('{}', { status: 404 }))
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/**
 * The POSTs one run made to a path, as the bodies they carried.
 *
 * Matched by suffix, so a per-job endpoint can be named `/dispatch` without
 * spelling out an id, and an exact path still matches itself. Shared because
 * three suites had each written their own and the names had already started
 * to differ more than the behaviour.
 */
export const postsTo = (
  fetchMock: ReturnType<typeof stubApi>,
  path: string,
): (Record<string, unknown> | undefined)[] =>
  fetchMock.mock.calls
    .filter(
      ([url, init]) =>
        String(url).endsWith(path) &&
        (init as RequestInit | undefined)?.method === 'POST',
    )
    .map(([, init]) => {
      const body = (init as RequestInit | undefined)?.body
      return body === undefined || body === null
        ? undefined
        : (JSON.parse(String(body)) as Record<string, unknown>)
    })
