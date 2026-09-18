import {
  StatusErrorSchema,
  StatusResponseSchema,
  type StatusError,
  type StatusResponse,
} from '@handella/contracts'
import type { FastifyPluginCallback } from 'fastify'

import type { StatusSource } from '../database/database.js'

interface StatusRouteOptions {
  startedAt: Date
  statusSource: StatusSource
  version: string
}

export const statusRoutes: FastifyPluginCallback<StatusRouteOptions> = (
  app,
  options,
  done,
) => {
  app.get<{ Reply: StatusError | StatusResponse }>(
    '/api/status',
    {
      schema: {
        response: {
          200: StatusResponseSchema,
          503: StatusErrorSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const status = options.statusSource.getStatus()
        return {
          status: 'ok',
          version: options.version,
          startedAt: options.startedAt.toISOString(),
          uptimeSeconds: Math.max(
            0,
            (Date.now() - options.startedAt.getTime()) / 1_000,
          ),
          installation: {
            id: status.id,
            createdAt: status.createdAt.toISOString(),
            lastStartedAt: status.lastStartedAt.toISOString(),
          },
          database: {
            status: 'ok',
            journalMode: status.journalMode,
          },
        }
      } catch (error) {
        request.log.error({ err: error }, 'Database status check failed')
        return reply.code(503).send({
          status: 'error',
          code: 'database_unavailable',
          message: 'Database unavailable',
        })
      }
    },
  )

  done()
}
