import { readFileSync } from 'node:fs'

import { maxImplementationAttempts } from '@handella/contracts'
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
  aReport,
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
  outcome: 'reportedDone',
  report: aReport(),
  ...overrides,
})

const openItems = (context: TestContext, jobId: string) =>
  context.store
    .listAttentionItems()
    .filter((item) => item.jobId === jobId && item.resolvedAt === null)

describe('reaching a ready pull request', () => {
  it('opens the pull request Handella found, not the one it was told about', async () => {
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
    // The agent claims a different pull request than the one that exists.
    harness.codex.answerWith(
      anEnding({
        report: aReport({ pullRequestUrl: 'https://example.invalid/pr/1' }),
      }),
    )

    await harness.run()

    const job = context.store.getJob(jobId)
    expect(job.state).toBe('prOpen')
    expect(job.originalPrUrl).toBe('https://github.com/acme/monorepo/pull/99')
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

describe('verification beating the report', () => {
  it('does not reach prOpen when no pull request exists', async () => {
    const context = createTestContext()
    const jobId = await anApprovedJob(context)
    const harness = aHarness(context, [jobId])
    harness.codex.answerWith(anEnding())

    await harness.run()

    const job = context.store.getJob(jobId)
    expect(job.state).toBe('implementing')
    expect(job.originalPrUrl).toBeNull()
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

    expect(context.store.getJob(jobId).state).not.toBe('prOpen')
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
  })
})

describe('the bound on autonomous repair', () => {
  it('takes three turns and then asks the Handler', async () => {
    const context = createTestContext()
    const jobId = await anApprovedJob(context)
    const harness = aHarness(context, [jobId])
    // Reports done every time, but no pull request ever appears.
    harness.codex.answerWith(anEnding())

    await harness.run()

    const attempts = context.store.listAttempts(jobId)
    expect(attempts).toHaveLength(maxImplementationAttempts)
    expect(attempts.map((attempt) => attempt.attempt)).toEqual([1, 2, 3])
    expect(attempts.every((attempt) => attempt.round === 1)).toBe(true)

    const job = context.store.getJob(jobId)
    expect(job.state).toBe('implementing')
    expect(job.suspension).toBe('stoppedBySystem')
    expect(openItems(context, jobId).map((item) => item.kind)).toContain(
      'failure',
    )
  })

  it('stops at once when the plan turned out to be wrong', async () => {
    const context = createTestContext()
    const jobId = await anApprovedJob(context)
    const harness = aHarness(context, [jobId])
    harness.codex.answerWith(
      anEnding({
        outcome: 'reportedBlocked',
        report: aReport({
          outcome: 'blocked',
          planDeviations: ['src/date.ts does not exist'],
        }),
      }),
    )

    await harness.run()

    expect(context.store.listAttempts(jobId)).toHaveLength(1)
    expect(context.store.getJob(jobId).suspension).toBe('stoppedBySystem')
    const failure = openItems(context, jobId).find(
      (item) => item.kind === 'failure',
    )
    expect(failure?.body).toContain('src/date.ts does not exist')
  })

  it('gives a resumed job a fresh round rather than a fourth turn', async () => {
    const context = createTestContext()
    const jobId = await anApprovedJob(context)
    const exhausting = aHarness(context, [jobId])
    exhausting.codex.answerWith(anEnding())
    await exhausting.run()

    const branch = branchOf(context, jobId)
    const resumed = aHarness(context, [jobId], {
      github: createFakeGitHubAdapter({
        pullRequests: { [branch]: aPullRequest() },
      }),
    })
    context.store.resumeJob(jobId)
    await resumed.run()

    const attempts = context.store.listAttempts(jobId)
    expect(attempts.at(-1)).toMatchObject({ attempt: 1, round: 2 })
    expect(context.store.getJob(jobId).state).toBe('prOpen')
  })

  it('carries the previous turn’s unresolved work into the next brief', async () => {
    const context = createTestContext()
    const jobId = await anApprovedJob(context)
    const harness = aHarness(context, [jobId])
    harness.codex.answerWith(
      anEnding({ report: aReport({ unresolved: ['npm test: 2 failures'] }) }),
    )

    await harness.run()

    expect(harness.codex.implementations[0]?.unresolved).toEqual([])
    expect(harness.codex.implementations[1]?.unresolved).toEqual([
      'npm test: 2 failures',
    ])
  })
})

describe('a GitHub Handella cannot reach', () => {
  it('asks the Handler rather than spending a repair turn', async () => {
    const context = createTestContext()
    const jobId = await anApprovedJob(context)
    const github = createFakeGitHubAdapter()
    github.findPullRequest = async () => {
      throw githubUnavailable('gh pr list failed')
    }
    const harness = aHarness(context, [jobId], { github })
    harness.codex.answerWith(anEnding())

    await harness.run()

    // One turn, with the report it actually produced still on the row: the
    // work may well have landed, and `unresolved` is the only brief a later
    // turn would have.
    const attempts = context.store.listAttempts(jobId)
    expect(attempts).toHaveLength(1)
    expect(attempts[0]).toMatchObject({ outcome: 'reportedDone' })
    expect(attempts[0]?.report).not.toBeNull()

    const job = context.store.getJob(jobId)
    expect(job.state).toBe('implementing')
    expect(job.suspension).toBe('stoppedBySystem')
    expect(
      openItems(context, jobId).find((item) => item.kind === 'failure')?.body,
    ).toContain('could not check whether a pull request exists')
  })
})

describe('an attempt that was never closed', () => {
  it('is refused rather than granted a fresh round', async () => {
    const context = createTestContext()
    const jobId = await anApprovedJob(context)
    const logRoot = aTemporaryDirectory('handella-logs-')
    context.store.startAttempt({ jobId, logRoot, sessionId: 'session-1' })

    // Reading an open row as "not repairable" would open round 2, and the one
    // after it round 3, for as long as whatever left it open lasts.
    expect(() =>
      context.store.startAttempt({ jobId, logRoot, sessionId: 'session-1' }),
    ).toThrow(/open implementation attempt/)
  })
})

describe('the GitHub pre-flight', () => {
  it('spends no turn when gh is logged out', async () => {
    const context = createTestContext()
    const jobId = await anApprovedJob(context)
    const github = createFakeGitHubAdapter()
    github.authenticated = false
    const harness = aHarness(context, [jobId], { github })

    await harness.run()

    expect(context.store.listAttempts(jobId)).toEqual([])
    expect(harness.codex.implementations).toEqual([])
    const job = context.store.getJob(jobId)
    expect(job.suspension).toBe('stoppedBySystem')
    expect(openItems(context, jobId).map((item) => item.kind)).toContain(
      'blocker',
    )
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

  it('restarts a job left implementing with no pass behind it', async () => {
    const context = createTestContext()
    const jobId = await anApprovedJob(context)
    // What a stop mid-turn leaves behind: the job holds its slot and its
    // position, and nothing is running in it.
    context.store.transitionJob({
      actor: 'system',
      jobId,
      to: 'implementing',
    })

    const branch = branchOf(context, jobId)
    const harness = aHarness(context, [jobId], {
      github: createFakeGitHubAdapter({
        pullRequests: { [branch]: aPullRequest() },
      }),
    })

    await harness.run()

    expect(harness.codex.implementations).toHaveLength(1)
    expect(context.store.getJob(jobId).state).toBe('prOpen')
  })
})

describe('a restart', () => {
  it('holds an interrupted implementation where it stands', async () => {
    const context = createTestContext()
    const jobId = await anApprovedJob(context)
    context.store.transitionJob({ actor: 'system', jobId, to: 'implementing' })
    const attempt = context.store.startAttempt({
      jobId,
      logRoot: aTemporaryDirectory('handella-logs-'),
      sessionId: 'session-1',
    })

    context.store.markInterrupted()

    const job = context.store.getJob(jobId)
    expect(job.state).toBe('implementing')
    expect(job.suspension).toBe('interrupted')
    expect(context.store.listAttempts(jobId)[0]).toMatchObject({
      id: attempt.id,
      outcome: 'interrupted',
    })
    expect(context.store.listAttempts(jobId)[0]?.endedAt).not.toBeNull()
  })
})
