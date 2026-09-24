import { readFileSync } from 'node:fs'

import { availableSlots, maxConcurrency } from '@handella/contracts'
import { afterEach, describe, expect, it } from 'vitest'

import type {
  CodexAdapter,
  ImplementationResult,
} from '../src/adapters/codex.js'
import type { GitAdapter } from '../src/adapters/git.js'
import type { GitHubAdapter } from '../src/adapters/github.js'
import { githubUnavailable } from '../src/domain/errors.js'
import { createScheduler } from '../src/domain/scheduler.js'
import type { TestContext } from './helpers.js'
import {
  aDispatchedQueue,
  aJobAwaitingApproval,
  aPullRequest,
  aTemporaryDirectory,
  anApprovedJob,
  cleanupTestContexts,
  createFakeCodexAdapter,
  createFakeGitAdapter,
  createFakeGitHubAdapter,
  createTestContext,
  type FakeCodexAdapter,
  type FakeGitHubAdapter,
} from './helpers.js'

afterEach(cleanupTestContexts)

/**
 * The canonical branch every dispatched test job claims. Asserted against
 * rather than read back, so a test that expects a pull request and a test that
 * expects the wrong HEAD are talking about the same name.
 */
const branchOf = (context: TestContext, jobId: string): string => {
  const branch = context.store.getJob(jobId).canonicalBranch
  if (branch === null) throw new Error('The job has no canonical branch')
  return branch
}

interface Harness {
  codex: FakeCodexAdapter
  github: FakeGitHubAdapter
  logRoot: string
  run: () => Promise<void>
}

/**
 * The scheduler and the doubles behind it, with the worktree's HEAD already
 * agreeing with the job's canonical branch — which is what it would be after a
 * turn that stayed on its branch, and the thing every test that is not about
 * the HEAD assertion needs to be true.
 */
const aHarness = (
  context: TestContext,
  jobIds: readonly string[],
  overrides: {
    codex?: CodexAdapter
    git?: GitAdapter
    github?: GitHubAdapter
  } = {},
): Harness => {
  const codex = (overrides.codex ??
    createFakeCodexAdapter()) as FakeCodexAdapter
  const github = (overrides.github ??
    createFakeGitHubAdapter()) as FakeGitHubAdapter
  const logRoot = aTemporaryDirectory('handella-logs-')

  const git = overrides.git ?? createFakeGitAdapter()
  if (overrides.git === undefined) {
    for (const jobId of jobIds) {
      const job = context.store.getJob(jobId)
      if (job.worktreePath !== null && job.canonicalBranch !== null) {
        ;(git as ReturnType<typeof createFakeGitAdapter>).heads.set(
          job.worktreePath,
          job.canonicalBranch,
        )
      }
    }
  }

  const scheduler = createScheduler({
    broadcaster: context.broadcaster,
    codex,
    git,
    github,
    linear: context.linear,
    logRoot,
    store: context.store,
  })

  return {
    codex,
    github,
    logRoot,
    run: async () => {
      scheduler.start()
      await scheduler.whenIdle()
      scheduler.stop()
    },
  }
}

const anEnding = (
  overrides: Partial<ImplementationResult> = {},
): ImplementationResult => ({
  failureReason: null,
  outcome: 'finished',
  ...overrides,
})

const openItems = (context: TestContext, jobId: string) =>
  context.store
    .listAttentionItems()
    .filter((item) => item.jobId === jobId && item.resolvedAt === null)

/** The one item a turn that ended without a pull request leaves behind. */
const handoffFor = (context: TestContext, jobId: string) => {
  const items = openItems(context, jobId).filter(
    (item) => item.kind === 'handlerInput',
  )
  expect(items).toHaveLength(1)
  return items[0]
}

