import type { AttentionItem } from '@handella/contracts'

import { request } from './client.ts'

export const attentionKeys = { all: ['attention'] as const }

export const fetchAttentionItems = async (): Promise<AttentionItem[]> =>
  request('/api/attention')

export const resolveAttentionItem = async (
  attentionItemId: string,
): Promise<AttentionItem> =>
  request(`/api/attention/${attentionItemId}/resolve`, { method: 'POST' })
