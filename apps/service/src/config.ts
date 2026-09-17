import { readFileSync, statSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'

import { parse } from 'dotenv'

import { repositoryRoot } from './paths.js'

const allowedEnvironmentKeys = new Set([
  'HANDELLA_DATABASE_PATH',
  'HANDELLA_PORT',
])

export interface AppConfig {
  databasePath: string
  dashboardPath: string
  host: '127.0.0.1'
  port: number
  repositoryRoot: string
}

interface LoadConfigOptions {
  environment?: NodeJS.ProcessEnv
  rootDirectory?: string
}

function readEnvironmentFile(rootDirectory: string): Record<string, string> {
  const environmentPath = join(rootDirectory, '.env')

  let stats
  try {
    stats = statSync(environmentPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {}
    }
    throw error
  }

  const permissions = stats.mode & 0o777
  if ((permissions & 0o077) !== 0 || (permissions & 0o400) === 0) {
    throw new Error(
      '.env must be owner-readable with no group or world permissions',
    )
  }

  const values = parse(readFileSync(environmentPath))
  const unknownKeys = Object.keys(values).filter(
    (key) => !allowedEnvironmentKeys.has(key),
  )
  if (unknownKeys.length > 0) {
    throw new Error(`Unknown .env keys: ${unknownKeys.sort().join(', ')}`)
  }

  return values
}

function parsePort(value: string | undefined): number {
  if (value === undefined) {
    return 4310
  }

  if (!/^\d+$/.test(value)) {
    throw new Error('HANDELLA_PORT must be an integer between 1 and 65535')
  }

  const port = Number(value)
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error('HANDELLA_PORT must be an integer between 1 and 65535')
  }

  return port
}

export function loadConfig(options: LoadConfigOptions = {}): AppConfig {
  const rootDirectory = options.rootDirectory ?? repositoryRoot
  const environment = options.environment ?? process.env
  const fileEnvironment = readEnvironmentFile(rootDirectory)

  const valueFor = (key: string): string | undefined =>
    environment[key] ?? fileEnvironment[key]

  const configuredDatabasePath =
    valueFor('HANDELLA_DATABASE_PATH') ?? '.data/handella.sqlite'
  if (configuredDatabasePath.trim() === '') {
    throw new Error('HANDELLA_DATABASE_PATH must not be empty')
  }

  const databasePath = isAbsolute(configuredDatabasePath)
    ? configuredDatabasePath
    : resolve(rootDirectory, configuredDatabasePath)

  return {
    databasePath,
    dashboardPath: join(rootDirectory, 'apps/dashboard/dist'),
    host: '127.0.0.1',
    port: parsePort(valueFor('HANDELLA_PORT')),
    repositoryRoot: rootDirectory,
  }
}