describe('reaching a ready pull request', () => {
  it('opens the pull request GitHub shows on the branch', async () => {
    const context = createTestContext()
    const jobId = await anApprovedJob(context)
    const branch = branchOf(context, jobId)
    const harness = aHarness(context, [jobId], {
      github: createFakeGitHubAdapter({
        pullRequests: {
          [branch]: aPullRequest({
            url: 'https://github.com/acme/monorepo/pull/99',
          }),
        },
      }),
    })

    await harness.run()

    const job = context.store.getJob(jobId)
    expect(job.state).toBe('prOpen')
    expect(job.originalPrUrl).toBe('https://github.com/acme/monorepo/pull/99')
    // The slot went back with the pass, and nothing is left asking for the
    // Handler.
    expect(job.codexPass).toBeNull()
    expect(openItems(context, jobId).map((item) => item.kind)).toEqual([
      'readyPr',
    ])
  })

  it('implements in the session that planned', async () => {
    const context = createTestContext()
    const jobId = await anApprovedJob(context, 'session-planning')
    const branch = branchOf(context, jobId)
    const harness = aHarness(context, [jobId], {
      github: createFakeGitHubAdapter({
        pullRequests: { [branch]: aPullRequest() },
      }),
    })

    await harness.run()

    expect(harness.codex.implementations[0]?.sessionId).toBe('session-planning')
  })

  it('records the runbook snapshot rather than the runbook as it stands now', async () => {
    const context = createTestContext()
    const jobId = await anApprovedJob(context)
    const branch = branchOf(context, jobId)
    context.store.createRunbookVersion({ content: '# A runbook written later' })
    const harness = aHarness(context, [jobId], {
      github: createFakeGitHubAdapter({
        pullRequests: { [branch]: aPullRequest() },
      }),
    })

    await harness.run()

    expect(harness.codex.implementations[0]?.runbook).not.toContain(
      'A runbook written later',
    )
  })
})

describe('a turn that ends without a pull request', () => {
  it('hands the job to the Handler rather than to another turn', async () => {
    const context = createTestContext()
    const jobId = await anApprovedJob(context)
    const harness = aHarness(context, [jobId])
    harness.codex.answerWith(anEnding())

    await harness.run()

    // One turn, recorded as having ended, and no second one however long the
    // scheduler is left to think about it.
    expect(harness.codex.implementations).toHaveLength(1)
    expect(context.store.listAttempts(jobId)).toMatchObject([
      { outcome: 'finished' },
    ])

    // Not stopped, not suspended: the job is still implementing, in the
    // Handler's terminal now rather than in Handella's pass.
    const job = context.store.getJob(jobId)
    expect(job.state).toBe('implementing')
    expect(job.suspension).toBeNull()
    expect(job.originalPrUrl).toBeNull()
    expect(job.codexPass).toBeNull()
    expect(availableSlots(context.store.listJobs())).toBe(maxConcurrency)

    const handoff = handoffFor(context, jobId)
    expect(handoff?.title).toBe('Implementation needs you')
    expect(handoff?.body).toContain('No pull request was opened')
    expect(handoff?.body).toContain('Open the session')
  })

  it.each([
    ['a draft', aPullRequest({ isDraft: true })],
    ['already closed', aPullRequest({ state: 'CLOSED' })],
    ['aimed at another base', aPullRequest({ baseRefName: 'main' })],
  ])('refuses a pull request that is %s', async (_label, pullRequest) => {
    const context = createTestContext()
    const jobId = await anApprovedJob(context)
    const branch = branchOf(context, jobId)
    const harness = aHarness(context, [jobId], {
      github: createFakeGitHubAdapter({
        pullRequests: { [branch]: pullRequest },
      }),
    })

    await harness.run()

    expect(context.store.getJob(jobId).state).toBe('implementing')
    expect(handoffFor(context, jobId)?.body).toContain('The pull request for')
  })

  it('never asks GitHub when the worktree is on the wrong branch', async () => {
    const context = createTestContext()
    const jobId = await anApprovedJob(context)
    const git = createFakeGitAdapter()
    git.headBranch = async () => 'some-other-branch'
    const harness = aHarness(context, [jobId], { git })

    await harness.run()

    expect(harness.github.asked).toEqual([])
    expect(context.store.getJob(jobId).state).toBe('implementing')
    expect(handoffFor(context, jobId)?.body).toContain('some-other-branch')
  })

  it('carries how a turn failed into the handoff', async () => {
    const context = createTestContext()
    const jobId = await anApprovedJob(context)
    const harness = aHarness(context, [jobId])
    harness.codex.answerWith(
      anEnding({ failureReason: 'Codex exited with 3', outcome: 'failed' }),
    )

    await harness.run()

    expect(context.store.listAttempts(jobId)[0]).toMatchObject({
      failureReason: 'Codex exited with 3',
      outcome: 'failed',
    })
    expect(handoffFor(context, jobId)?.body).toContain('Codex exited with 3')
    // A failed turn is not a suspended job: the worktree holds what the turn
    // wrote, and the Handler picks the session up from there.
    expect(context.store.getJob(jobId).suspension).toBeNull()
  })

  it('asks nothing after a stop, which is the Handler’s own', async () => {
    const context = createTestContext()
    const jobId = await anApprovedJob(context)
    const harness = aHarness(context, [jobId])
    harness.codex.answerWith(
      anEnding({
        failureReason: 'Implementation was stopped',
        outcome: 'stopped',
      }),
    )

    await harness.run()

    expect(harness.github.asked).toEqual([])
    expect(
      openItems(context, jobId).filter((item) => item.kind === 'handlerInput'),
    ).toEqual([])
  })
})

