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

describe('the terminal application', () => {
  it('is absent until the Handler names one, so Handella picks', () => {
    const config = loadConfig({
      environment: {},
      rootDirectory: temporaryRoot(),
    })

    expect(config.terminalApp).toBeUndefined()
  })

  it('is a setting rather than an unknown key when it is in .env', () => {
    const root = temporaryRoot()
    const environmentPath = join(root, '.env')
    writeFileSync(environmentPath, 'HANDELLA_TERMINAL_APP=iTerm\n')
    chmodSync(environmentPath, 0o600)

    const config = loadConfig({ environment: {}, rootDirectory: root })

    expect(config.terminalApp).toBe('iTerm')
  })

  it('reads a blank value as no preference rather than as an empty name', () => {
    const config = loadConfig({
      environment: { HANDELLA_TERMINAL_APP: '   ' },
      rootDirectory: temporaryRoot(),
    })

    expect(config.terminalApp).toBeUndefined()
  })
})

describe('the optional Linear API key', () => {
  it('is absent when the Handler has not set one', () => {
    const config = loadConfig({
      environment: {},
      rootDirectory: temporaryRoot(),
    })

    expect(config.linearApiKey).toBeUndefined()
  })

  it('reads from a secure .env file', () => {
    const root = temporaryRoot()
    const environmentPath = join(root, '.env')
    writeFileSync(
      environmentPath,
      'HANDELLA_LINEAR_API_KEY=lin_api_from_file\n',
    )
    chmodSync(environmentPath, 0o600)

    const config = loadConfig({ environment: {}, rootDirectory: root })

    expect(config.linearApiKey).toBe('lin_api_from_file')
  })

  it('is not treated as an unknown key', () => {
    const root = temporaryRoot()
    const environmentPath = join(root, '.env')
    writeFileSync(
      environmentPath,
      'HANDELLA_LINEAR_API_KEY=lin_api_from_file\n',
    )
    chmodSync(environmentPath, 0o600)

    expect(() =>
      loadConfig({ environment: {}, rootDirectory: root }),
    ).not.toThrow()
  })

  it('lets the process environment win, as every other key does', () => {
    const root = temporaryRoot()
    const environmentPath = join(root, '.env')
    writeFileSync(
      environmentPath,
      'HANDELLA_LINEAR_API_KEY=lin_api_from_file\n',
    )
    chmodSync(environmentPath, 0o600)

    const config = loadConfig({
      environment: { HANDELLA_LINEAR_API_KEY: 'lin_api_from_process' },
      rootDirectory: root,
    })

    expect(config.linearApiKey).toBe('lin_api_from_process')
  })

  it('reads a blank value as not set up yet, rather than as a key', () => {
    const config = loadConfig({
      environment: { HANDELLA_LINEAR_API_KEY: '   ' },
      rootDirectory: temporaryRoot(),
    })

    expect(config.linearApiKey).toBeUndefined()
  })
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

describe('what the redactor is given', () => {
  it('takes Handella’s own secrets and the credentials it inherits', () => {
    const config = loadConfig({
      environment: {
        GITHUB_TOKEN: 'ghp_0123456789abcdef',
        HANDELLA_LINEAR_API_KEY: 'lin_api_0123456789',
        NPM_CONFIG_REGISTRY: 'https://registry.example.com',
      },
      rootDirectory: temporaryRoot(),
    })

    // The sandbox is handed the whole environment (ADR 0010), so a credential
    // Handella never asked for is still one it has to keep out of a log.
    expect(config.secretValues).toContain('lin_api_0123456789')
    expect(config.secretValues).toContain('ghp_0123456789abcdef')
    expect(config.secretValues).not.toContain('https://registry.example.com')
  })

  it('leaves a value too short to be told apart from ordinary text', () => {
    const config = loadConfig({
      environment: { GH_TOKEN: 'abc' },
      rootDirectory: temporaryRoot(),
    })

    expect(config.secretValues).toEqual([])
  })
})
