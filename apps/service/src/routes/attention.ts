import { ApiErrorSchema, AttentionItemSchema } from '@handella/contracts'
import {
  Type,
  type FastifyPluginCallbackTypebox,
} from '@fastify/type-provider-typebox'

import type { Store } from '../domain/store.js'

export const attentionRoutes: FastifyPluginCallbackTypebox<{ store: Store }> = (
  app,
  options,
  done,
) => {
  const { store } = options

  app.get(
    '/api/attention',
    {
      schema: {
        querystring: Type.Object({
          includeResolved: Type.Optional(Type.Boolean()),
        }),
        response: { 200: Type.Array(AttentionItemSchema) },
      },
    },
    async (request) =>
      store.listAttentionItems({
        includeResolved: request.query.includeResolved ?? false,
      }),
  )

  app.post(
    '/api/attention/:attentionItemId/resolve',
    {
      schema: {
        params: Type.Object({ attentionItemId: Type.String() }),
        response: { 200: AttentionItemSchema, 404: ApiErrorSchema },
      },
    },
    async (request) =>
      store.resolveAttentionItem(request.params.attentionItemId),
  )

  done()
}
