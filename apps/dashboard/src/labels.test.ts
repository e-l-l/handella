import { describe, expect, it } from 'vitest'

import { formatAge, issueKeyLabel } from './labels.ts'

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
