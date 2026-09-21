import { readFileSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'

import { parse } from 'dotenv'

import { repositoryRoot } from './paths.js'

/**
 * The keys whose values are secrets rather than settings. Kept apart from the
 * rest of the allowlist because it is what `secretValues` is built from: a key
 * added to Handella without being named here is a secret that will be written
 * into a log unredacted, and the split is the only place that can be noticed.
 */
const secretEnvironmentKeys = new Set(['HANDELLA_LINEAR_API_KEY'])

const allowedEnvironmentKeys = new Set([
  'HANDELLA_DATABASE_PATH',
  'HANDELLA_PORT',
  'HANDELLA_TERMINAL_APP',
  ...secretEnvironmentKeys,
])

/**
 * The `_`-delimited words that make an inherited variable a credential.
 *
 * Handella's own settings are named exactly above; this is about the
 * environment Handella does not own but hands on. The implementation sandbox
 * runs with the Handler's whole environment and reaches the network (ADR 0010),
 * so an agent that prints its environment — or a tool that prints it inside an
 * error — would write those values into a log the dashboard serves.
 *
 * Matched on the key rather than on the value's shape, for the reason
 * `redact.ts` gives for not matching patterns at all: a name says a value is
 * secret, a shape only suggests it. A false positive costs one ordinary value
 * being hidden; a false negative costs a credential in a log.
 */
const credentialWords = new Set([
  'APIKEY',
  'CREDENTIAL',
  'CREDENTIALS',
  'PASSWD',
  'PASSWORD',
  'SECRET',
  'TOKEN',
])

const namesACredential = (key: string): boolean =>
  key
    .toUpperCase()
    .split('_')
    .some((word) => credentialWords.has(word) || word.endsWith('KEY'))

/**
 * Below this, a value is left alone. A secret short enough to collide with
 * ordinary text would redact that text everywhere it appeared, which hides
 * more than it protects.
 */
const shortestRedactableSecret = 8

export interface AppConfig {
  databasePath: string
  dashboardPath: string
  host: '127.0.0.1'
  /** Absent when the Handler has not set one. Intake is then unavailable, but Handella still starts. */
  linearApiKey: string | undefined
  /**
   * Where an Attempt's raw Codex stream is kept, beside the database and the
   * worktrees and not configurable for the same reason as `worktreeRoot`.
   */
  logRoot: string
  port: number
  repositoryRoot: string
  /**
   * Every secret's actual value, for the redactor that persisted output passes
   * through. Values rather than keys, because what has to be kept out of a log
   * is the secret itself wherever it turns up — in a command Codex ran, in an
   * error a tool printed — and not only where it is named.
   *
   * Handella's own settings and the credentials it inherits, because the
   * sandbox is handed both and a log cannot tell them apart.
   */
  secretValues: readonly string[]
  /**
   * The terminal application "Open terminal" opens, when the Handler has named
   * one. Absent is not a missing setting: Handella then takes the first of the
   * terminals it knows that is installed, and only a Handler whose preference
   * is not that one has anything to say here.
   */
  terminalApp: string | undefined
  /**
   * Where Dispatch cuts worktrees. Beside the database rather than inside the
   * target checkout, and deliberately not configurable — see
   * docs/adr/0006-fixed-worktree-root.md.
   */
  worktreeRoot: string
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

/**
 * A setting the Handler may leave out, where blank and absent say the same
 * thing: they have not finished setting something up, or have nothing to say
 * about it. Unlike the database path, neither is a failure — refusing to start
 * would take the whole of Handella down with an optional integration, and the
 * dashboard says what is missing.
 */
function parseOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed === undefined || trimmed === '' ? undefined : trimmed
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

  // Handella's own secrets and every credential in the environment the
  // implementation pass inherits. `createRedactor` dedupes and orders these.
  const secretValues = [
    ...new Set(
      [
        ...[...secretEnvironmentKeys].map((key) => valueFor(key)),
        ...Object.entries(environment)
          .filter(([key]) => namesACredential(key))
          .map(([, value]) => value),
      ]
        .map((value) => value?.trim() ?? '')
        .filter((value) => value.length >= shortestRedactableSecret),
    ),
  ]

  return {
    databasePath,
    dashboardPath: join(rootDirectory, 'apps/dashboard/dist'),
    host: '127.0.0.1',
    linearApiKey: parseOptional(valueFor('HANDELLA_LINEAR_API_KEY')),
    port: parsePort(valueFor('HANDELLA_PORT')),
    logRoot: join(dirname(databasePath), 'logs'),
    repositoryRoot: rootDirectory,
    secretValues,
    terminalApp: parseOptional(valueFor('HANDELLA_TERMINAL_APP')),
    worktreeRoot: join(dirname(databasePath), 'worktrees'),
  }
}