describe('a GitHub Handella cannot reach', () => {
  it('asks the Handler rather than guessing', async () => {
    const context = createTestContext()
    const jobId = await anApprovedJob(context)
    const github = createFakeGitHubAdapter()
    github.findPullRequest = async () => {
      throw githubUnavailable('gh pr list failed')
    }
    const harness = aHarness(context, [jobId], { github })

    await harness.run()

    // The turn's own ending is on the row whatever GitHub did afterwards.
    expect(context.store.listAttempts(jobId)).toMatchObject([
      { outcome: 'finished' },
    ])
    const job = context.store.getJob(jobId)
    expect(job.state).toBe('implementing')
    expect(job.suspension).toBeNull()
    expect(handoffFor(context, jobId)?.body).toContain(
      'could not check whether a pull request exists',
    )
  })
})

describe('an attempt that was never closed', () => {
  it('is refused rather than doubled', async () => {
    const context = createTestContext()
    const jobId = await anApprovedJob(context)
    const logRoot = aTemporaryDirectory('handella-logs-')
    context.store.startAttempt({ jobId, logRoot, sessionId: 'session-1' })

    // Two open turns would be two agents in one session.
    expect(() =>
      context.store.startAttempt({ jobId, logRoot, sessionId: 'session-1' }),
    ).toThrow(/open implementation attempt/)
  })
})

describe('the GitHub pre-flight', () => {
  it('spends no turn when gh is logged out, and claims once it is back', async () => {
    const context = createTestContext()
    const jobId = await anApprovedJob(context)
    const branch = branchOf(context, jobId)
    const github = createFakeGitHubAdapter({
      pullRequests: { [branch]: aPullRequest() },
    })
    github.authenticated = false

    await aHarness(context, [jobId], { github }).run()

    expect(context.store.listAttempts(jobId)).toEqual([])
    // Stopped before it was claimed: still `approved`, holding no slot, so
    // that `gh auth login` and a Resume are the whole of the recovery.
    const stopped = context.store.getJob(jobId)
    expect(stopped.state).toBe('approved')
    expect(stopped.suspension).toBe('stoppedBySystem')
    expect(stopped.codexPass).toBeNull()
    expect(openItems(context, jobId).map((item) => item.kind)).toContain(
      'blocker',
    )

    github.authenticated = true
    context.store.resumeJob(jobId)
    await aHarness(context, [jobId], { github }).run()

    expect(context.store.getJob(jobId).state).toBe('prOpen')
  })
})

describe('milestones and the raw log', () => {
  it('writes the readable beats as rows and every line to the log', async () => {
    const context = createTestContext()
    const jobId = await anApprovedJob(context)
    const branch = branchOf(context, jobId)
    const harness = aHarness(context, [jobId], {
      github: createFakeGitHubAdapter({
        pullRequests: { [branch]: aPullRequest() },
      }),
    })
    harness.codex.emits(
      { kind: 'command', summary: 'npm test' },
      { kind: 'narration', summary: 'Two suites fail' },
    )

    await harness.run()

    const milestones = context.store.listMilestones(jobId)
    expect(milestones.map((milestone) => milestone.summary)).toEqual([
      'npm test',
      'Two suites fail',
    ])
    expect(milestones.map((milestone) => milestone.seq)).toEqual([0, 1])

    const attempt = context.store.listAttempts(jobId)[0]
    const logPath = context.store.attemptLogPath({
      attemptId: attempt?.id ?? '',
      jobId,
    })
    expect(readFileSync(logPath, 'utf8').trim().split('\n')).toHaveLength(2)
  })

  it('announces progress without carrying it', async () => {
    const context = createTestContext()
    const jobId = await anApprovedJob(context)
    const branch = branchOf(context, jobId)
    const harness = aHarness(context, [jobId], {
      github: createFakeGitHubAdapter({
        pullRequests: { [branch]: aPullRequest() },
      }),
    })
    harness.codex.emits({ kind: 'command', summary: 'npm test' })

    await harness.run()

    const progress = context.published.filter(
      (event) => event.name === 'job.progress',
    )
    expect(progress.length).toBeGreaterThan(0)
    expect(progress[0]?.data).toEqual({ jobId })
  })
})

