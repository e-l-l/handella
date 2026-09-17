import { Type, type Static } from '@sinclair/typebox'

const IsoDateTimeSchema = Type.String({
  pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$',
})

const UuidSchema = Type.String({
  pattern:
    '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$',
})

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
