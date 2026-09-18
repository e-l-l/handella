import { useQuery } from '@tanstack/react-query'

import { fetchJobs, jobKeys } from '../api/jobs.ts'

/**
 * Every job the service knows, which three screens and the nav all read. The
 * key and the fetcher are paired here rather than at each caller, so a change
 * to either — or to how long the list may be served stale — is one edit.
 */
export const useJobs = () =>
  useQuery({ queryKey: jobKeys.all, queryFn: fetchJobs })
