import type { StatusResponse } from '@handella/contracts'

import { request } from './client.ts'

/** One key for the one status read, so two pages share a cache entry rather than a literal. */
export const statusKeys = {
  current: ['system-status'] as const,
}

export const fetchSystemStatus = async (): Promise<StatusResponse> =>
  request('/api/status', {
    fallbackMessage: 'The local service did not return a healthy status.',
  })
