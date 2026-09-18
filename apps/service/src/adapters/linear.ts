import type {
  LinearIssuePage,
  LinearIssueSummary,
  LinearTeamSummary,
  LinearWorkflowStateSummary,
} from '@handella/contracts'

import { linearNotConfigured } from '../domain/errors.js'

/**
 * `stateId` narrows to one team's state, so it arrives with the `teamId` the
 * Handler picked it from. Neither is trusted to be actionable: the
 * implementation keeps its own category filter underneath both.
 */
export interface ListAssignedIssuesInput {
  cursor?: string | undefined
  limit: number
  search?: string | undefined
  stateId?: string | undefined
  teamId?: string | undefined
}

export interface CreateLinearIssueInput {
  description?: string | undefined
  priority?: number | undefined
  teamId: string
  title: string
}

/**
 * The one place Handella talks to Linear. Everything above it deals in
 * contracts records and `DomainError`s, which is what lets the deterministic
 * fake the masterplan asks for stand in without a network.
 *
 * Deliberately imports nothing from `@linear/sdk`, so a test that fakes this
 * port never loads the SDK at all.
 */
export interface LinearAdapter {
  /** Whether the Handler has supplied a key, so status can say so without provoking a failure. */
  readonly configured: boolean
  createIssue(input: CreateLinearIssueInput): Promise<LinearIssueSummary>
  getIssue(issueId: string): Promise<LinearIssueSummary>
  listAssignedActionableIssues(
    input: ListAssignedIssuesInput,
  ): Promise<LinearIssuePage>
  listTeams(): Promise<LinearTeamSummary[]>
  /** The actionable states one team defines, in Linear's own order. */
  listTeamWorkflowStates(teamId: string): Promise<LinearWorkflowStateSummary[]>
}

/**
 * What a Handler who has not configured a key gets. A null object rather than
 * an absent adapter, so no route and no test carries an "is Linear set up"
 * branch: there is one code path, and it ends in a typed error the dashboard
 * turns into a setup notice.
 */
export const unconfiguredLinearAdapter: LinearAdapter = {
  configured: false,
  createIssue: () => Promise.reject(linearNotConfigured()),
  getIssue: () => Promise.reject(linearNotConfigured()),
  listAssignedActionableIssues: () => Promise.reject(linearNotConfigured()),
  listTeams: () => Promise.reject(linearNotConfigured()),
  listTeamWorkflowStates: () => Promise.reject(linearNotConfigured()),
}
