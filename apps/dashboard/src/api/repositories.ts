import type {
  CreateRepository,
  Repository,
  UpdateRepository,
} from '@handella/contracts'

import { request } from './client.ts'

export const repositoryKeys = {
  all: ['repositories'] as const,
}

export const fetchRepositories = async (): Promise<Repository[]> =>
  request('/api/repositories')

export const createRepository = async (
  body: CreateRepository,
): Promise<Repository> => request('/api/repositories', { body, method: 'POST' })

export const updateRepository = async (
  repositoryId: string,
  body: UpdateRepository,
): Promise<Repository> =>
  request(`/api/repositories/${encodeURIComponent(repositoryId)}`, {
    body,
    method: 'PATCH',
  })

export const deleteRepository = async (repositoryId: string): Promise<void> =>
  request(`/api/repositories/${encodeURIComponent(repositoryId)}`, {
    method: 'DELETE',
  })
