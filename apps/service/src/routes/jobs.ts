import {
  ApiErrorSchema,
  CreateJobSchema,
  JobSchema,
  JobTransitionSchema,
  PlanVersionSchema,
  RequestPlanChangesSchema,
  QueueOrderRequestSchema,
  ReviewRoundSchema,
  RunbookSnapshotSchema,
  SuspendRequestSchema,
  TransitionRequestSchema,
} from '@handella/contracts'
import {
  Type,
  type FastifyPluginCallbackTypebox,
} from '@fastify/type-provider-typebox'

import type { Dispatcher } from '../domain/dispatch.js'
import type { Store } from '../domain/store.js'

const JobIdParamsSchema = Type.Object({ jobId: Type.String() })
const PlanVersionParamsSchema = Type.Object({
  jobId: Type.String(),
  planVersionId: Type.String(),
})

const errorResponses = {
  404: ApiErrorSchema,
  409: ApiErrorSchema,
}

export const jobRoutes: FastifyPluginCallbackTypebox<{
  dispatcher: Dispatcher
  store: Store
}> = (app, options, done) => {
  const { dispatcher, store } = options

  /**
   * The whole order rather than one job's position: reordering a list by
   * sending a single priority is two writes racing to renumber the same rows.
   */
  app.post(
    '/api/queue/order',
    {
      schema: {
        body: QueueOrderRequestSchema,
        response: { 200: Type.Array(JobSchema), ...errorResponses },
      },
    },
    async (request) => store.reorderQueue(request.body.jobIds),
  )

  app.get(
    '/api/jobs',
    { schema: { response: { 200: Type.Array(JobSchema) } } },
    async () => store.listJobs(),
  )

  /**
   * Dispatch is its own verb rather than a move to `queued`: CONTEXT.md:96-99
   * defines it as three actions, and only one of them is a state change.
   *
   * 202 rather than 201, and rather than waiting: the claim has committed and
   * the Job is queued, but cutting the worktree means fetching a remote, which
   * on a large monorepo is seconds. The worktree path and any failure reach the
   * dashboard over the event stream.
   */
  app.post(
    '/api/jobs/:jobId/dispatch',
    {
      schema: {
        params: JobIdParamsSchema,
        response: {
          202: JobSchema,
          ...errorResponses,
          502: ApiErrorSchema,
          503: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const outcome = await dispatcher.dispatch(request.params.jobId)

      // Failures are already turned into an attention item by the compensating
      // write; this only catches that write itself failing, which is a bug.
      outcome.worktree.catch((error: unknown) => {
        request.log.error({ err: error }, 'Dispatch compensation failed')
      })

      return reply.code(202).send(outcome.job)
    },
  )

  app.post(
    '/api/jobs',
    { schema: { body: CreateJobSchema, response: { 201: JobSchema } } },
    async (request, reply) =>
      reply.code(201).send(store.createJob(request.body)),
  )

  app.get(
    '/api/jobs/:jobId',
    {
      schema: {
        params: JobIdParamsSchema,
        response: { 200: JobSchema, ...errorResponses },
      },
    },
    async (request) => store.getJob(request.params.jobId),
  )

  app.get(
    '/api/jobs/:jobId/transitions',
    {
      schema: {
        params: JobIdParamsSchema,
        response: { 200: Type.Array(JobTransitionSchema), ...errorResponses },
      },
    },
    async (request) => store.listJobTransitions(request.params.jobId),
  )

  app.get(
    '/api/jobs/:jobId/plan-versions',
    {
      schema: {
        params: JobIdParamsSchema,
        response: { 200: Type.Array(PlanVersionSchema), ...errorResponses },
      },
    },
    async (request) => store.listPlanVersions(request.params.jobId),
  )

  app.get(
    '/api/jobs/:jobId/runbook-snapshots',
    {
      schema: {
        params: JobIdParamsSchema,
        response: { 200: Type.Array(RunbookSnapshotSchema), ...errorResponses },
      },
    },
    async (request) => store.listRunbookSnapshots(request.params.jobId),
  )

  app.get(
    '/api/jobs/:jobId/review-rounds',
    {
      schema: {
        params: JobIdParamsSchema,
        response: { 200: Type.Array(ReviewRoundSchema), ...errorResponses },
      },
    },
    async (request) => store.listReviewRounds(request.params.jobId),
  )

  /**
   * The two answers a plan can get. Semantic rather than transitions, because
   * each carries writes the move depends on: approval has a revision to mark
   * and a runbook to freeze, a change request has feedback to record. The
   * revision is in the path so a stale page cannot answer a plan the Handler
   * never read — only the newest revision is accepted.
   */
  app.post(
    '/api/jobs/:jobId/plan-versions/:planVersionId/approve',
    {
      schema: {
        params: PlanVersionParamsSchema,
        response: { 200: JobSchema, ...errorResponses },
      },
    },
    async (request) =>
      store.approvePlan({
        jobId: request.params.jobId,
        planVersionId: request.params.planVersionId,
      }),
  )

  app.post(
    '/api/jobs/:jobId/plan-versions/:planVersionId/request-changes',
    {
      schema: {
        params: PlanVersionParamsSchema,
        body: RequestPlanChangesSchema,
        response: { 200: JobSchema, ...errorResponses },
      },
    },
    async (request) =>
      store.requestPlanChanges({
        feedback: request.body.feedback,
        jobId: request.params.jobId,
        planVersionId: request.params.planVersionId,
      }),
  )

  /**
   * One endpoint for every legal edge. Later phases add semantic endpoints that
   * call the same store operation with their side effects; this one stays as
   * the Handler override for recovery.
   */
  app.post(
    '/api/jobs/:jobId/transitions',
    {
      schema: {
        params: JobIdParamsSchema,
        body: TransitionRequestSchema,
        response: { 200: JobSchema, ...errorResponses },
      },
    },
    async (request) =>
      store.transitionJob({
        actor: 'handler',
        jobId: request.params.jobId,
        ...request.body,
      }),
  )

  app.post(
    '/api/jobs/:jobId/suspension',
    {
      schema: {
        params: JobIdParamsSchema,
        body: SuspendRequestSchema,
        response: { 200: JobSchema, ...errorResponses },
      },
    },
    async (request) =>
      store.suspendJob({
        jobId: request.params.jobId,
        ...request.body,
      }),
  )

  app.delete(
    '/api/jobs/:jobId/suspension',
    {
      schema: {
        params: JobIdParamsSchema,
        response: { 200: JobSchema, ...errorResponses },
      },
    },
    async (request) => store.resumeJob(request.params.jobId),
  )

  done()
}
