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

import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query'

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

/**
 * How long each of Linear's answers is worth keeping, beside the keys they are
 * kept under. These are the only queries in the dashboard that leave the
 * machine, and the issue list is the expensive one: the local service resolves
 * Linear's lazy workflow state per issue, so one page of it is a round trip
 * per issue plus one. The rest of the application keeps the client-wide
 * default from main.tsx, which suits reads the local service answers out of
 * SQLite and the event stream keeps honest.
 */
const linearListCache = { gcTime: 60 * 60_000, staleTime: 2 * 60_000 }

/**
 * Linear's own configuration rather than the Handler's work. Teams and their
 * workflow states do change, but on the scale of someone editing a workflow
 * rather than of a list going stale, so they are held for half an hour and
 * Intake's Refresh is what asks for them sooner. Never expiring would leave a
 * newly added state invisible until the page was reloaded.
 */
const linearConfigCache = { gcTime: 60 * 60_000, staleTime: 30 * 60_000 }

/**
 * Linear pages its issues, so this does too: the cursor the service reported
 * is what asks for the next page, and pages accumulate under the key for these
 * filters rather than replacing each other.
 */
export const issuesOptions = (query: LinearIssueQuery) =>
  infiniteQueryOptions({
    ...linearListCache,
    queryKey: intakeKeys.issues(query),
    queryFn: ({ pageParam }) =>
      fetchIntakeIssues({
        ...query,
        ...(pageParam === undefined ? {} : { cursor: pageParam }),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  })

export const teamsOptions = queryOptions({
  ...linearConfigCache,
  queryKey: intakeKeys.teams,
  queryFn: fetchLinearTeams,
})

export const teamStatesOptions = (teamId: string) =>
  queryOptions({
    ...linearConfigCache,
    queryKey: intakeKeys.teamStates(teamId),
    queryFn: () => fetchLinearTeamWorkflowStates(teamId),
  })

/**
 * Cheaper than the Linear queries but not free: a chosen repository sends the
 * local service to `git for-each-ref` in that checkout. Kept for less time
 * than Linear's answers because the branches it reports are the Handler's own
 * and move while they work.
 */
const gitListCache = { gcTime: 60 * 60_000, staleTime: 5 * 60_000 }

export const baseBranchesOptions = (repositoryId?: string) =>
  queryOptions({
    ...gitListCache,
    queryKey: intakeKeys.baseBranches(repositoryId),
    queryFn: () => fetchBaseBranches(repositoryId),
  })
