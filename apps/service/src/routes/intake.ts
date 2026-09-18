import {
  ApiErrorSchema,
  BaseBranchSuggestionsSchema,
  CreateAdhocJobSchema,
  CreateJobFromLinearIssueSchema,
  IntakeIssuePageSchema,
  JobSchema,
  LinearIdSchema,
  LinearIssueQuerySchema,
  LinearTeamSummarySchema,
  LinearWorkflowStateSummarySchema,
  canonicalBranchForRound,
  isActionableLinearWorkflowStateType,
} from '@handella/contracts'
import {
  Type,
  type FastifyPluginCallbackTypebox,
} from '@fastify/type-provider-typebox'

import type { GitAdapter } from '../adapters/git.js'
import type { LinearAdapter } from '../adapters/linear.js'
import { linearIssueNotActionable } from '../domain/errors.js'
import type { Store } from '../domain/store.js'

/**
 * Every Linear call can fail in these three ways whatever it was asking for,
 * so the responses are declared once.
 */
const linearErrorResponses = {
  429: ApiErrorSchema,
  502: ApiErrorSchema,
  503: ApiErrorSchema,
}

/**
 * The validator compiler converts query parameters but never applies a schema
 * `default`, so the page size is decided here rather than in the contract.
 */
const defaultIssueLimit = 25

export const intakeRoutes: FastifyPluginCallbackTypebox<{
  git: GitAdapter
  linear: LinearAdapter
  store: Store
}> = (app, options, done) => {
  const { git, linear, store } = options

  // Linear says what the issues are; the local store says what Handella
  // already knows about them. Both halves are answered here, so the dashboard
  // never has to re-derive a job's branch from the job list it happens to hold.
  app.get(
    '/api/intake/linear/issues',
    {
      schema: {
        querystring: LinearIssueQuerySchema,
        response: { 200: IntakeIssuePageSchema, ...linearErrorResponses },
      },
    },
    async (request) => {
      // Forwarded whole rather than field by field: the query schema holds
      // exactly the filters the port takes, and `additionalProperties: false`
      // means nothing else can reach here. A filter added to the schema then
      // reaches the adapter without a third place to remember.
      const page = await linear.listAssignedActionableIssues({
        ...request.query,
        limit: request.query.limit ?? defaultIssueLimit,
      })

      const facts = store.describeIssuesForIntake(
        page.issues.map((issue) => issue.id),
      )

      return {
        issues: page.issues.map((issue) => {
          const known = facts.get(issue.id)
          const round = known?.nextRound ?? 1
          return {
            issue,
            heldByJobId: known?.heldByJobId ?? null,
            plannedBranch: canonicalBranchForRound(issue.branchName, round),
            round,
          }
        }),
        nextCursor: page.nextCursor,
      }
    },
  )

  app.get(
    '/api/intake/linear/teams',
    {
      schema: {
        response: {
          200: Type.Array(LinearTeamSummarySchema),
          ...linearErrorResponses,
        },
      },
    },
    async () => linear.listTeams(),
  )

  app.get(
    '/api/intake/linear/teams/:teamId/states',
    {
      schema: {
        params: Type.Object({ teamId: LinearIdSchema }),
        response: {
          200: Type.Array(LinearWorkflowStateSummarySchema),
          ...linearErrorResponses,
        },
      },
    },
    async (request) => linear.listTeamWorkflowStates(request.params.teamId),
  )

  app.post(
    '/api/intake/linear',
    {
      schema: {
        body: CreateJobFromLinearIssueSchema,
        response: {
          201: JobSchema,
          404: ApiErrorSchema,
          409: ApiErrorSchema,
          ...linearErrorResponses,
        },
      },
    },
    async (request, reply) => {
      // The canonical branch is read from Linear rather than taken from the
      // browser: Linear owns it, and a job on a branch the Handler typed is a
      // job Linear will never link to its issue.
      const issue = await linear.getIssue(request.body.issueId)

      // The list the Handler chose from is a moment old; the issue may have
      // been closed since it was drawn.
      if (!isActionableLinearWorkflowStateType(issue.stateType)) {
        throw linearIssueNotActionable(issue.identifier, issue.stateName)
      }

      return reply.code(201).send(
        store.createJobForLinearIssue({
          baseBranch: request.body.baseBranch,
          issue,
          repositoryId: request.body.repositoryId,
          source: 'linear',
          workClass: request.body.workClass,
        }),
      )
    },
  )

  app.post(
    '/api/intake/adhoc',
    {
      schema: {
        body: CreateAdhocJobSchema,
        response: {
          201: JobSchema,
          400: ApiErrorSchema,
          404: ApiErrorSchema,
          409: ApiErrorSchema,
          ...linearErrorResponses,
        },
      },
    },
    async (request, reply) => {
      // Linear first, because only Linear can name the canonical branch. The
      // issue is created assigned to the Handler, so if the insert below fails
      // it simply reappears in this same list rather than being stranded.
      const issue = await linear.createIssue({
        teamId: request.body.teamId,
        title: request.body.title,
        description: request.body.description,
        priority: request.body.priority,
      })

      return reply.code(201).send(
        store.createJobForLinearIssue({
          baseBranch: request.body.baseBranch,
          issue,
          repositoryId: request.body.repositoryId,
          source: 'adhoc',
          workClass: request.body.workClass,
        }),
      )
    },
  )

  /**
   * Answers from git once the Handler has said which checkout they mean, and
   * from this installation's own history until then — so the field still works
   * on the way to choosing a repository, and stops guessing once it can ask.
   *
   * Local either way, so it keeps answering when Linear does not.
   */
  app.get(
    '/api/intake/base-branches',
    {
      schema: {
        querystring: Type.Object({
          repositoryId: Type.Optional(Type.String()),
        }),
        response: {
          200: BaseBranchSuggestionsSchema,
          404: ApiErrorSchema,
          502: ApiErrorSchema,
        },
      },
    },
    async (request) => {
      const { repositoryId } = request.query
      if (repositoryId === undefined) {
        return store.listBaseBranchSuggestions()
      }

      const repository = store.getRepository(repositoryId)
      const branches = await git.listRemoteBranches(repository.path)

      // The default is reported on its own field, so it is left out of the list
      // rather than appearing twice.
      return {
        defaultBranch: repository.defaultBaseBranch,
        recent: branches.filter(
          (branch) => branch !== repository.defaultBaseBranch,
        ),
      }
    },
  )

  done()
}
