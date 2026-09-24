import { describe, expect, it } from 'vitest'

import { isQueued, isRunning, maxConcurrency, orderQueue } from './jobViews.ts'
import { aJob } from './test/fixtures.ts'

describe('the jobs holding a Codex slot', () => {
  it('counts a job with a Handella pass behind it, planning or implementing', () => {
    expect(isRunning(aJob({ codexPass: 'plan', state: 'planning' }))).toBe(true)
    expect(
      isRunning(aJob({ codexPass: 'implement', state: 'implementing' })),
    ).toBe(true)
  })

  it('does not count a job the Handler is driving from their terminal', () => {
    // Implementing, and nothing of Handella's is running in it: the slot is a
    // fact about a pass, not about the state (ADR 0015).
    expect(isRunning(aJob({ state: 'implementing' }))).toBe(false)
    expect(isRunning(aJob({ state: 'queued' }))).toBe(false)
    expect(isRunning(aJob({ state: 'prOpen' }))).toBe(false)
  })

  it('frees the slot of a suspended job, whose pass is aborted', () => {
    expect(
      isRunning(
        aJob({
          codexPass: 'implement',
          state: 'implementing',
          suspension: 'interrupted',
        }),
      ),
    ).toBe(false)
  })

  it('holds the masterplan ceiling of three', () => {
    expect(maxConcurrency).toBe(3)
  })
})

describe('the jobs waiting for a slot', () => {
  it('is the queued ones, which only Dispatch puts there', () => {
    expect(isQueued(aJob({ state: 'queued' }))).toBe(true)
  })

  it('leaves out a job still in intake, which holds no position', () => {
    // Intake commits the Job record and nothing else, so a job that has not
    // been dispatched is not waiting for a turn it has not asked for.
    expect(isQueued(aJob({ state: 'intake' }))).toBe(false)
  })

  it('leaves out a suspended job, which the scheduler would skip', () => {
    // ADR 0003: the scheduler asks `suspension IS NULL`, so a stopped job
    // shown holding a position would promise a turn it will not get.
    expect(
      isQueued(aJob({ state: 'queued', suspension: 'stoppedByHandler' })),
    ).toBe(false)
  })
})

describe('queue order', () => {
  const at = (createdAt: string, queuePriority: number | null) =>
    aJob({ createdAt, queuePriority, state: 'queued' })

  it('reads the priority the Handler set before arrival', () => {
    const ordered = orderQueue([
      at('2026-09-18T10:00:00.000Z', 3),
      at('2026-09-18T11:00:00.000Z', 1),
    ])

    expect(ordered.map((job) => job.queuePriority)).toEqual([1, 3])
  })

  it('falls back to arrival when two jobs share a priority', () => {
    const ordered = orderQueue([
      at('2026-09-18T11:00:00.000Z', 2),
      at('2026-09-18T10:00:00.000Z', 2),
    ])

    expect(ordered.map((job) => job.createdAt)).toEqual([
      '2026-09-18T10:00:00.000Z',
      '2026-09-18T11:00:00.000Z',
    ])
  })

  it('sorts an unordered job last, so it never jumps an ordered one', () => {
    const ordered = orderQueue([
      at('2026-09-18T09:00:00.000Z', null),
      at('2026-09-18T10:00:00.000Z', 9),
    ])

    expect(ordered.map((job) => job.queuePriority)).toEqual([9, null])
  })

  it('leaves the list it was given alone', () => {
    const jobs = [
      at('2026-09-18T11:00:00.000Z', 2),
      at('2026-09-18T10:00:00.000Z', 1),
    ]
    orderQueue(jobs)

    expect(jobs.map((job) => job.queuePriority)).toEqual([2, 1])
  })
})
