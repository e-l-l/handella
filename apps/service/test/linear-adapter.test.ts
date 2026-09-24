import type { LinearClient } from '@linear/sdk'
import { LinearError, LinearErrorType } from '@linear/sdk'
import { describe, expect, it } from 'vitest'

import { createLinearAdapter } from '../src/adapters/linear-sdk.js'
import { unconfiguredLinearAdapter } from '../src/adapters/linear.js'

/**
 * Shaped like the parts of `LinearClient` the adapter touches. The SDK's own
 * surface is far too wide to implement, so the cast lives here, at the seam,
 * and the port above it is what the rest of the service depends on.
 */
interface FakeClientOptions {
  createdIssue?: Record<string, unknown>
  createSucceeded?: boolean
  issues?: Record<string, unknown>[]
  pageInfo?: { hasNextPage: boolean; endCursor?: string | null }
  teams?: { id: string; key: string; name: string }[]
  throws?: unknown
  workflowStates?: {
    id: string
    name: string
    position: number
    type: string
  }[]
}

interface Recorded {
  assignedIssues: Record<string, unknown>[]
  createIssue: Record<string, unknown>[]
  workflowStates: Record<string, unknown>[]
}

const anSdkIssue = (overrides: Record<string, unknown> = {}) => ({
  id: 'b2b9e5a6-0f1e-4c6b-9a3f-2b1c4d5e6f70',
  identifier: 'ENG-412',
  title: 'Fix the flaky login test',
  description: 'Fails about one run in five.',
  priority: 2,
  url: 'https://linear.app/acme/issue/ENG-412',
  branchName: 'ell/eng-412-fix-flaky-login-test',
  updatedAt: new Date('2026-09-18T10:00:00.000Z'),
  state: Promise.resolve({ name: 'In Progress', type: 'started' }),
  // A lazy relation, the way the SDK serves it: only the read a job is
  // planned from asks for it.
  attachments: () => Promise.resolve({ nodes: [] }),
  assigneeId: 'viewer-1',
  ...overrides,
})

const createFakeClient = (
  options: FakeClientOptions = {},
): { client: LinearClient; recorded: Recorded } => {
  const recorded: Recorded = {
    assignedIssues: [],
    createIssue: [],
    workflowStates: [],
  }
  const fail = () => {
    throw options.throws
  }

  const client = {
    get viewer() {
      if (options.throws !== undefined) fail()
      return Promise.resolve({
        id: 'viewer-1',
        assignedIssues: (variables: Record<string, unknown>) => {
          recorded.assignedIssues.push(variables)
          if (options.throws !== undefined) fail()
          return Promise.resolve({
            nodes: options.issues ?? [anSdkIssue()],
            pageInfo: options.pageInfo ?? {
              hasNextPage: false,
              endCursor: null,
            },
          })
        },
      })
    },
    issue: (id: string) => {
      if (options.throws !== undefined) fail()
      // Answers from the same set the list does, so a test can describe one
      // awkward issue once and exercise both policies against it.
      const configured = options.issues ?? []
      const match =
        configured.find((candidate) => candidate.id === id) ?? configured[0]
      return Promise.resolve(match ?? anSdkIssue({ id }))
    },
    createIssue: (input: Record<string, unknown>) => {
      recorded.createIssue.push(input)
      if (options.throws !== undefined) fail()
      return Promise.resolve({
        success: options.createSucceeded ?? true,
        issue: Promise.resolve(options.createdIssue ?? anSdkIssue()),
      })
    },
    teams: () => {
      if (options.throws !== undefined) fail()
      return Promise.resolve({
        nodes: options.teams ?? [{ id: 't1', key: 'ENG', name: 'Engineering' }],
      })
    },
    workflowStates: (variables: Record<string, unknown>) => {
      recorded.workflowStates.push(variables)
      if (options.throws !== undefined) fail()
      // Out of order and carrying a finished state by default, because both
      // are what the adapter is here to deal with.
      return Promise.resolve({
        nodes: options.workflowStates ?? [
          { id: 's3', name: 'Done', position: 3, type: 'completed' },
          { id: 's1', name: 'Todo', position: 1, type: 'unstarted' },
          { id: 's2', name: 'In Review', position: 2, type: 'started' },
        ],
      })
    },
  } as unknown as LinearClient

  return { client, recorded }
}

const adapterFor = (options: FakeClientOptions = {}) => {
  const { client, recorded } = createFakeClient(options)
  return {
    adapter: createLinearAdapter({
      apiKey: 'test-key',
      clientFactory: () => client,
    }),
    recorded,
  }
}

const aLinearError = (type: LinearErrorType, status?: number) => {
  const error = new LinearError()
  Object.assign(error, { type, status })
  return error
}

