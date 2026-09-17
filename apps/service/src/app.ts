import fastifyStatic from '@fastify/static'
import {
  StatusErrorSchema,
  StatusResponseSchema,
  type StatusError,
  type StatusResponse,
} from '@handella/contracts'
import Fastify, { type FastifyServerOptions } from 'fastify'

import type { StatusSource } from './database/database.js'

interface BuildAppOptions {
  dashboardPath?: string
  logger?: FastifyServerOptions['logger']
  startedAt?: Date
  statusSource: StatusSource
  version: string
}

export function buildApp(options: BuildAppOptions) {
  const app = Fastify({ logger: options.logger ?? false })
  const startedAt = options.startedAt ?? new Date()

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
          startedAt: startedAt.toISOString(),
          uptimeSeconds: Math.max(
            0,
            (Date.now() - startedAt.getTime()) / 1_000,
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

  if (options.dashboardPath !== undefined) {
    app.register(fastifyStatic, {
      root: options.dashboardPath,
    })
  }

  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/')) {
      return reply.code(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: `Route ${request.method}:${request.url} not found`,
      })
    }

    if (options.dashboardPath !== undefined) {
      return reply.type('text/html').sendFile('index.html')
    }

    return reply.code(404).send({
      statusCode: 404,
      error: 'Not Found',
      message: `Route ${request.method}:${request.url} not found`,
    })
  })

  return app
}
