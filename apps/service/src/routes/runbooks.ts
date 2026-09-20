import {
  ApiErrorSchema,
  CreateRunbookVersionSchema,
  RunbookVersionSchema,
} from '@handella/contracts'
import {
  Type,
  type FastifyPluginCallbackTypebox,
} from '@fastify/type-provider-typebox'

import type { Store } from '../domain/store.js'

/**
 * The Runbook the Handler maintains. Append-only, so there is no PUT and no
 * DELETE: saving is posting a new version, and the newest is the one in force.
 */
export const runbookRoutes: FastifyPluginCallbackTypebox<{ store: Store }> = (
  app,
  options,
  done,
) => {
  const { store } = options

  app.get(
    '/api/runbook-versions',
    { schema: { response: { 200: Type.Array(RunbookVersionSchema) } } },
    async () => store.listRunbookVersions(),
  )

  app.post(
    '/api/runbook-versions',
    {
      schema: {
        body: CreateRunbookVersionSchema,
        response: { 201: RunbookVersionSchema, 409: ApiErrorSchema },
      },
    },
    async (request, reply) =>
      reply.code(201).send(store.createRunbookVersion(request.body)),
  )

  done()
}
