import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createCodexSessions } from '../src/adapters/codex-sessions-fs.js'
import { aTemporaryDirectory, cleanupTestContexts } from './helpers.js'

const originalCodexHome = process.env['CODEX_HOME']

afterEach(async () => {
  if (originalCodexHome === undefined) delete process.env['CODEX_HOME']
  else process.env['CODEX_HOME'] = originalCodexHome
  await cleanupTestContexts()
})

let codexHome: string

beforeEach(() => {
  codexHome = aTemporaryDirectory('handella-codex-home-')
  process.env['CODEX_HOME'] = codexHome
})

interface SessionMeta {
  cwd?: string
  source?: unknown
  startedAt?: string
}

/**
 * A rollout where Codex would file it, opening with the `session_meta` every
 * rollout opens with.
 */
const aRollout = (
  day: string,
  sessionId: string,
  meta: SessionMeta = {},
  root = 'sessions',
): string => {
  const directory = join(codexHome, root, ...day.split('-'))
  mkdirSync(directory, { recursive: true })
  const path = join(directory, `rollout-${day}T00-00-00-${sessionId}.jsonl`)
  const startedAt = meta.startedAt ?? `${day}T12:00:00.000Z`
  writeFileSync(
    path,
    `${JSON.stringify({
      payload: {
        cwd: meta.cwd ?? '/repo',
        id: sessionId,
        source: meta.source ?? 'cli',
        timestamp: startedAt,
      },
      timestamp: startedAt,
      type: 'session_meta',
    })}\n`,
  )
  return path
}

describe('finding a session’s rollout', () => {
  it('finds it by its id, whichever day it was filed under', async () => {
    aRollout('2026-09-20', 'older')
    const wanted = aRollout('2026-09-24', 'wanted')

    expect(await createCodexSessions().locateRollout('wanted')).toBe(wanted)
  })

  it('finds one the Handler has archived', async () => {
    const archived = aRollout(
      '2026-09-24',
      'archived-one',
      {},
      'archived_sessions',
    )

    expect(await createCodexSessions().locateRollout('archived-one')).toBe(
      archived,
    )
  })

  it('answers with nothing for a session it has never seen', async () => {
    expect(await createCodexSessions().locateRollout('absent')).toBeNull()
  })

  it('refuses an id that is not a shape Handella will turn into a filename', async () => {
    // The id becomes a filename suffix, so a path separator in it would search
    // somewhere Handella never meant to.
    for (const id of ['../../etc/passwd', '-dash-first', 'has space', '']) {
      expect(await createCodexSessions().locateRollout(id)).toBeNull()
    }
  })

  it('reports no rollouts at all when Codex keeps none here', () => {
    // A fresh CODEX_HOME with no `sessions` directory: nothing to follow, and
    // nothing to throw about.
    expect(createCodexSessions().available).toBe(false)
    aRollout('2026-09-24', 'one')
    expect(createCodexSessions().available).toBe(true)
  })
})

describe('reading a rollout as it is written', () => {
  it('hands over complete lines and keeps the rest', async () => {
    const path = aRollout('2026-09-24', 'live')
    const sessions = createCodexSessions()

    const first = await sessions.readFrom(path, 0)
    expect(first.lines).toHaveLength(1)
    expect(first.truncated).toBe(false)

    // Codex is mid-write: the line has no newline yet.
    writeFileSync(path, '{"type":"event_msg","payl', { flag: 'a' })
    const partial = await sessions.readFrom(path, first.nextOffset)
    expect(partial.lines).toEqual([])
    expect(partial.nextOffset).toBe(first.nextOffset)

    // It lands, and the whole line arrives at once.
    writeFileSync(path, 'oad":{"type":"task_started"}}\n', { flag: 'a' })
    const complete = await sessions.readFrom(path, partial.nextOffset)
    expect(complete.lines).toEqual([
      '{"type":"event_msg","payload":{"type":"task_started"}}',
    ])
  })

  it('says so when the file is shorter than where it was read to', async () => {
    const path = aRollout('2026-09-24', 'replaced')

    const chunk = await createCodexSessions().readFrom(path, 100_000)

    expect(chunk).toMatchObject({ lines: [], nextOffset: 0, truncated: true })
  })

  it('answers an unreadable file with nothing rather than throwing', async () => {
    const chunk = await createCodexSessions().readFrom(
      join(codexHome, 'sessions', 'gone.jsonl'),
      0,
    )

    expect(chunk).toMatchObject({ lines: [], truncated: false })
  })
})

describe('discovering the session a Handler opened', () => {
  const since = new Date('2026-09-24T00:00:00.000Z')

  it('finds an interactive session started in the worktree since it began looking', async () => {
    aRollout('2026-09-24', 'theirs', {
      cwd: '/repo/worktree',
      startedAt: '2026-09-24T10:00:00.000Z',
    })

    const found = await createCodexSessions().discoverSessions({
      cwd: '/repo/worktree',
      since,
    })

    expect(found).toMatchObject([{ sessionId: 'theirs' }])
  })

  it('ignores a session Handella started itself', async () => {
    aRollout('2026-09-24', 'handellas', {
      cwd: '/repo/worktree',
      source: 'exec',
      startedAt: '2026-09-24T10:00:00.000Z',
    })

    expect(
      await createCodexSessions().discoverSessions({
        cwd: '/repo/worktree',
        since,
      }),
    ).toEqual([])
  })

  it('ignores a sub-agent, which carries its parent’s working directory', async () => {
    aRollout('2026-09-24', 'subagent', {
      cwd: '/repo/worktree',
      source: { subagent: { name: 'reviewer' } },
      startedAt: '2026-09-24T10:00:00.000Z',
    })

    expect(
      await createCodexSessions().discoverSessions({
        cwd: '/repo/worktree',
        since,
      }),
    ).toEqual([])
  })

  it('ignores another worktree, and anything opened before the hold began', async () => {
    aRollout('2026-09-24', 'elsewhere', {
      cwd: '/repo/other',
      startedAt: '2026-09-24T10:00:00.000Z',
    })
    aRollout('2026-09-24', 'earlier', {
      cwd: '/repo/worktree',
      startedAt: '2026-09-23T10:00:00.000Z',
    })

    expect(
      await createCodexSessions().discoverSessions({
        cwd: '/repo/worktree',
        since,
      }),
    ).toEqual([])
  })

  it('answers oldest first, so the session they were asked for is the first', async () => {
    aRollout('2026-09-24', 'second', {
      cwd: '/repo/worktree',
      startedAt: '2026-09-24T12:00:00.000Z',
    })
    aRollout('2026-09-24', 'first', {
      cwd: '/repo/worktree',
      startedAt: '2026-09-24T10:00:00.000Z',
    })

    const found = await createCodexSessions().discoverSessions({
      cwd: '/repo/worktree',
      since,
    })

    expect(found.map((session) => session.sessionId)).toEqual([
      'first',
      'second',
    ])
  })
})
