import fastifyStatic from '@fastify/static'
import {
  TypeBoxValidatorCompiler,
  type TypeBoxTypeProvider,
} from '@fastify/type-provider-typebox'
import Fastify, { type FastifyError, type FastifyServerOptions } from 'fastify'

import type { CodexAdapter } from './adapters/codex.js'
import type { GitAdapter } from './adapters/git.js'
import type { LinearAdapter } from './adapters/linear.js'
import type { StatusSource } from './database/database.js'
import { DomainError } from './domain/errors.js'
import type { Dispatcher } from './domain/dispatch.js'
import type { Store } from './domain/store.js'
import type { Broadcaster } from './events/broadcaster.js'
import { attentionRoutes } from './routes/attention.js'
import { repositoryRoutes } from './routes/repositories.js'
import { eventRoutes } from './routes/events.js'
import { intakeRoutes } from './routes/intake.js'
import { jobRoutes } from './routes/jobs.js'
import { runbookRoutes } from './routes/runbooks.js'
import { statusRoutes } from './routes/status.js'

interface BuildAppOptions {
  broadcaster: Broadcaster
  codex: CodexAdapter
  dashboardPath?: string
  dispatcher: Dispatcher
  git: GitAdapter
  linear: LinearAdapter
  logger?: FastifyServerOptions['logger']
  startedAt?: Date
  statusSource: StatusSource
  store: Store
  version: string
}

const notFoundBody = (method: string, url: string) => ({
  statusCode: 404,
  error: 'Not Found',
  message: `Route ${method}:${url} not found`,
})

export async function buildApp(options: BuildAppOptions) {
  // The chain has to hang off the Fastify() call itself; assigning first and
  // calling withTypeProvider afterwards throws the typed view away.
  const app = Fastify({
    // An open /api/events stream is never idle, so without this a shutdown
    // waits for the Handler to close their browser tab before it completes.
    forceCloseConnections: true,
    logger: options.logger ?? false,
  })
    .setValidatorCompiler(TypeBoxValidatorCompiler)
    .withTypeProvider<TypeBoxTypeProvider>()

  const startedAt = options.startedAt ?? new Date()

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof DomainError) {
      // Upstream detail never reaches the wire, but it is the only thing that
      // makes an integration failure diagnosable, so it goes to the local log.
      if (error.cause !== undefined) {
        request.log.warn({ err: error.cause }, 'Upstream call failed')
      }
      return reply
        .code(error.statusCode)
        .send({ code: error.code, message: error.message })
    }

    if (error.validation !== undefined) {
      return reply
        .code(400)
        .send({ code: 'validation_failed', message: error.message })
    }

    request.log.error({ err: error }, 'Unhandled request error')
    return reply
      .code(error.statusCode ?? 500)
      .send({ code: 'internal_error', message: 'Internal Server Error' })
  })

  await app.register(statusRoutes, {
    codex: options.codex,
    linear: options.linear,
    startedAt,
    statusSource: options.statusSource,
    version: options.version,
  })
  await app.register(jobRoutes, {
    dispatcher: options.dispatcher,
    store: options.store,
  })
  await app.register(attentionRoutes, { store: options.store })
  await app.register(runbookRoutes, { store: options.store })
  await app.register(repositoryRoutes, { store: options.store })
  await app.register(intakeRoutes, {
    git: options.git,
    linear: options.linear,
    store: options.store,
  })
  await app.register(eventRoutes, { broadcaster: options.broadcaster })

  if (options.dashboardPath !== undefined) {
    await app.register(fastifyStatic, {
      root: options.dashboardPath,
    })
  }

  // The dashboard is a single-page app, so anything outside /api/ that the
  // server does not recognise is a client-side route it should render.
  app.setNotFoundHandler((request, reply) => {
    if (
      options.dashboardPath !== undefined &&
      !request.url.startsWith('/api/')
    ) {
      return reply.type('text/html').sendFile('index.html')
    }

    return reply.code(404).send(notFoundBody(request.method, request.url))
  })

  return app
}
