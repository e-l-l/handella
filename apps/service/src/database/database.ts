import { randomUUID } from 'node:crypto'
import { chmodSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

import BetterSqlite3 from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'

import { defaultRunbookContent } from './default-runbook.js'
import { appInstallation, runbookVersions } from './schema.js'

export interface InstallationStatus {
  createdAt: Date
  id: string
  journalMode: 'wal'
  lastStartedAt: Date
}

export interface StatusSource {
  getStatus(): InstallationStatus
}

export type HandellaDatabase = BetterSQLite3Database<Record<string, never>>

export interface DatabaseContext extends StatusSource {
  close(): void
  /** The migrated connection, for the domain store to run its transactions on. */
  drizzle: HandellaDatabase
  markStarted(startedAt?: Date): void
}

interface OpenDatabaseOptions {
  databasePath: string
  idFactory?: () => string
  migrationsPath: string
  now?: () => Date
}

function secureDatabaseFiles(databasePath: string): void {
  for (const path of [
    databasePath,
    `${databasePath}-shm`,
    `${databasePath}-wal`,
  ]) {
    try {
      chmodSync(path, 0o600)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
    }
  }
}

export function openDatabase(options: OpenDatabaseOptions): DatabaseContext {
  const databaseDirectory = dirname(options.databasePath)
  mkdirSync(databaseDirectory, { recursive: true, mode: 0o700 })
  chmodSync(databaseDirectory, 0o700)

  const sqlite = new BetterSqlite3(options.databasePath)
  try {
    sqlite.pragma('journal_mode = WAL')
    sqlite.pragma('foreign_keys = ON')
    sqlite.pragma('busy_timeout = 5000')

    const database = drizzle(sqlite)
    migrate(database, { migrationsFolder: options.migrationsPath })

    const now = options.now?.() ?? new Date()
    const idFactory = options.idFactory ?? randomUUID

    database
      .insert(appInstallation)
      .values({
        singletonKey: 1,
        installationId: idFactory(),
        createdAt: now,
        lastStartedAt: now,
      })
      .onConflictDoNothing({ target: appInstallation.singletonKey })
      .run()

    // Version 1 of the Runbook, so an installation is never in the state of
    // having a job to approve and no procedure to snapshot. Conflict-free for
    // the same reason the installation row is: this runs on every startup, and
    // a Handler who has edited theirs is already past version 1.
    database
      .insert(runbookVersions)
      .values({
        id: idFactory(),
        version: 1,
        content: defaultRunbookContent,
        createdAt: now,
      })
      .onConflictDoNothing({ target: runbookVersions.version })
      .run()

    secureDatabaseFiles(options.databasePath)

    return {
      close() {
        sqlite.close()
      },
      drizzle: database,
      getStatus() {
        sqlite.prepare('select 1').get()
        const journalMode = String(
          sqlite.pragma('journal_mode', { simple: true }),
        ).toLowerCase()
        if (journalMode !== 'wal') {
          throw new Error(`Unexpected SQLite journal mode: ${journalMode}`)
        }

        const installation = database
          .select()
          .from(appInstallation)
          .where(eq(appInstallation.singletonKey, 1))
          .get()
        if (installation === undefined) {
          throw new Error('Application installation record is missing')
        }

        return {
          createdAt: installation.createdAt,
          id: installation.installationId,
          journalMode: 'wal',
          lastStartedAt: installation.lastStartedAt,
        }
      },
      markStarted(startedAt = new Date()) {
        database
          .update(appInstallation)
          .set({ lastStartedAt: startedAt })
          .where(eq(appInstallation.singletonKey, 1))
          .run()
        secureDatabaseFiles(options.databasePath)
      },
    }
  } catch (error) {
    sqlite.close()
    throw error
  }
}

export function defaultMigrationsPath(rootDirectory: string): string {
  return join(rootDirectory, 'apps/service/drizzle')
}
