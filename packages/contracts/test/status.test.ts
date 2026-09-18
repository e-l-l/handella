import { Value } from 'typebox/value'
import { describe, expect, it } from 'vitest'

import { StatusErrorSchema, StatusResponseSchema } from '../src/index.js'

const validStatus = {
  status: 'ok',
  version: '0.1.0',
  startedAt: '2026-09-18T10:00:00.000Z',
  uptimeSeconds: 12,
  installation: {
    id: '123e4567-e89b-42d3-a456-426614174000',
    createdAt: '2026-09-18T09:00:00.000Z',
    lastStartedAt: '2026-09-18T10:00:00.000Z',
  },
  integrations: { linear: { configured: false } },
  database: { status: 'ok', journalMode: 'wal' },
}

describe('status contracts', () => {
  it('accepts a complete system status', () => {
    expect(Value.Check(StatusResponseSchema, validStatus)).toBe(true)
  })

  it('rejects malformed status data', () => {
    expect(
      Value.Check(StatusResponseSchema, {
        ...validStatus,
        uptimeSeconds: -1,
      }),
    ).toBe(false)
  })

  it('rejects a status that forgets to report an integration', () => {
    const withoutIntegrations: Record<string, unknown> = { ...validStatus }
    delete withoutIntegrations.integrations

    expect(Value.Check(StatusResponseSchema, withoutIntegrations)).toBe(false)
  })

  it('accepts the public unavailable response', () => {
    expect(
      Value.Check(StatusErrorSchema, {
        status: 'error',
        code: 'database_unavailable',
        message: 'Database unavailable',
      }),
    ).toBe(true)
  })
})
