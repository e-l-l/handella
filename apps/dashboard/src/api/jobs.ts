import type {
  CreateJob,
  Job,
  JobState,
  JobSuspension,
  JobTransitionRecord,
  PlanVersion,
} from '@handella/contracts'

import { useQueryClient } from '@tanstack/react-query'

import { attentionKeys } from './attention.ts'
import { request } from './client.ts'

export const jobKeys = {
  all: ['jobs'] as const,
  detail: (jobId: string) => ['jobs', jobId] as const,
  planVersions: (jobId: string) => ['jobs', jobId, 'plan-versions'] as const,
  transitions: (jobId: string) => ['jobs', jobId, 'transitions'] as const,
}

/**
 * What to invalidate after anything that acts on a job. Moving, suspending or
 * answering a plan also opens and resolves attention items, so both caches go
 * stale together and every mutation on a job settles through this.
 */
export const useJobRefresh = (): (() => Promise<void>) => {
  const queryClient = useQueryClient()

  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: jobKeys.all }),
      queryClient.invalidateQueries({ queryKey: attentionKeys.all }),
    ])
  }
}

export const fetchJobs = async (): Promise<Job[]> => request('/api/jobs')

export const fetchJob = async (jobId: string): Promise<Job> =>
  request(`/api/jobs/${jobId}`)

export const fetchJobTransitions = async (
  jobId: string,
): Promise<JobTransitionRecord[]> => request(`/api/jobs/${jobId}/transitions`)

export const fetchPlanVersions = async (
  jobId: string,
): Promise<PlanVersion[]> => request(`/api/jobs/${jobId}/plan-versions`)

export const createJob = async (body: CreateJob): Promise<Job> =>
  request('/api/jobs', { body, method: 'POST' })

export const transitionJob = async (
  jobId: string,
  to: JobState,
): Promise<Job> =>
  request(`/api/jobs/${jobId}/transitions`, { body: { to }, method: 'POST' })

export const suspendJob = async (
  jobId: string,
  suspension: JobSuspension,
): Promise<Job> =>
  request(`/api/jobs/${jobId}/suspension`, {
    body: { suspension },
    method: 'POST',
  })

export const resumeJob = async (jobId: string): Promise<Job> =>
  request(`/api/jobs/${jobId}/suspension`, { method: 'DELETE' })

/**
 * 202, not 200: the claim has committed and the job is queued, but the worktree
 * is still being cut. The path arrives over the event stream.
 */
export const dispatchJob = async (jobId: string): Promise<Job> =>
  request(`/api/jobs/${jobId}/dispatch`, { method: 'POST' })

export const reorderQueue = async (jobIds: string[]): Promise<Job[]> =>
  request('/api/queue/order', { body: { jobIds }, method: 'POST' })

/**
 * The revision is in the path rather than implied, so a page left open while
 * the plan moved on answers the revision it was showing and is told no.
 */
export const approvePlan = async (
  jobId: string,
  planVersionId: string,
): Promise<Job> =>
  request(`/api/jobs/${jobId}/plan-versions/${planVersionId}/approve`, {
    method: 'POST',
  })

export const requestPlanChanges = async (
  jobId: string,
  planVersionId: string,
  feedback: string,
): Promise<Job> =>
  request(`/api/jobs/${jobId}/plan-versions/${planVersionId}/request-changes`, {
    body: { feedback },
    method: 'POST',
  })
