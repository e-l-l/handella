import type {
  CreateJob,
  Job,
  JobState,
  JobSuspension,
  JobTransitionRecord,
  PlanVersion,
} from '@handella/contracts'

import { request } from './client.ts'

export const jobKeys = {
  all: ['jobs'] as const,
  detail: (jobId: string) => ['jobs', jobId] as const,
  planVersions: (jobId: string) => ['jobs', jobId, 'plan-versions'] as const,
  transitions: (jobId: string) => ['jobs', jobId, 'transitions'] as const,
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
