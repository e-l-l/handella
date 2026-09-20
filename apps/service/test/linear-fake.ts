import type {
  LinearIssueSummary,
  LinearTeamSummary,
  LinearWorkflowStateSummary,
} from '@handella/contracts'

import type {
  CreateLinearIssueInput,
  LinearAdapter,
  ListAssignedIssuesInput,
} from '../src/adapters/linear.js'

export const aLinearIssue = (
  overrides: Partial<LinearIssueSummary> = {},
): LinearIssueSummary => ({
  id: 'b2b9e5a6-0f1e-4c6b-9a3f-2b1c4d5e6f70',
  identifier: 'ENG-412',
  title: 'Fix the flaky login test',
  description: null,
  priority: 2,
  url: 'https://linear.app/acme/issue/ENG-412',
  branchName: 'ell/eng-412-fix-flaky-login-test',
  stateName: 'In Progress',
  stateType: 'started',
  updatedAt: '2026-09-18T10:00:00.000Z',
  ...overrides,
})

/**
 * The subset of an issue the store is linked to. Derived from `aLinearIssue`
 * rather than spelled out again, so a fixture cannot describe an issue Linear
 * would never have produced.
 */
export const aLinearIssueLink = (
  overrides: Partial<LinearIssueSummary> = {},
) => {
  const { branchName, id, identifier, title, url } = aLinearIssue(overrides)
  return { branchName, id, identifier, title, url }
}

export const aLinearTeam = (
  overrides: Partial<LinearTeamSummary> = {},
): LinearTeamSummary => ({
  id: 'e3f4a5b6-7c8d-49e0-b1f2-3a4b5c6d7e8f',
  key: 'ENG',
  name: 'Engineering',
  ...overrides,
})

export const aLinearWorkflowState = (
  overrides: Partial<LinearWorkflowStateSummary> = {},
): LinearWorkflowStateSummary => ({
  id: 'c1d2e3f4-5a6b-47c8-9d0e-1f2a3b4c5d6e',
  name: 'In Review',
  type: 'started',
  ...overrides,
})

export interface FakeLinearAdapter extends LinearAdapter {
  /**
   * The issues this Linear holds, mutable so a test can add one after the
   * adapter is built. Dispatch and planning both read an issue back, and they
   * have to be reading the same Linear the test set up.
   */
  readonly issues: LinearIssueSummary[]
  /** Every call the routes made, so a test can assert what was passed through. */
  readonly listCalls: ListAssignedIssuesInput[]
  readonly createCalls: CreateLinearIssueInput[]
  /** Team ids the routes asked for states of. */
  readonly stateCalls: string[]
}

interface FakeLinearAdapterOptions {
  /** Thrown by every method, for the failure paths. */
  failWith?: unknown
  issues?: LinearIssueSummary[]
  nextCursor?: string | null
  states?: LinearWorkflowStateSummary[]
  teams?: LinearTeamSummary[]
}

/**
 * Implements the port directly, with no SDK involvement at all: route and store
 * tests care about what intake does with an issue, not about how it was
 * fetched. `linear-adapter.test.ts` is where the SDK mapping is exercised.
 */
export function createFakeLinearAdapter(
  options: FakeLinearAdapterOptions = {},
): FakeLinearAdapter {
  const issues = options.issues ?? [aLinearIssue()]
  const teams = options.teams ?? [aLinearTeam()]
  const states = options.states ?? [aLinearWorkflowState()]
  const listCalls: ListAssignedIssuesInput[] = []
  const createCalls: CreateLinearIssueInput[] = []
  const stateCalls: string[] = []

  const refuse = async <Result>(): Promise<Result> => {
    throw options.failWith
  }

  return {
    configured: true,
    issues,
    listCalls,
    createCalls,
    stateCalls,

    async listAssignedActionableIssues(input) {
      listCalls.push(input)
      if (options.failWith !== undefined) return refuse()
      return { issues, nextCursor: options.nextCursor ?? null }
    },

    async getIssue(issueId) {
      if (options.failWith !== undefined) return refuse()
      const issue = issues.find((candidate) => candidate.id === issueId)
      if (issue === undefined) {
        throw new Error(`The fake has no issue ${issueId}`)
      }
      return issue
    },

    async createIssue(input) {
      createCalls.push(input)
      if (options.failWith !== undefined) return refuse()
      return aLinearIssue({
        id: `created-${createCalls.length}`,
        identifier: `ENG-90${createCalls.length}`,
        title: input.title,
        description: input.description ?? null,
        priority: input.priority ?? 0,
        branchName: `ell/eng-90${createCalls.length}-${input.title
          .toLowerCase()
          .replaceAll(' ', '-')}`,
      })
    },

    async listTeams() {
      if (options.failWith !== undefined) return refuse()
      return teams
    },

    async listTeamWorkflowStates(teamId) {
      stateCalls.push(teamId)
      if (options.failWith !== undefined) return refuse()
      return states
    },
  }
}
