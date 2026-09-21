import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { CreateJob, DomainEvent } from '@handella/contracts'

import type { GitAdapter } from '../src/adapters/git.js'
import type { GitHubAdapter } from '../src/adapters/github.js'
import type { ProcessInspector } from '../src/adapters/processes.js'
import type { MergeCheck } from '../src/domain/merge-check.js'

import { buildApp } from '../src/app.js'
import { aPlanContent, createFakeCodexAdapter } from './codex-fake.js'
import { createFakeFolderPicker } from './folders-fake.js'
import { createFakeGitAdapter } from './git-fake.js'
import { createFakeGitHubAdapter } from './github-fake.js'
import { createFakeProcessInspector } from './processes-fake.js'
import { createFakeTerminalOpener } from './terminal-fake.js'
import {
  aLinearIssue,
  aLinearIssueLink,
  createFakeLinearAdapter,
  type FakeLinearAdapter,
} from './linear-fake.js'
import {
  defaultMigrationsPath,
  openDatabase,
  type DatabaseContext,
  type StatusSource,
} from '../src/database/database.js'
import { repositories, reviewRounds } from '../src/database/schema.js'
import { createDispatcher } from '../src/domain/dispatch.js'
import { createMergeCheck } from '../src/domain/merge-check.js'
import { createReconciler, type Reconciler } from '../src/domain/reconcile.js'
import { createStore, type Store } from '../src/domain/store.js'
import {
  createBroadcaster,
  type Broadcaster,
} from '../src/events/broadcaster.js'
import { repositoryRoot } from '../src/paths.js'

type App = Awaited<ReturnType<typeof buildApp>>

export interface TestContext {
  broadcaster: Broadcaster
  database: DatabaseContext
  /**
   * One Linear per context. Dispatch reads an issue back and so does every
   * planning pass, so two fakes would mean a job dispatched against an issue
   * that planning cannot find.
   */
  linear: FakeLinearAdapter
  /** Every event published since the context was created, in order. */
  published: DomainEvent[]
  store: Store
}

/**
 * The repository every test context is born with. Seeded rather than created
 * through the store so its id is a constant the request payloads can name,
 * which is what keeps Intake's bodies literals instead of fixtures.
 */
export const testRepositoryId = '9f1d2c3b-4a5e-4b6c-8d7e-0f1a2b3c4d5e'
export const testRepositoryPath = '/tmp/handella-test-repository'

const temporaryDirectories: string[] = []
const openContexts: DatabaseContext[] = []
const openApps: App[] = []

/** Removed by `cleanupTestContexts`, so a test never has to clean up after itself. */
/**
 * Resolved, because git answers `worktree list` with real paths and macOS
 * hands out temporary directories under `/var`, which is a symlink to
 * `/private/var`. A suite whose root is the unresolved spelling is a suite
 * comparing two paths production never compares.
 */
export function aTemporaryDirectory(prefix: string): string {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  temporaryDirectories.push(directory)
  return directory
}

/**
 * A real checkout on disk, for the routes that now ask the filesystem whether
 * a path is one. `git init` rather than a hand-made `.git`, so the helper is
 * making the thing the assertion is about.
 */
export function aCheckoutDirectory(): string {
  const directory = aTemporaryDirectory('handella-checkout-')
  execFileSync('git', ['init', '--quiet'], { cwd: directory })
  return directory
}

interface TestContextOptions {
  /** A store built on a clock the test drives, for ordering that a shared millisecond would otherwise decide. */
  now?: () => Date
}

export function createTestContext(
  options: TestContextOptions = {},
): TestContext {
  const directory = aTemporaryDirectory('handella-test-')

  const database = openDatabase({
    databasePath: join(directory, 'handella.sqlite'),
    migrationsPath: defaultMigrationsPath(repositoryRoot),
  })
  openContexts.push(database)

  database.drizzle
    .insert(repositories)
    .values({
      id: testRepositoryId,
      name: 'acme monorepo',
      path: testRepositoryPath,
      defaultBaseBranch: 'dev',
      createdAt: new Date('2026-09-18T09:00:00.000Z'),
      updatedAt: new Date('2026-09-18T09:00:00.000Z'),
    })
    .run()

  const inner = createBroadcaster()
  const published: DomainEvent[] = []
  const broadcaster: Broadcaster = {
    publish(event) {
      published.push(event)
      inner.publish(event)
    },
    subscribe: inner.subscribe,
  }

  return {
    broadcaster,
    database,
    linear: createFakeLinearAdapter(),
    published,
    store: createStore({
      broadcaster,
      database: database.drizzle,
      ...(options.now === undefined ? {} : { now: options.now }),
    }),
  }
}

