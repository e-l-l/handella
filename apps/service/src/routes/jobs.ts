import {
  ApiErrorSchema,
  CreateJobSchema,
  JobSchema,
  JobTransitionSchema,
  PlanVersionSchema,
  ReviewRoundSchema,
  RunbookSnapshotSchema,
  SuspendRequestSchema,
  TransitionRequestSchema,
} from '@handella/contracts'
import {
  Type,
  type FastifyPluginCallbackTypebox,
} from '@fastify/type-provider-typebox'

import type { Store } from '../domain/store.js'

const JobIdParamsSchema = Type.Object({ jobId: Type.String() })

const errorResponses = {
  404: ApiErrorSchema,
  409: ApiErrorSchema,
}

export const jobRoutes: FastifyPluginCallbackTypebox<{ store: Store }> = (
  app,
  options,
  done,
) => {
  const { store } = options

  app.get(
    '/api/jobs',
    { schema: { response: { 200: Type.Array(JobSchema) } } },
    async () => store.listJobs(),
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
