import { fastifySSE } from '@fastify/sse'
import fastifyPlugin from 'fastify-plugin'
import type { FastifyPluginAsync } from 'fastify'

import type { Broadcaster } from '../events/broadcaster.js'

/**
 * @fastify/sse ships ESM-style declarations for a CommonJS module, so the
 * fastify-plugin wrapped `module.exports` it publishes is invisible to the
 * type system. Wrapping the typed named export ourselves gets the same
 * escape from encapsulation, which the `sse` route option below depends on.
 */
const ssePlugin = fastifyPlugin(fastifySSE, {
  fastify: '5.x',
  name: '@fastify/sse',
})

interface EventRouteOptions {
  broadcaster: Broadcaster
}

/**
 * The only module that knows how events reach the browser. Payloads name what
 * changed rather than carrying it, so the dashboard refetches through the same
 * REST endpoints that describe every entity.
 */
export const eventRoutes: FastifyPluginAsync<EventRouteOptions> = async (
  app,
  options,
) => {
  await app.register(ssePlugin, { heartbeatInterval: 15_000 })

  app.get('/api/events', { sse: 'only' }, async (_request, reply) => {
    reply.sse.keepAlive()
    // The plugin writes headers lazily, so a stream that has nothing to say
    // yet would otherwise return as an empty 200. This commits the response
    // as SSE and starts the heartbeat.
    reply.sse.sendHeaders()
    // sendHeaders only stages them. Node, and any proxy in front of us, waits
    // for a body byte before putting headers on the wire, so without this the
    // client's open event is delayed by a full heartbeat interval. An SSE
    // comment is ignored by EventSource and costs nothing.
    reply.raw.write(': open\n\n')

    const unsubscribe = options.broadcaster.subscribe((event) => {
      if (!reply.sse.isConnected) {
        return
      }
      void reply.sse.send({ event: event.name, data: event.data })
    })

    reply.sse.onClose(unsubscribe)
  })
}
