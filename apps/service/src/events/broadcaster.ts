import type { DomainEvent } from '@handella/contracts'

type Listener = (event: DomainEvent) => void

/**
 * A process-local fan-out. Events are deliberately not persisted: a dashboard
 * that misses one while disconnected resyncs by refetching on reconnect, and
 * `job_transitions` remains the durable history. Keeping the transport out of
 * this module is what lets the SSE plugin be swapped in one file.
 */
export interface Broadcaster {
  publish(event: DomainEvent): void
  subscribe(listener: Listener): () => void
}

export function createBroadcaster(): Broadcaster {
  const listeners = new Set<Listener>()

  return {
    publish(event) {
      for (const listener of [...listeners]) {
        listener(event)
      }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
