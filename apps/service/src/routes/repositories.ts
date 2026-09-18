import {
  ApiErrorSchema,
  CreateRepositorySchema,
  RepositorySchema,
  UpdateRepositorySchema,
} from '@handella/contracts'
import {
  Type,
  type FastifyPluginCallbackTypebox,
} from '@fastify/type-provider-typebox'

import type { Store } from '../domain/store.js'

const RepositoryIdParamsSchema = Type.Object({ repositoryId: Type.String() })

export const repositoryRoutes: FastifyPluginCallbackTypebox<{
  store: Store
}> = (app, options, done) => {
  const { store } = options

  app.get(
    '/api/repositories',
    { schema: { response: { 200: Type.Array(RepositorySchema) } } },
    async () => store.listRepositories(),
  )

  app.post(
    '/api/repositories',
    {
      schema: {
        body: CreateRepositorySchema,
        response: { 201: RepositorySchema, 400: ApiErrorSchema },
      },
    },
    async (request, reply) =>
      reply.code(201).send(store.createRepository(request.body)),
  )

  app.get(
    '/api/repositories/:repositoryId',
    {
      schema: {
        params: RepositoryIdParamsSchema,
        response: { 200: RepositorySchema, 404: ApiErrorSchema },
      },
    },
    async (request) => store.getRepository(request.params.repositoryId),
  )

  app.patch(
    '/api/repositories/:repositoryId',
    {
      schema: {
        params: RepositoryIdParamsSchema,
        body: UpdateRepositorySchema,
        response: {
          200: RepositorySchema,
          400: ApiErrorSchema,
          404: ApiErrorSchema,
        },
      },
    },
    async (request) =>
      store.updateRepository(request.params.repositoryId, request.body),
  )

  app.delete(
    '/api/repositories/:repositoryId',
    {
      schema: {
        params: RepositoryIdParamsSchema,
        response: {
          204: Type.Null(),
          404: ApiErrorSchema,
          409: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      store.deleteRepository(request.params.repositoryId)
      return reply.code(204).send(null)
    },
  )

  done()
}
