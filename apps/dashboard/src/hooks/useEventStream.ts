import type { DomainEventName } from '@handella/contracts'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

import { attentionKeys } from '../api/attention.ts'
import { jobKeys } from '../api/jobs.ts'

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

    const invalidations: Record<DomainEventName, readonly string[]> = {
      'job.changed': jobKeys.all,
      'attention.changed': attentionKeys.all,
    }

    // Anything missed while disconnected is repaired by refetching what the
    // stream carries, which is why it needs no replay. Only these two things
    // are ever announced, so only these two can have been missed: invalidating
    // everything would also discard the intake lists, which no event can
    // change and which cost the local service a round trip to Linear per
    // issue to rebuild. The first `open` is the connection this effect just
    // made, and the pages have already fetched through it.
    let connected = false
    source.addEventListener('open', () => {
      if (connected) {
        for (const queryKey of Object.values(invalidations)) {
          void queryClient.invalidateQueries({ queryKey })
        }
      }
      connected = true
    })

    for (const [name, queryKey] of Object.entries(invalidations)) {
      source.addEventListener(name, () => {
        void queryClient.invalidateQueries({ queryKey })
      })
    }

    return () => {
      source.close()
    }
  }, [queryClient])
}