describe('listing assigned actionable issues', () => {
  it('maps an SDK page onto the contract, resolving the lazy state', async () => {
    const { adapter } = adapterFor()

    const page = await adapter.listAssignedActionableIssues({ limit: 25 })

    expect(page.issues).toEqual([
      {
        id: 'b2b9e5a6-0f1e-4c6b-9a3f-2b1c4d5e6f70',
        identifier: 'ENG-412',
        title: 'Fix the flaky login test',
        description: 'Fails about one run in five.',
        priority: 2,
        url: 'https://linear.app/acme/issue/ENG-412',
        branchName: 'ell/eng-412-fix-flaky-login-test',
        stateName: 'In Progress',
        stateType: 'started',
        updatedAt: '2026-09-18T10:00:00.000Z',
        // Not asked for: the list draws none of them, and asking would be a
        // request per issue.
        attachments: null,
      },
    ])
    expect(page.nextCursor).toBeNull()
  })

  it('narrows to one team and one of its states when the Handler filtered', async () => {
    const { adapter, recorded } = adapterFor()

    await adapter.listAssignedActionableIssues({
      limit: 25,
      stateId: 's2',
      teamId: 't1',
    })

    const [variables] = recorded.assignedIssues
    expect(variables?.filter).toMatchObject({
      state: { id: { eq: 's2' } },
      team: { id: { eq: 't1' } },
    })
  })

  it('cannot be asked for finished work, whichever state id it is given', async () => {
    const { adapter, recorded } = adapterFor()

    // The id of a Done state is indistinguishable from any other here, which
    // is the point: the schema cannot refuse it, so the category filter has to
    // survive underneath it.
    await adapter.listAssignedActionableIssues({ limit: 25, stateId: 's3' })

    const [variables] = recorded.assignedIssues
    expect(variables?.filter).toMatchObject({
      state: {
        id: { eq: 's3' },
        type: { nin: ['completed', 'canceled', 'duplicate'] },
      },
    })
  })

  it('searches title and description together', async () => {
    const { adapter, recorded } = adapterFor()

    await adapter.listAssignedActionableIssues({ limit: 25, search: 'login' })

    const [variables] = recorded.assignedIssues
    expect(variables?.filter).toMatchObject({
      or: [
        { title: { containsIgnoreCase: 'login' } },
        { description: { containsIgnoreCase: 'login' } },
      ],
    })
  })

  it('passes the page size and the cursor through', async () => {
    const { adapter, recorded } = adapterFor()

    await adapter.listAssignedActionableIssues({ limit: 10, cursor: 'abc' })

    expect(recorded.assignedIssues[0]).toMatchObject({
      first: 10,
      after: 'abc',
      includeArchived: false,
    })
  })

  it('reports a cursor only when there is another page', async () => {
    const { adapter } = adapterFor({
      pageInfo: { hasNextPage: true, endCursor: 'next-page' },
    })

    const page = await adapter.listAssignedActionableIssues({ limit: 25 })

    expect(page.nextCursor).toBe('next-page')
  })

  it('drops finished work the upstream returned despite the filter', async () => {
    const { adapter } = adapterFor({
      issues: [
        anSdkIssue(),
        anSdkIssue({
          id: 'done',
          identifier: 'ENG-1',
          state: Promise.resolve({ name: 'Done', type: 'completed' }),
        }),
      ],
    })

    const page = await adapter.listAssignedActionableIssues({ limit: 25 })

    expect(page.issues.map((issue) => issue.identifier)).toEqual(['ENG-412'])
  })
})

describe('reading one issue, which a job will be built from', () => {
  it('refuses an issue with no branch name', async () => {
    const { adapter } = adapterFor({ issues: [anSdkIssue({ branchName: '' })] })

    await expect(adapter.getIssue('anything')).rejects.toMatchObject({
      code: 'linear_unavailable',
      statusCode: 502,
    })
  })

  it('refuses a state type Linear has invented since', async () => {
    const { adapter } = adapterFor({
      issues: [
        anSdkIssue({
          state: Promise.resolve({ name: 'Dozing', type: 'dozing' }),
        }),
      ],
    })

    await expect(adapter.getIssue('anything')).rejects.toMatchObject({
      code: 'linear_unavailable',
    })
  })

  it('refuses an issue assigned to someone else', async () => {
    const { adapter } = adapterFor({
      issues: [anSdkIssue({ assigneeId: 'someone-2' })],
    })

    // Intake offers the Handler's own actionable issues; an id typed by hand,
    // or one reassigned since the list was drawn, is not theirs to supervise.
    await expect(adapter.getIssue('anything')).rejects.toMatchObject({
      code: 'linear_issue_not_assigned',
      statusCode: 409,
    })
  })

  it('refuses an issue nobody is assigned to', async () => {
    const { adapter } = adapterFor({
      issues: [anSdkIssue({ assigneeId: undefined })],
    })

    await expect(adapter.getIssue('anything')).rejects.toMatchObject({
      code: 'linear_issue_not_assigned',
    })
  })

  it('returns a duplicate, so the route can say why it cannot be taken', async () => {
    const { adapter } = adapterFor({
      issues: [
        anSdkIssue({
          state: Promise.resolve({ name: 'Duplicate', type: 'duplicate' }),
        }),
      ],
    })

    const issue = await adapter.getIssue('anything')

    expect(issue.stateType).toBe('duplicate')
  })
})

