import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { loadConfig } from '../src/config.js'

const temporaryDirectories: string[] = []

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'handella-config-'))
  temporaryDirectories.push(root)
  return root
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
})

describe('loadConfig', () => {
  it('uses repository-local defaults and a fixed loopback host', () => {
    const root = temporaryRoot()
    const config = loadConfig({ environment: {}, rootDirectory: root })

    expect(config).toMatchObject({
      databasePath: join(root, '.data/handella.sqlite'),
      dashboardPath: join(root, 'apps/dashboard/dist'),
      host: '127.0.0.1',
      port: 4310,
    })
  })

  it('lets process environment values override a secure .env file', () => {
    const root = temporaryRoot()
    const environmentPath = join(root, '.env')
    writeFileSync(
      environmentPath,
      'HANDELLA_PORT=4400\nHANDELLA_DATABASE_PATH=.data/from-file.sqlite\n',
      { mode: 0o600 },
    )

    const config = loadConfig({
      environment: { HANDELLA_PORT: '4500' },
      rootDirectory: root,
    })

    expect(config.port).toBe(4500)
    expect(config.databasePath).toBe(join(root, '.data/from-file.sqlite'))
  })

  it.each(['0', '65536', 'not-a-port'])('rejects invalid port %s', (port) => {
    expect(() =>
      loadConfig({
        environment: { HANDELLA_PORT: port },
        rootDirectory: temporaryRoot(),
      }),
    ).toThrow('HANDELLA_PORT must be an integer between 1 and 65535')
  })

  it('rejects unknown .env keys', () => {
    const root = temporaryRoot()
    writeFileSync(join(root, '.env'), 'SURPRISE=true\n', { mode: 0o600 })

    expect(() => loadConfig({ environment: {}, rootDirectory: root })).toThrow(
      'Unknown .env keys: SURPRISE',
    )
  })

  it('rejects .env files readable by other users', () => {
    const root = temporaryRoot()
    const environmentPath = join(root, '.env')
    writeFileSync(environmentPath, 'HANDELLA_PORT=4400\n')
    chmodSync(environmentPath, 0o644)

    expect(() => loadConfig({ environment: {}, rootDirectory: root })).toThrow(
      '.env must be owner-readable with no group or world permissions',
    )
  })
})
