import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  defaultMigrationsPath,
  openDatabase,
} from '../src/database/database.js'
import { repositoryRoot } from '../src/paths.js'

const temporaryDirectories: string[] = []

function temporaryDatabasePath(): string {
  const root = mkdtempSync(join(tmpdir(), 'handella-database-'))
  temporaryDirectories.push(root)
  return join(root, 'nested/handella.sqlite')
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
})

describe('openDatabase', () => {
  it('migrates, persists one installation, and advances its start time', () => {
    const databasePath = temporaryDatabasePath()
    const migrationsPath = defaultMigrationsPath(repositoryRoot)
    const firstStart = new Date('2026-09-18T10:00:00.000Z')
    const secondStart = new Date('2026-09-18T11:00:00.000Z')

    const firstDatabase = openDatabase({
      databasePath,
      idFactory: () => '123e4567-e89b-42d3-a456-426614174000',
      migrationsPath,
      now: () => firstStart,
    })
    expect(firstDatabase.getStatus()).toEqual({
      id: '123e4567-e89b-42d3-a456-426614174000',
      createdAt: firstStart,
      lastStartedAt: firstStart,
      journalMode: 'wal',
    })
    firstDatabase.close()

    const secondDatabase = openDatabase({
      databasePath,
      idFactory: () => '123e4567-e89b-42d3-a456-426614174999',
      migrationsPath,
      now: () => secondStart,
    })
    expect(secondDatabase.getStatus().lastStartedAt).toEqual(firstStart)
    secondDatabase.markStarted(secondStart)
    expect(secondDatabase.getStatus()).toEqual({
      id: '123e4567-e89b-42d3-a456-426614174000',
      createdAt: firstStart,
      lastStartedAt: secondStart,
      journalMode: 'wal',
    })
    secondDatabase.close()

    expect(statSync(databasePath).mode & 0o777).toBe(0o600)
    expect(statSync(join(databasePath, '..')).mode & 0o777).toBe(0o700)
  })
})
