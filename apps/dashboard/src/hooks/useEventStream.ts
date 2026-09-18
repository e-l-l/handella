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

    // Anything missed while disconnected is repaired by a full refetch, which
    // is why the stream needs no replay. The first `open` is the connection
    // this effect just made, and the pages have already fetched through it.
    let connected = false
    source.addEventListener('open', () => {
      if (connected) {
        void queryClient.invalidateQueries()
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