describe('slots', () => {
  it('starts an approved job ahead of a queued one', async () => {
    const context = createTestContext()
    const ids = await aDispatchedQueue(context, 4)
    const approved = ids.at(-1)
    if (approved === undefined) throw new Error('No job was dispatched')
    aJobAwaitingApproval(context, approved)
    context.store.approveJob({ jobId: approved })

    const branch = branchOf(context, approved)
    const harness = aHarness(context, [approved], {
      github: createFakeGitHubAdapter({
        pullRequests: { [branch]: aPullRequest() },
      }),
    })

    await harness.run()

    // Three slots and four jobs, one of them approved: the approved one is the
    // one that had to get a slot, whatever the queue order says.
    expect(harness.codex.implementations).toHaveLength(1)
    expect(harness.codex.implementations[0]?.job.id).toBe(approved)
    expect(context.store.getJob(approved).state).toBe('prOpen')
  })

  it('leaves a job the Handler is driving alone, and counts it against nothing', async () => {
    const context = createTestContext()
    const jobId = await anApprovedJob(context)
    // What a terminal approval looks like from here: implementing, with no
    // pass of Handella's behind it.
    context.store.transitionJob({
      actor: 'system',
      jobId,
      to: 'implementing',
    })
    expect(availableSlots(context.store.listJobs())).toBe(maxConcurrency)

    const harness = aHarness(context, [jobId])
    await harness.run()

    // No turn of Handella's is started on top of the Handler's session.
    expect(harness.codex.implementations).toEqual([])
    expect(context.store.getJob(jobId).state).toBe('implementing')
  })

  it('holds the slot for exactly as long as the pass runs', async () => {
    const context = createTestContext()
    const jobId = await anApprovedJob(context)

    const claimed = context.store.startPass({
      from: 'approved',
      jobId,
      kind: 'implement',
      to: 'implementing',
    })
    expect(claimed).toMatchObject({
      codexPass: 'implement',
      state: 'implementing',
    })
    expect(availableSlots(context.store.listJobs())).toBe(maxConcurrency - 1)

    context.store.endPass(jobId)

    expect(context.store.getJob(jobId).codexPass).toBeNull()
    expect(availableSlots(context.store.listJobs())).toBe(maxConcurrency)
    // The freed slot is announced, because it is what the scheduler waits on.
    expect(
      context.published.filter((event) => event.name === 'job.changed').length,
    ).toBeGreaterThan(0)
  })
})

describe('a restart', () => {
  it('holds an interrupted implementation where it stands', async () => {
    const context = createTestContext()
    const jobId = await anApprovedJob(context)
    context.store.startPass({
      from: 'approved',
      jobId,
      kind: 'implement',
      to: 'implementing',
    })
    const attempt = context.store.startAttempt({
      jobId,
      logRoot: aTemporaryDirectory('handella-logs-'),
      sessionId: 'session-1',
    })

    context.store.markInterrupted()

    const job = context.store.getJob(jobId)
    expect(job.state).toBe('implementing')
    expect(job.suspension).toBe('interrupted')
    // No pass survived the restart, so none holds a slot.
    expect(job.codexPass).toBeNull()
    expect(context.store.listAttempts(jobId)[0]).toMatchObject({
      id: attempt.id,
      outcome: 'interrupted',
    })
    expect(context.store.listAttempts(jobId)[0]?.endedAt).not.toBeNull()
  })

  it('leaves alone an implementing job whose turn had already ended', async () => {
    const context = createTestContext()
    const jobId = await anApprovedJob(context)
    context.store.transitionJob({ actor: 'system', jobId, to: 'implementing' })
    const attempt = context.store.startAttempt({
      jobId,
      logRoot: aTemporaryDirectory('handella-logs-'),
      sessionId: 'session-1',
    })
    context.store.finishAttempt({
      attemptId: attempt.id,
      failureReason: null,
      outcome: 'finished',
    })

    // The Handler is finishing this one in their terminal; a restart of
    // Handella interrupted nothing of theirs.
    expect(context.store.markInterrupted()).toEqual([])
    expect(context.store.getJob(jobId).suspension).toBeNull()
  })
})
