import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { CreateJob, DomainEvent } from '@handella/contracts'

import { buildApp } from '../src/app.js'
import { createFakeLinearAdapter } from './linear-fake.js'
import {
  defaultMigrationsPath,
  openDatabase,
  type DatabaseContext,
  type StatusSource,
} from '../src/database/database.js'
import { reviewRounds, runbookSnapshots } from '../src/database/schema.js'
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
  const app = await buildApp({
    broadcaster: context.broadcaster,
    linear: createFakeLinearAdapter(),
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
