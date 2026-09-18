import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  aTemporaryDirectory,
  buildTestApp,
  cleanupTestContexts,
  createTestContext,
} from './helpers.js'

afterEach(cleanupTestContexts)

describe('Handella service', () => {
  it('returns the shared system status contract', async () => {
    const { app } = await buildTestApp({
      startedAt: new Date('2026-09-18T10:00:00.000Z'),
    })

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
    const { app } = await buildTestApp({
      statusSource: {
        getStatus() {
          throw new Error('sensitive database detail')
        },
      },
    })

    const response = await app.inject({ method: 'GET', url: '/api/status' })

    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual({
      status: 'error',
      code: 'database_unavailable',
      message: 'Database unavailable',
    })
    expect(response.body).not.toContain('sensitive database detail')
  })

  it('reports an unhandled failure as an internal error, not a bad request', async () => {
    const context = createTestContext()
    const { app } = await buildTestApp({
      context,
      store: {
        ...context.store,
        listJobs() {
          throw new Error('sensitive internal detail')
        },
      },
    })

    const response = await app.inject({ method: 'GET', url: '/api/jobs' })

    expect(response.statusCode).toBe(500)
    expect(response.json()).toEqual({
      code: 'internal_error',
      message: 'Internal Server Error',
    })
    expect(response.body).not.toContain('sensitive internal detail')
  })

  it('keeps missing API routes as JSON', async () => {
    const { app } = await buildTestApp()

    const response = await app.inject({ method: 'GET', url: '/api/missing' })

    expect(response.statusCode).toBe(404)
    expect(response.headers['content-type']).toContain('application/json')
  })

  it('serves the SPA fallback for client-side routes', async () => {
    const dashboardPath = aTemporaryDirectory('handella-dashboard-')
    writeFileSync(
      join(dashboardPath, 'index.html'),
      '<main>Handella shell</main>',
    )

    const { app } = await buildTestApp({ dashboardPath })
    const response = await app.inject({ method: 'GET', url: '/system' })

    expect(response.statusCode).toBe(200)
    expect(response.body).toContain('Handella shell')
  })
})
