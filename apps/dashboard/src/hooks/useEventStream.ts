import type { DomainEventName } from '@handella/contracts'
import { useQueryClient, type QueryKey } from '@tanstack/react-query'
import { useEffect } from 'react'

import { attentionKeys } from '../api/attention.ts'
import { jobKeys } from '../api/jobs.ts'

/** A payload Handella did not write is not worth throwing over. */
const jobIdOf = (payload: string): string | undefined => {
  try {
    const parsed = JSON.parse(payload) as { jobId?: unknown }
    return typeof parsed.jobId === 'string' ? parsed.jobId : undefined
  } catch {
    return undefined
  }
}

/**
 * Turns the service's event stream into cache invalidations. Events name what
 * changed rather than carrying it, so every refresh goes back through the REST
 * endpoints and there is only ever one description of an entity.
 *
 * jsdom has no EventSource, so tests stub this hook rather than the transport.
 */
export function useEventStream(): void {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (typeof EventSource === 'undefined') {
      return
    }

    const source = new EventSource('/api/events')

    // What each event invalidates, as a function of the job it names. A
    // function because one of the three names a job and the other two name a
    // whole collection — one table and one loop, rather than a table with a
    // hole cut in it and a listener beside it.
    const invalidations: Record<
      DomainEventName,
      (jobId: string | undefined) => readonly QueryKey[]
    > = {
      'attention.changed': () => [attentionKeys.all],
      'job.changed': () => [jobKeys.all],
      // Deliberately not `jobKeys.all`: this fires about once a second while a
      // job is implementing, and invalidating every job for it would refetch
      // the list on every beat of a spine nobody may be looking at. The
      // attempts list is not here either — it changes twice a turn, and
      // `job.changed` is raised for both of those.
      'job.progress': (jobId) =>
        jobId === undefined ? [] : [jobKeys.milestones(jobId)],
    }

    // Anything missed while disconnected is repaired by refetching what the
    // stream carries, which is why it needs no replay. Asked with no job,
    // because a reconnect knows of none: the collection-wide keys answer and
    // the per-job one returns nothing, which is the right opt-out rather than
    // an accidental one. Invalidating everything instead would also discard the
    // intake lists, which no event can change and which cost the local service
    // a round trip to Linear per issue to rebuild. The first `open` is the
    // connection this effect just made, and the pages have already fetched
    // through it.
    let connected = false
    source.addEventListener('open', () => {
      if (connected) {
        for (const keysFor of Object.values(invalidations)) {
          for (const queryKey of keysFor(undefined)) {
            void queryClient.invalidateQueries({ queryKey })
          }
        }
      }
      connected = true
    })

    for (const [name, keysFor] of Object.entries(invalidations)) {
      source.addEventListener(name, (event) => {
        const data = (event as MessageEvent<string>).data
        for (const queryKey of keysFor(jobIdOf(data))) {
          void queryClient.invalidateQueries({ queryKey })
        }
      })
    }

    return () => {
      source.close()
    }
  }, [queryClient])
}
