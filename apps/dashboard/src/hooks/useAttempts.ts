import { useQuery } from '@tanstack/react-query'

import { fetchAttempts, fetchMilestones, jobKeys } from '../api/jobs.ts'

/**
 * A job's implementation turns and their beats. Paired with their keys here
 * rather than at each caller, for the reason `useJobs` gives: the job page and
 * the inbox both read them, and how long either may be served stale is one
 * edit.
 *
 * `enabled` because only an implementing job has any, and the inbox asks about
 * jobs that are not.
 */
export const useAttempts = (jobId: string, enabled: boolean) =>
  useQuery({
    queryKey: jobKeys.attempts(jobId),
    queryFn: () => fetchAttempts(jobId),
    enabled,
  })

export const useMilestones = (jobId: string, enabled: boolean) =>
  useQuery({
    queryKey: jobKeys.milestones(jobId),
    queryFn: () => fetchMilestones(jobId),
    enabled,
  })
