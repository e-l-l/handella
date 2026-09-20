import { describe, expect, it } from 'vitest'

import {
  canTransition,
  isJobState,
  jobStates,
  jobStateTransitions,
  legalTransitionsFrom,
  terminalJobStates,
} from '../src/index.js'

describe('job state machine', () => {
  it('declares an edge list for every state', () => {
    expect(Object.keys(jobStateTransitions).sort()).toEqual(
      [...jobStates].sort(),
    )
  })

  it('never names a state outside the union', () => {
    for (const [from, targets] of Object.entries(jobStateTransitions)) {
      for (const to of targets) {
        expect(isJobState(to), `${from} -> ${to}`).toBe(true)
      }
    }
  })

  it('never declares a self-transition or a duplicate edge', () => {
    for (const [from, targets] of Object.entries(jobStateTransitions)) {
      expect(targets).not.toContain(from)
      expect(new Set(targets).size).toBe(targets.length)
    }
  })

  it('reaches every state from intake', () => {
    const seen = new Set(['intake'])
    const queue = ['intake']

    while (queue.length > 0) {
      const current = queue.shift()
      if (current === undefined) break
      for (const next of legalTransitionsFrom(current)) {
        if (!seen.has(next)) {
          seen.add(next)
          queue.push(next)
        }
      }
    }

    expect([...seen].sort()).toEqual([...jobStates].sort())
  })

  it('treats archived and cancelled as the only terminal states', () => {
    expect([...terminalJobStates]).toEqual(['archived', 'cancelled'])
  })

  it('accepts legal edges and rejects everything else', () => {
    expect(canTransition('intake', 'queued')).toBe(true)
    // Phase 5: a change request re-queues rather than walking straight back
    // into planning, so the scheduler is what grants the slot.
    expect(canTransition('planReview', 'queued')).toBe(true)
    expect(canTransition('planning', 'queued')).toBe(true)
    expect(canTransition('planReview', 'planning')).toBe(false)
    expect(canTransition('merged', 'archived')).toBe(true)

    expect(canTransition('intake', 'planning')).toBe(false)
    expect(canTransition('archived', 'merged')).toBe(false)
    expect(canTransition('cancelled', 'intake')).toBe(false)
  })

  it('rejects values that are not states at all', () => {
    expect(canTransition('nope', 'queued')).toBe(false)
    expect(canTransition('intake', 'paused')).toBe(false)
    expect(legalTransitionsFrom('nope')).toEqual([])
  })

  it('keeps suspension out of the state union', () => {
    for (const notAState of ['paused', 'interrupted', 'blocked', 'failed']) {
      expect(isJobState(notAState)).toBe(false)
    }
  })
})
