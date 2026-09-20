import {
  ImplementationReportSchema,
  type ImplementationReport,
} from '@handella/contracts'
import { Compile } from 'typebox/compile'

import { implementationReportInvalid } from './errors.js'
import { schemaComplaint } from './schema-complaint.js'

/** Compiled once at load, for the reason `plan-content.ts` compiles its own once. */
const implementationReport = Compile(ImplementationReportSchema)

/**
 * The one gate a completion report passes through. Codex is given this schema
 * and is still checked against it: `--output-schema` constrains the model
 * rather than guaranteeing it, and a report that is nearly the right shape is
 * what a repair cycle would then be built on.
 */
function assertImplementationReport(
  value: unknown,
): asserts value is ImplementationReport {
  if (implementationReport.Check(value)) return

  throw implementationReportInvalid(
    schemaComplaint(
      implementationReport,
      value,
      'A completion report does not match the report schema',
    ),
  )
}

export const parseImplementationReport = (
  content: string,
  source: string,
): ImplementationReport => {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch (error) {
    throw implementationReportInvalid(`${source} is not valid JSON`, error)
  }

  assertImplementationReport(parsed)
  return parsed
}
