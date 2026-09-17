import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { buildApp } from '../src/app.js'
import type { StatusSource } from '../src/database/database.js'

const healthyStatusSource: StatusSource = {
  getStatus: () => ({
    id: '123e4567-e89b-42d3-a456-426614174000',
    createdAt: new Date('2026-09-18T09:00:00.000Z'),
    lastStartedAt: new Date('2026-09-18T10:00:00.000Z'),
    journalMode: 'wal',
  }),
}

const appsToClose: Array<ReturnType<typeof buildApp>> = []
const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(appsToClose.splice(0).map((app) => app.close()))
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
})

describe('Handella service', () => {
  it('returns the shared system status contract', async () => {
    const app = buildApp({
      startedAt: new Date('2026-09-18T10:00:00.000Z'),
      statusSource: healthyStatusSource,
      version: '0.1.0',
    })
    appsToClose.push(app)

    const response = await app.inject({ method: 'GET', url: '/api/status' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      status: 'ok',
      version: '0.1.0',
      database: { status: 'ok', journalMode: 'wal' },
      installation: {
        id: '123e4567-e89b-42d3-a456-426614174000',
      },
    })
  })

  it('returns a safe 503 when the database check fails', async () => {
    const app = buildApp({
      statusSource: {
        getStatus() {
          throw new Error('sensitive database detail')
        },
      },
      version: '0.1.0',
    })
    appsToClose.push(app)

    const response = await app.inject({ method: 'GET', url: '/api/status' })

    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual({
      status: 'error',
      code: 'database_unavailable',
      message: 'Database unavailable',
    })
    expect(response.body).not.toContain('sensitive database detail')
  })

  it('keeps missing API routes as JSON', async () => {
    const app = buildApp({
      statusSource: healthyStatusSource,
      version: '0.1.0',
    })
    appsToClose.push(app)

    const response = await app.inject({ method: 'GET', url: '/api/missing' })

    expect(response.statusCode).toBe(404)
    expect(response.headers['content-type']).toContain('application/json')
  })

  it('serves the SPA fallback for client-side routes', async () => {
    const dashboardPath = mkdtempSync(join(tmpdir(), 'handella-dashboard-'))
    temporaryDirectories.push(dashboardPath)
    writeFileSync(
      join(dashboardPath, 'index.html'),
      '<main>Handella shell</main>',
    )

    const app = buildApp({
      dashboardPath,
      statusSource: healthyStatusSource,
      version: '0.1.0',
    })
    appsToClose.push(app)
    const response = await app.inject({ method: 'GET', url: '/system' })

    expect(response.statusCode).toBe(200)
    expect(response.body).toContain('Handella shell')
  })
})
