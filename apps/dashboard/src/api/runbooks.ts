import type { RunbookVersion } from '@handella/contracts'

import { request } from './client.ts'

export const runbookKeys = {
  all: ['runbook-versions'] as const,
}

export const fetchRunbookVersions = async (): Promise<RunbookVersion[]> =>
  request('/api/runbook-versions')

/** Saving is always a new version; nothing edits one in place. */
export const createRunbookVersion = async (
  content: string,
): Promise<RunbookVersion> =>
  request('/api/runbook-versions', { body: { content }, method: 'POST' })
