import { availableSlots, maxConcurrency } from '@handella/contracts'
import { afterEach, describe, expect, it } from 'vitest'

import { createScheduler } from '../src/domain/scheduler.js'
import type { TestContext } from './helpers.js'
import {
  aDispatchedQueue,
  aTemporaryDirectory,
  buildTestApp,
  cleanupTestContexts,
  createFakeCodexAdapter,
  createFakeGitAdapter,
  createFakeGitHubAdapter,
  createFakeTerminalOpener,
  createTestContext,
  type FakeCodexAdapter,
} from './helpers.js'

afterEach(cleanupTestContexts)

const aLoom = 'https://www.loom.com/share/9f2c4d6e8a0b'

const aScheduler = (context: TestContext, codex: FakeCodexAdapter) =>
  createScheduler({
    broadcaster: context.broadcaster,
    codex,
    git: createFakeGitAdapter(),
    github: createFakeGitHubAdapter(),
    linear: context.linear,
    logRoot: aTemporaryDirectory('handella-logs-'),
    store: context.store,
  })

/** A dispatched job whose issue leans on a recording. */
const aJobWithAVideo = async (
  context: TestContext,
): Promise<{ codex: FakeCodexAdapter; jobId: string }> => {
  const [jobId] = await aDispatchedQueue(context, 1)
  if (jobId === undefined) throw new Error('No job was dispatched')

  const issueId = context.store.getJob(jobId).linearIssueId ?? ''
  context.linear.describe(issueId, {
    description: `The button flickers. Repro: ${aLoom}`,
  })

  const codex = createFakeCodexAdapter()
  const scheduler = aScheduler(context, codex)
  scheduler.start()
  await scheduler.whenIdle()
  scheduler.stop()

  return { codex, jobId }
}

describe('an issue Handella will not plan unattended', () => {
  it('holds the job and asks the Handler, rather than planning around the video', async () => {
    const context = createTestContext()
    const { codex, jobId } = await aJobWithAVideo(context)

    // No pass at all: planning around the evidence is what the hold exists to
    // refuse.
    expect(codex.calls).toEqual([])

    const job = context.store.getJob(jobId)
    expect(job.state).toBe('planning')
    expect(job.hold).toBe('handlerPlanning')
    expect(job.codexSessionId).toBeNull()
    // Not a Suspension: nothing stopped, and there is nothing to resume.
    expect(job.suspension).toBeNull()

    const item = context.store
      .listAttentionItems()
      .find((open) => open.jobId === jobId)
    expect(item).toMatchObject({
      kind: 'handlerInput',
      title: 'Planning needs you',
    })
    expect(item?.body).toContain(aLoom)
  })

  it('holds no slot, so the queue keeps moving', async () => {
    const context = createTestContext()
    await aJobWithAVideo(context)

    expect(availableSlots(context.store.listJobs())).toBe(maxConcurrency)
    expect(context.store.listJobs()[0]?.codexPass).toBeNull()
  })

  it('opens a watch that looks for the session the Handler is about to start', async () => {
    const context = createTestContext()
    const { jobId } = await aJobWithAVideo(context)

    expect(context.store.listSessionWatches()).toMatchObject([
      { jobId, rolloutPath: null, status: 'discovering' },
    ])
  })

  it('is not what a restart interrupted', async () => {
    const context = createTestContext()
    const { jobId } = await aJobWithAVideo(context)

    // A held job lost nothing to the restart: no pass was running in it, and
    // re-queueing it would plan the very thing Handella declined to plan.
    expect(context.store.markInterrupted()).toEqual([])
    expect(context.store.getJob(jobId)).toMatchObject({
      hold: 'handlerPlanning',
      state: 'planning',
      suspension: null,
    })
  })

  it('plans an issue that carries a screenshot rather than a recording', async () => {
    const context = createTestContext()
    const [jobId] = await aDispatchedQueue(context, 1)
    const issueId = context.store.getJob(jobId ?? '').linearIssueId ?? ''
    context.linear.describe(issueId, {
      attachments: [
        { title: 'Screenshot', url: 'https://uploads.linear.app/a/b.png' },
      ],
    })

    const codex = createFakeCodexAdapter()
    const scheduler = aScheduler(context, codex)
    scheduler.start()
    await scheduler.whenIdle()
    scheduler.stop()

    expect(codex.calls).toHaveLength(1)
    expect(context.store.getJob(jobId ?? '')).toMatchObject({
      hold: null,
      state: 'planReview',
    })
  })
})

describe('the session a held job opens', () => {
  it('starts Codex on the brief rather than resuming a session it does not have', async () => {
    const context = createTestContext()
    const { jobId } = await aJobWithAVideo(context)
    const terminal = createFakeTerminalOpener()
    const { app } = await buildTestApp({ context, terminal })

    const response = await app.inject({
      method: 'POST',
      url: `/api/jobs/${jobId}/terminal`,
    })

    expect(response.statusCode).toBe(204)
    const opened = terminal.opened()[0]
    expect(opened?.sessionId).toBeNull()
    // The brief Handella would have sent, plus the one thing it could not do.
    expect(opened?.prompt).toContain('ENG-412')
    expect(opened?.prompt).toContain(aLoom)
    expect(opened?.prompt).toContain('local path')
  })

  it('resumes the session as usual once the job has one', async () => {
    const context = createTestContext()
    const { jobId } = await aJobWithAVideo(context)
    context.store.adoptDiscoveredSession({
      jobId,
      rolloutPath: '/sessions/rollout-theirs.jsonl',
      sessionId: 'theirs',
    })
    const terminal = createFakeTerminalOpener()
    const { app } = await buildTestApp({ context, terminal })

    await app.inject({ method: 'POST', url: `/api/jobs/${jobId}/terminal` })

    expect(terminal.opened()[0]).toMatchObject({
      prompt: null,
      sessionId: 'theirs',
    })
  })
})

describe('adopting the session the Handler opened', () => {
  it('records it, answers the item, and follows from there', async () => {
    const context = createTestContext()
    const { jobId } = await aJobWithAVideo(context)

    context.store.adoptDiscoveredSession({
      jobId,
      rolloutPath: '/sessions/rollout-theirs.jsonl',
      sessionId: 'theirs',
    })

    expect(context.store.getJob(jobId).codexSessionId).toBe('theirs')
    expect(
      context.store.listAttentionItems().filter((item) => item.jobId === jobId),
    ).toEqual([])
    expect(context.store.listSessionWatches()).toMatchObject([
      { rolloutPath: '/sessions/rollout-theirs.jsonl', status: 'following' },
    ])
  })

  it('refuses a second session for a job that is already in one', async () => {
    const context = createTestContext()
    const { jobId } = await aJobWithAVideo(context)
    context.store.adoptDiscoveredSession({
      jobId,
      rolloutPath: '/sessions/one.jsonl',
      sessionId: 'theirs',
    })

    expect(() =>
      context.store.adoptDiscoveredSession({
        jobId,
        rolloutPath: '/sessions/two.jsonl',
        sessionId: 'another',
      }),
    ).toThrowError(/already in a Codex session/)
  })
})
