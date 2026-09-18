import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { CreateJob, DomainEvent } from '@handella/contracts'

import { buildApp } from '../src/app.js'
import { createFakeGitAdapter } from './git-fake.js'
import {
  aLinearIssue,
  aLinearIssueLink,
  createFakeLinearAdapter,
} from './linear-fake.js'
import {
  defaultMigrationsPath,
  openDatabase,
  type DatabaseContext,
  type StatusSource,
} from '../src/database/database.js'
import {
  repositories,
  reviewRounds,
  runbookSnapshots,
} from '../src/database/schema.js'
import { createDispatcher } from '../src/domain/dispatch.js'
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
export function aTemporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  temporaryDirectories.push(directory)
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
): Promise<{ app: App; context: TestContext; store: Store }> {
  const { context: given, ...appOverrides } = overrides
  const context = given ?? createTestContext()
  const linear = createFakeLinearAdapter()
  const git = createFakeGitAdapter()
  const app = await buildApp({
    broadcaster: context.broadcaster,
    dispatcher: createDispatcher({
      git,
      linear,
      store: context.store,
      worktreeRoot: aTemporaryDirectory('handella-worktrees-'),
    }),
    git,
    linear,
    statusSource: healthyStatusSource,
    store: context.store,
    version: '0.1.0',
    ...appOverrides,
  })
  openApps.push(app)
  return { app, context, store: context.store }
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

export * from './git-fake.js'
export * from './linear-fake.js'

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
): Promise<string[]> => {
  const issues = Array.from({ length: count }, (_, index) =>
    aQueueableIssue(index),
  )
  const dispatcher = createDispatcher({
    git: createFakeGitAdapter(),
    linear: createFakeLinearAdapter({ issues }),
    store: context.store,
    worktreeRoot: aTemporaryDirectory('handella-worktrees-'),
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
 * Nothing writes a snapshot or a review round until Phases 5 and 11, so the
 * tests that read them back seed the rows the way those phases will.
 */
export function aRunbookSnapshot(
  context: TestContext,
  jobId: string,
  content: string,
): void {
  context.database.drizzle
    .insert(runbookSnapshots)
    .values({ id: randomUUID(), jobId, content, createdAt: new Date() })
    .run()
}

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