export const healthyStatusSource: StatusSource = {
  getStatus: () => ({
    id: '123e4567-e89b-42d3-a456-426614174000',
    createdAt: new Date('2026-09-18T09:00:00.000Z'),
    lastStartedAt: new Date('2026-09-18T10:00:00.000Z'),
    journalMode: 'wal',
  }),
}

/**
 * Every app needs a real store, so each one brings its own database unless the
 * caller hands over a context it already built.
 */
export async function buildTestApp(
  overrides: Partial<Parameters<typeof buildApp>[0]> & {
    context?: TestContext
  } = {},
): Promise<TestApp> {
  const { context: given, ...appOverrides } = overrides
  const context = given ?? createTestContext()
  // One Linear for the app and the dispatcher inside it, whether that is the
  // context's or one the test brought: two would let a job be dispatched
  // against an issue the routes cannot see.
  const linear = appOverrides.linear ?? context.linear
  // One of each for the app, the dispatcher and the merge check, for the same
  // reason: a worktree cut through one fake and asked about through another is
  // a worktree that exists on one side of the test and not the other.
  const git = appOverrides.git ?? createFakeGitAdapter()
  const github = appOverrides.github ?? createFakeGitHubAdapter()
  const worktreeRoot = aTemporaryDirectory('handella-worktrees-')
  const mergeCheck =
    appOverrides.mergeCheck ??
    createMergeCheck({ git, github, store: context.store })

  const app = await buildApp({
    broadcaster: context.broadcaster,
    codex: createFakeCodexAdapter(),
    folders: createFakeFolderPicker(),
    dispatcher: createDispatcher({
      git,
      linear,
      store: context.store,
      worktreeRoot,
    }),
    git,
    github,
    linear,
    mergeCheck,
    statusSource: healthyStatusSource,
    store: context.store,
    terminal: createFakeTerminalOpener(),
    version: '0.1.0',
    ...appOverrides,
  })
  openApps.push(app)
  return {
    app,
    context,
    git,
    github,
    mergeCheck,
    store: context.store,
    worktreeRoot,
  }
}

interface TestApp {
  app: App
  context: TestContext
  /** The adapters the app is actually holding, whoever built them. */
  git: GitAdapter
  github: GitHubAdapter
  mergeCheck: MergeCheck
  store: Store
  /** The root the dispatcher cuts into, so Reconciliation can be told the same one. */
  worktreeRoot: string
}

/**
 * Reconciliation over a context, wired to the same fakes the rest of the test
 * is using.
 *
 * `delay` is answered immediately by default: the grace period between a
 * SIGTERM and a SIGKILL is five real seconds, and a suite that waited it out
 * would spend a minute proving it.
 */
export function buildTestReconciler(
  options: {
    context: TestContext
    git: GitAdapter
    mergeCheck: MergeCheck
    processes?: ProcessInspector
    worktreeRoot: string
  } & Partial<Parameters<typeof createReconciler>[0]>,
): Reconciler {
  const { context, processes, ...rest } = options

  return createReconciler({
    delay: () => Promise.resolve(),
    processes: processes ?? createFakeProcessInspector(),
    store: context.store,
    ...rest,
  })
}

export async function cleanupTestContexts(): Promise<void> {
  await Promise.all(openApps.splice(0).map((app) => app.close()))
  for (const database of openContexts.splice(0)) {
    database.close()
  }
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
}

export * from './codex-fake.js'
export * from './folders-fake.js'
export * from './git-fake.js'
export * from './github-fake.js'
export * from './linear-fake.js'
export * from './processes-fake.js'
export * from './terminal-fake.js'

/**
 * Where a scenario's worktrees are cut, for the suites that then ask
 * Reconciliation about the same directory. Left out by every other suite,
 * which does not care where the root is as long as it is its own.
 */
export interface WorktreeOptions {
  git?: GitAdapter
  worktreeRoot?: string
}

export const anIntakeJob = (overrides: Partial<CreateJob> = {}): CreateJob => ({
  source: 'adhoc',
  title: 'Fix the flaky login test',
  workClass: 'routine',
  baseBranch: 'dev',
  ...overrides,
})

/** A job already carrying everything dispatch requires. */
export const aDispatchableJob = (
  overrides: Partial<CreateJob> = {},
): CreateJob =>
  anIntakeJob({
    canonicalBranch: 'ell/eng-412-fix-flaky-login-test',
    linearIssueKey: 'ENG-412',
    ...overrides,
  })

/**
 * One issue per queued Job. Each needs its own Linear identity: two Jobs for
 * one issue would take ADR 0004's suffix rather than queueing side by side.
 */
