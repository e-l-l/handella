import { queryOptions } from '@tanstack/react-query'

import type {
  ChosenFolder,
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

/**
 * The checkouts, beside their key, on the same terms as the intake queries:
 * one description of this list rather than one per screen that reads it.
 */
export const repositoriesOptions = queryOptions({
  queryKey: repositoryKeys.all,
  queryFn: fetchRepositories,
})

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

/**
 * Opens the native dialog on the machine the service runs on and answers with
 * what was chosen. The browser cannot do this itself — it is never told the
 * absolute path of a folder someone picks. `path` is null if they cancelled.
 */
export const chooseRepositoryPath = async (): Promise<ChosenFolder> =>
  request('/api/repositories/choose-path', { method: 'POST' })

export const deleteRepository = async (repositoryId: string): Promise<void> =>
  request(`/api/repositories/${encodeURIComponent(repositoryId)}`, {
    method: 'DELETE',
  })
