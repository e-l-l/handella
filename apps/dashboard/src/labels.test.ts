import { describe, expect, it } from 'vitest'

import { elidePath, formatAge, formatUptime, issueKeyLabel } from './labels.ts'

describe('the compact age beside a title', () => {
  const now = new Date('2026-09-18T12:00:00.000Z').getTime()
  const ago = (minutes: number) =>
    formatAge(new Date(now - minutes * 60_000).toISOString(), now)

  it('says now rather than counting a zero', () => {
    expect(ago(0)).toBe('now')
    expect(ago(0.5)).toBe('now')
  })

  it('counts minutes up to the hour', () => {
    expect(ago(18)).toBe('18m')
    expect(ago(59)).toBe('59m')
  })

  it('counts hours up to the day', () => {
    expect(ago(60)).toBe('1h')
    expect(ago(5 * 60)).toBe('5h')
    expect(ago(23 * 60 + 59)).toBe('23h')
  })

  it('counts days once a day has passed, rather than running on in hours', () => {
    // 30 hours is yesterday, and the Handler should not have to divide it.
    expect(ago(24 * 60)).toBe('1d')
    expect(ago(30 * 60)).toBe('1d')
    expect(ago(4 * 24 * 60)).toBe('4d')
  })
})

describe('how a job is named in a list', () => {
  it('uses the Linear issue key when the job has one', () => {
    expect(issueKeyLabel({ linearIssueKey: 'HAN-12' })).toBe('HAN-12')
  })

  it('names a job with no issue rather than leaving a gap', () => {
    expect(issueKeyLabel({ linearIssueKey: null })).toBe('ad hoc')
  })

  it('says the same for a job that has not loaded yet', () => {
    // The inbox holds an item whose job may not be in the list it has.
    expect(issueKeyLabel(undefined)).toBe('ad hoc')
  })
})

describe('how long the service has been up', () => {
  it('shows seconds only while there is nothing longer to say', () => {
    expect(formatUptime(42)).toBe('42s')
    expect(formatUptime(125)).toBe('2m')
    expect(formatUptime(3661)).toBe('1h')
    expect(formatUptime(90_000)).toBe('1d 1h')
  })

  it('reads a missing or negative number as just started', () => {
    expect(formatUptime(-5)).toBe('0s')
    expect(formatUptime(Number.NaN)).toBe('0s')
  })
})

describe('a path elided to the width it is shown at', () => {
  it('leaves a path that fits alone', () => {
    expect(elidePath('/tmp/worktree')).toBe('/tmp/worktree')
  })

  it('keeps the end, counting the ellipsis in the width', () => {
    const elided = elidePath('/Users/handler/.data/worktrees/repo/eng-412', 12)
    expect(elided).toBe('…epo/eng-412')
    expect(elided).toHaveLength(12)
  })

  it('never grows a path for a width of nothing', () => {
    expect(elidePath('/tmp/worktree', 0)).toBe('…e')
  })
})
