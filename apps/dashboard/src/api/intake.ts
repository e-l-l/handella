import type {
  BaseBranchSuggestions,
  CreateAdhocJob,
  CreateJobFromLinearIssue,
  IntakeIssuePage,
  Job,
  LinearIssueQuery,
  LinearTeamSummary,
  LinearWorkflowStateSummary,
} from '@handella/contracts'

import { request } from './client.ts'

/**
 * The search and filter are part of the key rather than of the component, so
 * react-query caches each distinct list and the debounce in the page decides
 * how often a new one is asked for. The cursor is deliberately not part of it:
 * pages of one filtered list share a key and accumulate under it.
 */
export const intakeKeys = {
  all: ['intake'] as const,
  baseBranches: (repositoryId?: string) =>
    ['intake', 'base-branches', repositoryId ?? null] as const,
  /** Every repository's list, for invalidating them together. */
  baseBranchesAll: ['intake', 'base-branches'] as const,
  issues: (query: LinearIssueQuery) => ['intake', 'issues', query] as const,
  /** Every filtered issue list, for invalidating the lists without the teams. */
  issuesAll: ['intake', 'issues'] as const,
  teams: ['intake', 'teams'] as const,
  teamStates: (teamId: string) =>
    ['intake', 'teams', teamId, 'states'] as const,
}

/**
 * One rule over whatever the query holds rather than a block per field: the
 * page decides which filters are set, and a filter added to the contract
 * should not need a fifth branch here to reach the wire.
 */
const issuesPath = (query: LinearIssueQuery): string => {
  const search = new URLSearchParams(
    Object.entries(query).flatMap(([key, value]) =>
      value === undefined || value === '' ? [] : [[key, String(value)]],
    ),
  ).toString()
  return search === ''
    ? '/api/intake/linear/issues'
    : `/api/intake/linear/issues?${search}`
}

export const fetchIntakeIssues = async (
  query: LinearIssueQuery,
): Promise<IntakeIssuePage> => request(issuesPath(query))

export const fetchLinearTeams = async (): Promise<LinearTeamSummary[]> =>
  request('/api/intake/linear/teams')

export const fetchLinearTeamWorkflowStates = async (
  teamId: string,
): Promise<LinearWorkflowStateSummary[]> =>
  request(`/api/intake/linear/teams/${encodeURIComponent(teamId)}/states`)

/**
 * Answers from the remote once a repository is chosen, and from this
 * installation's own history until then — so the field still helps on the way
 * to choosing one.
 */
export const fetchBaseBranches = async (
  repositoryId?: string,
): Promise<BaseBranchSuggestions> =>
  request(
    repositoryId === undefined
      ? '/api/intake/base-branches'
      : `/api/intake/base-branches?repositoryId=${encodeURIComponent(repositoryId)}`,
  )

export const createJobFromLinearIssue = async (
  body: CreateJobFromLinearIssue,
): Promise<Job> => request('/api/intake/linear', { body, method: 'POST' })

export const createAdhocJob = async (body: CreateAdhocJob): Promise<Job> =>
  request('/api/intake/adhoc', { body, method: 'POST' })
