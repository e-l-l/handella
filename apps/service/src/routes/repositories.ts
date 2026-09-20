import {
  ApiErrorSchema,
  ChosenFolderSchema,
  CreateRepositorySchema,
  RepositorySchema,
  UpdateRepositorySchema,
} from '@handella/contracts'
import {
  Type,
  type FastifyPluginCallbackTypebox,
} from '@fastify/type-provider-typebox'

import type { FolderPicker } from '../adapters/folders.js'
import { assertRepositoryPath } from '../domain/repository-path.js'
import type { Store } from '../domain/store.js'

const RepositoryIdParamsSchema = Type.Object({ repositoryId: Type.String() })

export const repositoryRoutes: FastifyPluginCallbackTypebox<{
  folders: FolderPicker
  store: Store
}> = (app, options, done) => {
  const { folders, store } = options

  /**
   * The dialog, opened on the machine the service is running on. A POST rather
   * than a GET because it is not a read: it puts a window in front of someone
   * and waits for them. That keeps a link and a prefetch out, and nothing
   * else — a body-less POST is a CORS simple request, so what keeps another
   * site's script out is the same-origin hook in `app.ts` (ADR 0009).
   */
  app.post(
    '/api/repositories/choose-path',
    {
      schema: { response: { 200: ChosenFolderSchema, 502: ApiErrorSchema } },
    },
    async () => ({ path: await folders.choose() }),
  )

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
    async (request, reply) => {
      assertRepositoryPath(request.body.path)
      return reply.code(201).send(store.createRepository(request.body))
    },
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
    async (request) => {
      // Only when the path is the field being edited: a rename should not be
      // refused because a checkout moved out from under a row months ago.
      if (request.body.path !== undefined) {
        assertRepositoryPath(request.body.path)
      }
      return store.updateRepository(request.params.repositoryId, request.body)
    },
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
