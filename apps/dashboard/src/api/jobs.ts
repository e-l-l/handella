import type {
  Attempt,
  CreateJob,
  Job,
  JobState,
  JobSuspension,
  JobTransitionRecord,
  Milestone,
  PlanVersion,
} from '@handella/contracts'

import { useQueryClient } from '@tanstack/react-query'

import { attentionKeys } from './attention.ts'
import { messageOf, request, requestText } from './client.ts'

export const jobKeys = {
  all: ['jobs'] as const,
  /**
   * Outside the `jobs` prefix on purpose: every `job.changed` invalidates that
   * prefix, and an open log is a quarter of a megabyte by default — the whole
   * file once the Handler has asked for all of it. `staleTime` does not stop
   * an invalidation refetching an active query; a different prefix does.
   */
  attemptLog: (jobId: string, attemptId: string, full: boolean) =>
    ['attempt-logs', jobId, attemptId, full] as const,
  attempts: (jobId: string) => ['jobs', jobId, 'attempts'] as const,
  detail: (jobId: string) => ['jobs', jobId] as const,
  /**
   * Every attempt's milestones under one key. A running job invalidates this
   * once a second, so it is deliberately the narrowest thing that changes that
   * often — narrower than `jobKeys.all`, which would refetch the job list for a
   * job nobody is looking at.
   */
  milestones: (jobId: string) => ['jobs', jobId, 'milestones'] as const,
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

export const fetchAttempts = async (jobId: string): Promise<Attempt[]> =>
  request(`/api/jobs/${jobId}/attempts`)

export const fetchMilestones = async (jobId: string): Promise<Milestone[]> =>
  request(`/api/jobs/${jobId}/milestones`)

export const fetchAttemptLog = async (
  jobId: string,
  attemptId: string,
  options: { full?: boolean } = {},
): Promise<{ text: string; truncated: boolean }> =>
  requestText(
    `/api/jobs/${jobId}/attempts/${attemptId}/log${options.full === true ? '?full=true' : ''}`,
  )

export const createJob = async (body: CreateJob): Promise<Job> =>
  request('/api/jobs', { body, method: 'POST' })

/**
 * `expectedState` is the state the move was decided from. A row can be a poll
 * behind the service, and a move legal from both the stale and the fresh
 * state would otherwise apply to a job the Handler never saw.
 */
export const transitionJob = async (
  jobId: string,
  to: JobState,
  expectedState: JobState,
): Promise<Job> =>
  request(`/api/jobs/${jobId}/transitions`, {
    body: { expectedState, to },
    method: 'POST',
  })

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

/**
 * Asks now rather than waiting for Reconciliation's timer. Answers with the
 * Job either way: a pull request nobody has merged yet comes back unchanged,
 * which is an answer and not a refusal.
 */
export const checkJobMerge = async (jobId: string): Promise<Job> =>
  request(`/api/jobs/${jobId}/check-merge`, { method: 'POST' })

/**
 * Dispatch, answered with why it was refused rather than by throwing. `null`
 * is the queue; a string is the service's own sentence about why not.
 *
 * Shared by every caller that dispatches straight after creating something:
 * the record it just made has committed by then, so a refusal here is a job
 * to be dispatched again rather than a submission that never happened, and
 * one of these call sites reporting it as the latter is the drift this
 * exists to stop.
 */
export const dispatchOrReason = async (
  jobId: string,
): Promise<string | null> => {
  try {
    await dispatchJob(jobId)
    return null
  } catch (error) {
    return messageOf(error, 'That job could not be dispatched.')
  }
}

/**
 * Opens a terminal on the machine the service is running on: the job's Codex
 * session if it has one, and otherwise a shell in its worktree. 204 and
 * nothing back — what it produces is a window, and the only thing it can tell
 * the dashboard is that there was no window to open.
 */
export const openJobTerminal = async (jobId: string): Promise<void> =>
  request(`/api/jobs/${jobId}/terminal`, {
    fallbackMessage: 'No terminal could be opened for that job.',
    method: 'POST',
  })

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
