import { Type, type Static } from 'typebox'

import { IsoDateTimeSchema, UuidSchema } from './primitives.js'

export const StatusResponseSchema = Type.Object(
  {
    status: Type.Literal('ok'),
    version: Type.String(),
    startedAt: IsoDateTimeSchema,
    uptimeSeconds: Type.Number({ minimum: 0 }),
    installation: Type.Object(
      {
        id: UuidSchema,
        createdAt: IsoDateTimeSchema,
        lastStartedAt: IsoDateTimeSchema,
      },
      { additionalProperties: false },
    ),
    /**
     * What the Handler still has to set up. An integration Handella can run
     * without is reported here rather than refused at startup, so the
     * dashboard can offer a setup notice instead of a failed request.
     */
    integrations: Type.Object(
      {
        linear: Type.Object(
          { configured: Type.Boolean() },
          { additionalProperties: false },
        ),
      },
      { additionalProperties: false },
    ),
    database: Type.Object(
      {
        status: Type.Literal('ok'),
        journalMode: Type.Literal('wal'),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false, $id: 'StatusResponse' },
)

export type StatusResponse = Static<typeof StatusResponseSchema>

export const StatusErrorSchema = Type.Object(
  {
    status: Type.Literal('error'),
    code: Type.Literal('database_unavailable'),
    message: Type.String(),
  },
  { additionalProperties: false, $id: 'StatusError' },
)

export type StatusError = Static<typeof StatusErrorSchema>