describe('mapping Linear failures', () => {
  const cases = [
    [LinearErrorType.AuthenticationError, 'linear_unauthorized', 502],
    [LinearErrorType.Forbidden, 'linear_unauthorized', 502],
    [LinearErrorType.Ratelimited, 'linear_rate_limited', 429],
    [LinearErrorType.InvalidInput, 'validation_failed', 400],
    [LinearErrorType.UserError, 'validation_failed', 400],
    [LinearErrorType.NetworkError, 'linear_unavailable', 502],
    [LinearErrorType.InternalError, 'linear_unavailable', 502],
  ] as const

  for (const [type, code, statusCode] of cases) {
    it(`turns ${type} into ${code}`, async () => {
      const { adapter } = adapterFor({ throws: aLinearError(type) })

      await expect(adapter.listTeams()).rejects.toMatchObject({
        code,
        statusCode,
      })
    })
  }

  it('falls back to the http status when the type is unrecognised', async () => {
    const { adapter } = adapterFor({
      throws: aLinearError(LinearErrorType.Other, 401),
    })

    await expect(adapter.listTeams()).rejects.toMatchObject({
      code: 'linear_unauthorized',
    })
  })

  it('turns anything that is not a Linear error into an outage', async () => {
    const { adapter } = adapterFor({ throws: new Error('socket hang up') })

    await expect(adapter.listTeams()).rejects.toMatchObject({
      code: 'linear_unavailable',
    })
  })

  it('never lets upstream text reach the message, but keeps it as the cause', async () => {
    const upstream = new Error('workspace acme-secret request 91f2')
    const { adapter } = adapterFor({ throws: upstream })

    await expect(adapter.listTeams()).rejects.toMatchObject({
      message: 'Linear could not be reached',
      cause: upstream,
    })
  })
})

describe("listing a team's workflow states", () => {
  it("answers only actionable states, in the team's own order", async () => {
    const { adapter, recorded } = adapterFor()

    const states = await adapter.listTeamWorkflowStates('t1')

    expect(states).toEqual([
      { id: 's1', name: 'Todo', type: 'unstarted' },
      { id: 's2', name: 'In Review', type: 'started' },
    ])
    const [variables] = recorded.workflowStates
    expect(variables?.filter).toMatchObject({ team: { id: { eq: 't1' } } })
  })
})

describe('creating an issue', () => {
  it('assigns it to the Handler, so a failed insert is recoverable', async () => {
    const { adapter, recorded } = adapterFor()

    await adapter.createIssue({
      teamId: 't1',
      title: 'Fix the flaky login test',
    })

    expect(recorded.createIssue[0]).toMatchObject({
      teamId: 't1',
      title: 'Fix the flaky login test',
      assigneeId: 'viewer-1',
    })
  })

  it('reads the branch name back from Linear rather than guessing it', async () => {
    const { adapter } = adapterFor()

    const issue = await adapter.createIssue({ teamId: 't1', title: 'Anything' })

    expect(issue.branchName).toBe('ell/eng-412-fix-flaky-login-test')
    expect(issue.identifier).toBe('ENG-412')
  })

  it('refuses a payload Linear did not succeed at', async () => {
    const { adapter } = adapterFor({ createSucceeded: false })

    await expect(
      adapter.createIssue({ teamId: 't1', title: 'Anything' }),
    ).rejects.toMatchObject({ code: 'linear_unavailable' })
  })
})

describe('an installation with no API key', () => {
  it('says so without provoking a failure', () => {
    expect(unconfiguredLinearAdapter.configured).toBe(false)
  })

  it('refuses every call with a typed, actionable error', async () => {
    const calls = [
      unconfiguredLinearAdapter.listTeams(),
      unconfiguredLinearAdapter.listTeamWorkflowStates('t1'),
      unconfiguredLinearAdapter.getIssue('anything'),
      unconfiguredLinearAdapter.listAssignedActionableIssues({ limit: 25 }),
      unconfiguredLinearAdapter.createIssue({
        teamId: 't1',
        title: 'Anything',
      }),
    ]

    for (const call of calls) {
      await expect(call).rejects.toMatchObject({
        code: 'linear_not_configured',
        statusCode: 503,
      })
    }
  })
})
