import { PlanContentSchema, type PlanContent } from '@handella/contracts'
import { Compile } from 'typebox/compile'

import { planContentInvalid } from './errors.js'

/**
 * Compiled once at load rather than interpreted per call. Every plan read out
 * of the database passes through here, and the job page refetches its
 * revisions on every event it sees, so this is a per-row cost on a path that
 * runs far more often than a plan is written.
 */
const planContent = Compile(PlanContentSchema)

/**
 * The one gate a plan passes through, wherever it came from. Codex is given
 * this schema and still has to be checked against it: `--output-schema`
 * constrains the model rather than guaranteeing it, and a plan that is nearly
 * the right shape is worse than one that is obviously not.
 */
export function assertPlanContent(
  value: unknown,
): asserts value is PlanContent {
  if (planContent.Check(value)) return

  // The first failure only: a plan of the wrong shape usually fails in every
  // field at once, and the whole list says no more than one line of it.
  const first = planContent.Errors(value)[0]
  throw planContentInvalid(
    first === undefined
      ? 'A plan does not match the plan schema'
      : `A plan does not match the plan schema: ${first.message} at ${
          first.instancePath === '' ? '/' : first.instancePath
        }`,
  )
}

/** Parse and check together, for the two places a plan arrives as text. */
export const parsePlanContent = (
  content: string,
  source: string,
): PlanContent => {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch (error) {
    throw planContentInvalid(`${source} is not valid JSON`, error)
  }

  assertPlanContent(parsed)
  return parsed
}
