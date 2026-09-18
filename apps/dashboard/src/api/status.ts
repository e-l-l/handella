import type { StatusResponse } from '@handella/contracts'

import { request } from './client.ts'

export const fetchSystemStatus = async (): Promise<StatusResponse> =>
  request('/api/status', {
    fallbackMessage: 'The local service did not return a healthy status.',
  })
