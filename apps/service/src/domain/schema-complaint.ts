import type { Compile } from 'typebox/compile'

type Compiled = ReturnType<typeof Compile>

/**
 * The first failure, in the one spelling every schema gate here uses.
 *
 * The first only: a value of the wrong shape usually fails in every field at
 * once, and the whole list says no more than one line of it. Shared because the
 * `instancePath === '' ? '/' : instancePath` detail is the part that drifts
 * when it is written twice.
 */
export const schemaComplaint = (
  compiled: Compiled,
  value: unknown,
  subject: string,
): string => {
  const first = compiled.Errors(value)[0]
  return first === undefined
    ? subject
    : `${subject}: ${first.message} at ${
        first.instancePath === '' ? '/' : first.instancePath
      }`
}