export const aQueueableIssue = (index: number) =>
  aLinearIssue({
    branchName: `ell/eng-${index}-something`,
    id: `0000000${index}-0000-4000-8000-00000000000${index}`,
    identifier: `ENG-${index}`,
    title: `Job ${index}`,
  })

/**
 * `count` Jobs taken on and dispatched, in that order, with their worktrees
 * cut — the state every queue and scheduler test starts from. Returns the ids
 * in the order they were taken on, which is the order the queue reads them in
 * before anyone reorders it.
 */
export const aDispatchedQueue = async (
  context: TestContext,
  count: number,
  options: WorktreeOptions = {},
): Promise<string[]> => {
  const issues = Array.from({ length: count }, (_, index) =>
    aQueueableIssue(index),
  )
  context.linear.issues.push(...issues)
  const dispatcher = createDispatcher({
    git: options.git ?? createFakeGitAdapter(),
    linear: context.linear,
    store: context.store,
    worktreeRoot:
      options.worktreeRoot ?? aTemporaryDirectory('handella-worktrees-'),
  })

  const ids: string[] = []
  for (const issue of issues) {
    const job = context.store.createJobForLinearIssue({
      baseBranch: 'dev',
      issue: aLinearIssueLink(issue),
      repositoryId: testRepositoryId,
      source: 'linear',
      workClass: 'routine',
    })
    ids.push(job.id)
    await (
      await dispatcher.dispatch(job.id)
    ).worktree
  }
  return ids
}

/**
 * A job sitting in planReview with a plan to answer, which is the state every
 * approval and change-request test starts from. Walks the real path rather
 * than seeding rows: the session id and the revision are both things the
 * approval flow reads back.
 */
export function aPlanAwaitingApproval(
  context: TestContext,
  jobId: string,
  sessionId = 'session-1',
) {
  context.store.transitionJob({ actor: 'system', jobId, to: 'planning' })
  context.store.recordCodexSession({ jobId, sessionId })
  const version = context.store.createPlanVersion({
    content: aPlanContent(),
    jobId,
  })
  context.store.transitionJob({ actor: 'system', jobId, to: 'planReview' })
  return version
}

/**
 * A job approved and waiting to be implemented, which is where every
 * implementation test starts. Walked rather than seeded: `approved` has a guard
 * behind it that reads both the approved revision and the runbook snapshot.
 */
export async function anApprovedJob(
  context: TestContext,
  sessionId = 'session-1',
  options: WorktreeOptions = {},
): Promise<string> {
  const [jobId] = await aDispatchedQueue(context, 1, options)
  if (jobId === undefined) throw new Error('No job was dispatched')
  const version = aPlanAwaitingApproval(context, jobId, sessionId)
  context.store.approvePlan({ jobId, planVersionId: version.id })
  return jobId
}

/**
 * A job walked all the way to merged, which is what ADR 0004's round counting
 * needs behind an issue. Approval is taken properly rather than as a bare
 * move, because a job cannot reach `approved` without a plan and a snapshot.
 */
export function aMergedJob(context: TestContext, jobId: string): void {
  context.store.transitionJob({ actor: 'handler', jobId, to: 'queued' })
  const version = aPlanAwaitingApproval(context, jobId)
  context.store.approvePlan({ jobId, planVersionId: version.id })

  for (const to of ['implementing', 'prOpen', 'merged'] as const) {
    context.store.transitionJob({ actor: 'handler', jobId, to })
  }
}

/**
 * A Job whose pull request is open and whose merge Handella is waiting for,
 * which is where every merge check starts. Walked rather than seeded, because
 * `prOpen` is reached by recording the pull request and not by moving the Job:
 * a state with no url is one the cleanup could not act on.
 */
export async function aJobAwaitingMerge(
  context: TestContext,
  options: WorktreeOptions = {},
): Promise<string> {
  const jobId = await anApprovedJob(context, 'session-1', options)
  context.store.transitionJob({ actor: 'system', jobId, to: 'implementing' })
  context.store.openPullRequest({
    jobId,
    url: 'https://github.com/acme/monorepo/pull/41',
  })
  return jobId
}

/**
 * Nothing writes a review round until Phase 11, so the test that reads one
 * back seeds the row the way that phase will. Runbook snapshots are no longer
 * seeded at all: approval writes them now, and a seeded one would prove less
 * than the write that really happens.
 */
export function aReviewRound(
  context: TestContext,
  jobId: string,
  roundNumber: number,
): void {
  context.database.drizzle
    .insert(reviewRounds)
    .values({
      id: randomUUID(),
      jobId,
      roundNumber,
      comments: '[]',
      createdAt: new Date(),
    })
    .run()
}
