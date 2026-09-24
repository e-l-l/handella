import {
  isActionableLinearWorkflowStateType,
  isLinearPriority,
  isLinearWorkflowStateType,
  linearWorkflowStateTypes,
  type LinearIssuePage,
  type LinearIssueSummary,
  type LinearTeamSummary,
  type LinearWorkflowStateSummary,
} from '@handella/contracts'
import {
  LinearClient,
  LinearError,
  LinearErrorType,
  type Issue,
  type User,
} from '@linear/sdk'

import {
  DomainError,
  linearIssueNotAssigned,
  linearIssueNotFound,
  linearRateLimited,
  linearUnauthorized,
  linearUnavailable,
  validationFailed,
} from '../domain/errors.js'
import type {
  CreateLinearIssueInput,
  LinearAdapter,
  ListAssignedIssuesInput,
} from './linear.js'

interface CreateLinearAdapterOptions {
  apiKey: string
  /** Injected so the mapping can be tested against a deterministic client. */
  clientFactory?: (apiKey: string) => LinearClient
}

/**
 * The SDK does not re-export `IssueFilter`, so it is derived from the method
 * that consumes it. That also keeps this correct if the filter ever gains a
 * field, without a second name to maintain.
 */
type IssueFilter = NonNullable<
  NonNullable<Parameters<User['assignedIssues']>[0]>['filter']
>

/**
 * Derived as the complement of actionable rather than listed, so a category
 * Linear adds is excluded from intake until someone decides it means work.
 * Getting this the wrong way round is how `duplicate` slipped through.
 */
const finishedStateTypes = linearWorkflowStateTypes.filter(
  (type) => !isActionableLinearWorkflowStateType(type),
)

/**
 * Upstream text never reaches the wire, because Linear's messages can carry
 * request and workspace detail. The original travels as `cause`, which
 * `app.ts` logs locally.
 *
 * The `status` fallback is what keeps this correct if a `LinearErrorType`
 * member is ever renamed: the switch is the readable path, not the load-
 * bearing one.
 */
const asDomainError = (error: unknown): DomainError => {
  if (error instanceof DomainError) {
    return error
  }

  if (!(error instanceof LinearError)) {
    return linearUnavailable(error)
  }

  switch (error.type) {
    case LinearErrorType.AuthenticationError:
    case LinearErrorType.Forbidden:
      return linearUnauthorized(error)
    case LinearErrorType.Ratelimited:
      return linearRateLimited(error)
    case LinearErrorType.InvalidInput:
    case LinearErrorType.UserError:
      return validationFailed('Linear rejected those issue details', error)
    default:
      break
  }

  if (error.status === 401 || error.status === 403) {
    return linearUnauthorized(error)
  }
  if (error.status === 429) {
    return linearRateLimited(error)
  }
  return linearUnavailable(error)
}

const guard = async <Result>(work: () => Promise<Result>): Promise<Result> => {
  try {
    return await work()
  } catch (error) {
    throw asDomainError(error)
  }
}

/**
 * Resolves the one lazy relation intake needs, or answers `undefined` when
 * Handella cannot describe what came back. `team` is deliberately left
 * unresolved: `identifier` already carries the team key, and a second lazy
 * field would double the request count for something nothing displays.
 *
 * Returning rather than throwing lets each caller choose its own policy, which
 * is the point: one issue Handella does not understand must not be able to
 * deny the Handler every other issue.
 */
const toIssueSummary = async (
  issue: Issue,
  options: { withAttachments?: boolean } = {},
): Promise<LinearIssueSummary | undefined> => {
  const state = await issue.state

  if (
    state === undefined ||
    !isLinearWorkflowStateType(state.type) ||
    issue.branchName === '' ||
    issue.identifier === ''
  ) {
    return undefined
  }

  // Only where it matters: this is a request per issue, and the only reader is
  // the check for a video the Handler has to hand to Codex themselves.
  const attachments =
    options.withAttachments === true
      ? ((await issue.attachments()).nodes ?? []).map((attachment) => ({
          title: attachment.title === '' ? null : attachment.title,
          url: attachment.url,
        }))
      : null

  return {
    attachments,
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    description: issue.description ?? null,
    priority: isLinearPriority(issue.priority) ? issue.priority : 0,
    url: issue.url,
    branchName: issue.branchName,
    stateName: state.name,
    stateType: state.type,
    updatedAt: issue.updatedAt.toISOString(),
  }
}

