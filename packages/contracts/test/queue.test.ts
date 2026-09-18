import { describe, expect, it } from 'vitest'

import {
  availableSlots,
  isQueued,
  isRunning,
  maxConcurrency,
  orderQueue,
  type Job,
  type JobState,
  type JobSuspension,
} from '../src/index.js'

const baseJob: Job = {
  id: '123e4567-e89b-42d3-a456-426614174000',
  source: 'linear',
  title: 'Fix the flaky login test',
  workClass: 'routine',
  state: 'queued',
  suspension: null,
  linearIssueKey: 'ENG-412',
  linearIssueId: 'b2b9e5a6-0f1e-4c6b-9a3f-2b1c4d5e6f70',
  linearIssueUrl: 'https://linear.app/acme/issue/ENG-412',
  canonicalBranch: 'ell/eng-412-fix-flaky-login-test',
  baseBranch: 'dev',
  queuePriority: null,
  worktreePath: null,
  codexSessionId: null,
  originalPrUrl: null,
  createdAt: '2026-09-18T10:00:00.000Z',
  updatedAt: '2026-09-18T10:00:00.000Z',
}

const aJob = (overrides: Partial<Job> & { id: string }): Job => ({
  ...baseJob,
  ...overrides,
})

const inState = (
  id: string,
  state: JobState,
  suspension: JobSuspension | null = null,
): Job => aJob({ id, state, suspension })

describe('slot accounting', () => {
  it('counts planning and implementing as holding a slot', () => {
    expect(isRunning(inState('a', 'planning'))).toBe(true)
    expect(isRunning(inState('b', 'implementing'))).toBe(true)
  })

  it('does not count a job that has not started or has finished', () => {
    for (const state of [
      'intake',
      'queued',
      'planReview',
      'approved',
      'prOpen',
      'merged',
    ] as const) {
      expect(isRunning(inState('a', state))).toBe(false)
    }
  })

  it('frees the slot of a suspended job, because nothing is working in its worktree', () => {
    expect(isRunning(inState('a', 'planning', 'stoppedByHandler'))).toBe(false)
    expect(isRunning(inState('a', 'implementing', 'interrupted'))).toBe(false)
  })

  it('offers three slots when nothing is running and none when three are', () => {
    expect(availableSlots([])).toBe(maxConcurrency)
    expect(
      availableSlots([
        inState('a', 'planning'),
        inState('b', 'planning'),
        inState('c', 'implementing'),
      ]),
    ).toBe(0)
  })

  it('never reports a negative number of slots', () => {
    const running = Array.from({ length: maxConcurrency + 2 }, (_, index) =>
      inState(String(index), 'implementing'),
    )
    expect(availableSlots(running)).toBe(0)
  })
})

describe('queue membership', () => {
  it('holds a position only while queued and unsuspended', () => {
    expect(isQueued(inState('a', 'queued'))).toBe(true)
    expect(isQueued(inState('a', 'intake'))).toBe(false)
    expect(isQueued(inState('a', 'queued', 'stoppedByHandler'))).toBe(false)
  })
})

describe('queue order', () => {
  it('reads the Handler ordering before arrival order', () => {
    const ordered = orderQueue([
      aJob({ id: 'second', queuePriority: 2 }),
      aJob({ id: 'first', queuePriority: 1 }),
    ])
    expect(ordered.map((job) => job.id)).toEqual(['first', 'second'])
  })

  it('falls back to arrival order when nothing was reordered', () => {
    const ordered = orderQueue([
      aJob({ id: 'later', createdAt: '2026-09-18T12:00:00.000Z' }),
      aJob({ id: 'earlier', createdAt: '2026-09-18T09:00:00.000Z' }),
    ])
    expect(ordered.map((job) => job.id)).toEqual(['earlier', 'later'])
  })

  it('falls back to arrival when two jobs share a priority', () => {
    const ordered = orderQueue([
      aJob({
        id: 'later',
        queuePriority: 2,
        createdAt: '2026-09-18T11:00:00.000Z',
      }),
      aJob({
        id: 'earlier',
        queuePriority: 2,
        createdAt: '2026-09-18T10:00:00.000Z',
      }),
    ])
    expect(ordered.map((job) => job.id)).toEqual(['earlier', 'later'])
  })

  it('sorts an unordered job after an ordered one, never before it', () => {
    const ordered = orderQueue([
      aJob({ id: 'unordered', createdAt: '2026-09-18T01:00:00.000Z' }),
      aJob({
        id: 'ordered',
        queuePriority: 9,
        createdAt: '2026-09-18T23:00:00.000Z',
      }),
    ])
    expect(ordered.map((job) => job.id)).toEqual(['ordered', 'unordered'])
  })

  it('leaves the array it was given alone', () => {
    const input = [
      aJob({ id: 'b', queuePriority: 2 }),
      aJob({ id: 'a', queuePriority: 1 }),
    ]
    orderQueue(input)
    expect(input.map((job) => job.id)).toEqual(['b', 'a'])
  })
})
