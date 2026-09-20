import { describe, expect, it } from 'vitest'

import { createRedactor } from '../src/domain/redact.js'

describe('redaction', () => {
  it('leaves text alone when nothing is configured', () => {
    expect(createRedactor([])('lin_api_9f2c')).toBe('lin_api_9f2c')
  })

  it('replaces every occurrence, wherever it appears', () => {
    const redact = createRedactor(['lin_api_9f2c4d6e'])
    expect(redact('auth lin_api_9f2c4d6e then lin_api_9f2c4d6e again')).toBe(
      'auth [redacted] then [redacted] again',
    )
  })

  it('replaces the longer secret first when one contains another', () => {
    // Shortest-first would replace the inner value and leave the rest of the
    // longer one in the clear, which is worse than not redacting at all.
    const redact = createRedactor(['api_9f2c', 'lin_api_9f2c4d6e'])
    expect(redact('token lin_api_9f2c4d6e')).toBe('token [redacted]')
  })

  it('ignores an empty value rather than redacting every character', () => {
    expect(createRedactor([''])('anything at all')).toBe('anything at all')
  })
})
