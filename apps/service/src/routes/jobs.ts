import {
  ApiErrorSchema,
  AttemptSchema,
  CreateJobSchema,
  MilestoneSchema,
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

import { createReadStream, statSync } from 'node:fs'
import { Transform } from 'node:stream'

import type { TerminalOpener } from '../adapters/terminal.js'
import type { Dispatcher } from '../domain/dispatch.js'
import { worktreeNotCut } from '../domain/errors.js'
import type { MergeCheck } from '../domain/merge-check.js'
import type { Store } from '../domain/store.js'

const JobIdParamsSchema = Type.Object({ jobId: Type.String() })
const PlanVersionParamsSchema = Type.Object({
  jobId: Type.String(),
  planVersionId: Type.String(),
})
const AttemptParamsSchema = Type.Object({
  attemptId: Type.String(),
  jobId: Type.String(),
})

/**
 * How much of a turn's raw stream is served by default. A ninety-minute turn
 * writes megabytes of JSONL and the end of it is the part that says what
 * happened; the whole file is a deliberate ask rather than the default a job
 * page would pull on every refetch.
 */
const logTailBytes = 256 * 1024

/**
 * Drops whatever is left of the line a tail landed in the middle of.
 *
 * A byte offset cannot know where a line begins, so the first thing a tail
 * reads is a fragment of JSONL — and, if the cut fell inside a multi-byte
 * character, a replacement character where text used to be. Done as it passes
 * rather than by probing for the newline first, because a line has no length
 * limit and a probe would need one.
 */
const fromNextLine = (): Transform => {
  let found = false
  return new Transform({
    transform(chunk: Buffer, _encoding, done) {
      if (found) {
        done(null, chunk)
        return
      }
      const newline = chunk.indexOf(0x0a)
      if (newline === -1) {
        done()
        return
      }
      found = true
      done(null, chunk.subarray(newline + 1))
    },
  })
}

const errorResponses = {
  404: ApiErrorSchema,
  409: ApiErrorSchema,
}

export const jobRoutes: FastifyPluginCallbackTypebox<{
  dispatcher: Dispatcher
  mergeCheck: MergeCheck
  store: Store
  terminal: TerminalOpener
}> = (app, options, done) => {
  const { dispatcher, mergeCheck, store, terminal } = options

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

  /**
   * The Job's Codex session, opened in a terminal on the Handler's machine.
   *
   * What it answers is "what is going on in there": Milestones and the Attempt
   * log are a summary and a flattening of a conversation, and the conversation
   * is what the Handler wants when a pass is taking longer than it should. A
   * Job that has not planned yet has no session, and the window is then a
   * shell standing in the Worktree — which is also all a Worktree question
   * needs.
   *
   * Resuming makes the Handler a second voice in a session Handella resumes
   * too, including while a pass is running. That is the trade they asked for
   * and docs/adr/0011 is why; the dashboard says so beside the button.
   *
   * A POST and not a GET for the reason `choose-path` is one: it puts a window
   * in front of someone rather than reading anything. It carries no body, so
   * what keeps another page from opening terminals on the Handler's machine is
   * the same-origin hook in `app.ts` (ADR 0009) and not the method.
   */
  app.post(
    '/api/jobs/:jobId/terminal',
    {
      schema: {
        params: JobIdParamsSchema,
        response: {
          204: Type.Null(),
          ...errorResponses,
          502: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const job = store.getJob(request.params.jobId)
      if (job.worktreePath === null) throw worktreeNotCut(job.id)

      await terminal.open({
        path: job.worktreePath,
        sessionId: job.codexSessionId,
      })
      return reply.code(204).send(null)
    },
  )

  /**
   * Asks GitHub now whether this Job's pull request has been merged, rather
   * than waiting for Reconciliation's timer to come round.
   *
   * The Handler has just merged it and wants the worktree gone; five minutes
   * of a directory that has no reason to exist is what this saves. Answers
   * with the Job either way and refuses nothing: a pull request that is not
   * merged yet is not an error, it is an answer, and the Job comes back
   * unchanged to say so.
   *
   * A POST because it can move the Job and delete a directory, though it is
   * phrased as a question — the same reason `/dispatch` is one.
   */
  app.post(
    '/api/jobs/:jobId/check-merge',
    {
      schema: {
        params: JobIdParamsSchema,
        response: { 200: JobSchema, ...errorResponses, 502: ApiErrorSchema },
      },
    },
    async (request) => mergeCheck.check(request.params.jobId),
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
    '/api/jobs/:jobId/attempts',
    {
      schema: {
        params: JobIdParamsSchema,
        response: { 200: Type.Array(AttemptSchema), ...errorResponses },
      },
    },
    async (request) => store.listAttempts(request.params.jobId),
  )

  /**
   * Every attempt's milestones in one answer rather than one call per attempt.
   * The job page draws them all on one spine, and a running job invalidates
   * this key every second — one request per refresh rather than one per turn.
   */
  app.get(
    '/api/jobs/:jobId/milestones',
    {
      schema: {
        params: JobIdParamsSchema,
        response: { 200: Type.Array(MilestoneSchema), ...errorResponses },
      },
    },
    async (request) => store.listMilestones(request.params.jobId),
  )

  /**
   * The raw stream, streamed rather than read: the point of serving a tail is
   * not to hold the whole file in memory on the way past.
   */
  app.get(
    '/api/jobs/:jobId/attempts/:attemptId/log',
    {
      schema: {
        params: AttemptParamsSchema,
        querystring: Type.Object({ full: Type.Optional(Type.Boolean()) }),
      },
    },
    async (request, reply) => {
      const logPath = store.attemptLogPath(request.params)

      let size: number
      try {
        size = statSync(logPath).size
      } catch {
        // Phase 12 deletes these while the attempt row survives, so a missing
        // file is an ordinary answer about an old job rather than a failure.
        return reply
          .header('x-handella-truncated', 'false')
          .type('text/plain; charset=utf-8')
          .send('')
      }

      const start =
        request.query.full === true ? 0 : Math.max(0, size - logTailBytes)
      const file = createReadStream(logPath, { start })

      let body: NodeJS.ReadableStream = file
      if (start > 0) {
        const whole = fromNextLine()
        // `pipe` does not carry an error forward, and a read that fails after
        // the headers are out would otherwise hang the response open.
        file.on('error', (error) => whole.destroy(error))
        body = file.pipe(whole)
      }

      return reply
        .header('x-handella-truncated', start > 0 ? 'true' : 'false')
        .type('text/plain; charset=utf-8')
        .send(body)
    },
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
