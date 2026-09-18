import { Type, type TLiteral, type TSchema, type TUnion } from 'typebox'

export const IsoDateTimeSchema = Type.String({
  pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$',
})

export const UuidSchema = Type.String({
  pattern:
    '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$',
})

type LiteralMembers<Values extends readonly string[]> = {
  -readonly [Index in keyof Values]: TLiteral<Values[Index] & string>
}

/**
 * Builds a literal union schema from the same readonly tuple the database and
 * the state machine use, so a value can never be legal in one and not the
 * other. The cast restores the per-member literal types that `map` erases;
 * without it every `Static` downstream collapses to `never`.
 *
 * Deliberately carries no `$id`: these are building blocks that get inlined
 * into several records, and Fastify refuses to compile a serializer whose
 * schema graph resolves one `$id` to more than one schema.
 */
export const literalUnion = <const Values extends readonly string[]>(
  values: Values,
): TUnion<LiteralMembers<Values>> =>
  Type.Union(
    values.map((value) =>
      Type.Literal(value),
    ) as unknown as LiteralMembers<Values>,
  ) as TUnion<LiteralMembers<Values>>

/**
 * The runtime counterpart of `literalUnion`: the same tuple, narrowing a
 * string that arrived from the database or the wire. One cast here is what
 * keeps every guard built from it cast-free.
 */
export const isOneOf =
  <const Values extends readonly string[]>(values: Values) =>
  (value: string): value is Values[number] =>
    (values as readonly string[]).includes(value)

export const Nullable = <Schema extends TSchema>(schema: Schema) =>
  Type.Union([schema, Type.Null()])