export function createLinearAdapter(
  options: CreateLinearAdapterOptions,
): LinearAdapter {
  const build =
    options.clientFactory ?? ((apiKey: string) => new LinearClient({ apiKey }))

  // Built on first use rather than up front, so constructing the adapter never
  // reaches the network and a Handella that never opens intake never talks to
  // Linear at all.
  let client: LinearClient | undefined
  const linear = (): LinearClient => (client ??= build(options.apiKey))

  // The viewer is the identity of a fixed API key, so it cannot change while
  // the process lives; fetching it per call bought a round trip per issue
  // list and per job created. Cached as the promise rather than the value so
  // concurrent callers share one request, and cleared on failure so an outage
  // is never what gets remembered.
  let identity: Promise<User> | undefined
  const viewer = (): Promise<User> =>
    (identity ??= linear().viewer.catch((error: unknown) => {
      identity = undefined
      throw error
    }))

  return {
    configured: true,

    async listAssignedActionableIssues(
      input: ListAssignedIssuesInput,
    ): Promise<LinearIssuePage> {
      return guard(async () => {
        const search = input.search?.trim()

        // The category filter is unconditional, and a chosen state narrows it
        // rather than replacing it. That is what keeps the endpoint unable to
        // list finished work now that the Handler picks an opaque state id:
        // the id of a Done state simply intersects with nothing.
        const filter: IssueFilter = {
          state: {
            type: { nin: [...finishedStateTypes] },
            ...(input.stateId === undefined
              ? {}
              : { id: { eq: input.stateId } }),
          },
          ...(input.teamId === undefined
            ? {}
            : { team: { id: { eq: input.teamId } } }),
          ...(search === undefined || search === ''
            ? {}
            : {
                or: [
                  { title: { containsIgnoreCase: search } },
                  { description: { containsIgnoreCase: search } },
                ],
              }),
        }

        const page = await (
          await viewer()
        ).assignedIssues({
          first: input.limit,
          ...(input.cursor === undefined ? {} : { after: input.cursor }),
          includeArchived: false,
          filter,
        })

        // Called through an arrow rather than passed directly, so `map`'s
        // index cannot arrive where the attachment option goes. The list asks
        // for no attachments: one request per issue for something no row
        // displays would double what drawing the list costs.
        const issues = await Promise.all(
          page.nodes.map((issue) => toIssueSummary(issue)),
        )

        return {
          // The filter is server-side; this is belt and braces, so nothing
          // above the port ever has to wonder whether finished work slipped
          // through. An issue Handella could not describe is dropped by the
          // same rule, because a state type it does not know is not one it can
          // call actionable.
          issues: issues.filter(
            (issue): issue is LinearIssueSummary =>
              issue !== undefined &&
              isActionableLinearWorkflowStateType(issue.stateType),
          ),
          nextCursor: page.pageInfo.hasNextPage
            ? (page.pageInfo.endCursor ?? null)
            : null,
        }
      })
    },

    async getIssue(issueId: string): Promise<LinearIssueSummary> {
      return guard(async () => {
        const issue = await linear().issue(issueId)
        if (issue === undefined || issue === null) {
          throw linearIssueNotFound(issueId)
        }

        // Strict here, unlike the list: this is the read a job is built from,
        // and a job on an issue Handella cannot describe is worse than none.
        const summary = await toIssueSummary(issue, { withAttachments: true })
        if (summary === undefined) {
          throw linearUnavailable(
            new Error(`Linear returned an unusable issue ${issueId}`),
          )
        }

        // CONTEXT.md: an Actionable Issue assigned to the Handler is what
        // Intake offers. The list is filtered by assignee upstream, but this
        // read takes an id, and an issue reassigned since the list was drawn
        // would otherwise become a job on someone else's work.
        // `assigneeId` rather than `assignee`: the latter is a lazy relation
        // that costs a round trip to fetch a user whose id is already in hand.
        if (issue.assigneeId !== (await viewer()).id) {
          throw linearIssueNotAssigned(summary.identifier)
        }

        return summary
      })
    },

    async createIssue(
      input: CreateLinearIssueInput,
    ): Promise<LinearIssueSummary> {
      return guard(async () => {
        // Assigned to the Handler, because they are the one supervising it.
        // It also makes a failed local insert self-healing: the issue simply
        // turns up in intake on the next refresh.
        const payload = await linear().createIssue({
          teamId: input.teamId,
          title: input.title,
          assigneeId: (await viewer()).id,
          ...(input.description === undefined
            ? {}
            : { description: input.description }),
          ...(input.priority === undefined ? {} : { priority: input.priority }),
        })

        const issue = await payload.issue
        if (!payload.success || issue === undefined) {
          throw linearUnavailable(new Error('Linear did not return the issue'))
        }

        // Read back rather than assumed: only Linear can name the canonical
        // branch, and guessing it is how a job ends up on the wrong one.
        const summary = await toIssueSummary(issue)
        if (summary === undefined) {
          throw linearUnavailable(
            new Error('Linear returned an unusable issue after creating it'),
          )
        }
        return summary
      })
    },

    async listTeams(): Promise<LinearTeamSummary[]> {
      return guard(async () => {
        const teams = await linear().teams()
        return teams.nodes.map((team) => ({
          id: team.id,
          key: team.key,
          name: team.name,
        }))
      })
    },

    async listTeamWorkflowStates(
      teamId: string,
    ): Promise<LinearWorkflowStateSummary[]> {
      return guard(async () => {
        // Unpaginated on purpose: a team defines a handful of states, and the
        // default page is far larger than any workflow a team can work in.
        const states = await linear().workflowStates({
          filter: { team: { id: { eq: teamId } } },
        })

        // Linear orders its own state picker by `position`, and a Handler
        // reading this list is reading the same states in the same place.
        return [...states.nodes]
          .sort((left, right) => left.position - right.position)
          .flatMap((state) =>
            isActionableLinearWorkflowStateType(state.type)
              ? [{ id: state.id, name: state.name, type: state.type }]
              : [],
          )
      })
    },
  }
}
