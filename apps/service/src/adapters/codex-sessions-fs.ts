import { existsSync, realpathSync } from 'node:fs'
import { open, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { codexSessionIdShape } from '@handella/contracts'

import type {
  CodexSessions,
  DiscoverSessionsInput,
  DiscoveredSession,
  RolloutChunk,
} from './codex-sessions.js'

/**
 * Codex's rollouts, as they sit on this machine: one JSONL per session under
 * `~/.codex/sessions/<yyyy>/<mm>/<dd>/rollout-<timestamp>-<session id>.jsonl`,
 * moved to `archived_sessions` when the Handler archives a thread.
 *
 * The only module that knows any of that. Everything above it deals in lines
 * and byte offsets, so a Codex that keeps its sessions somewhere else is a new
 * file beside this one (docs/adr/0015).
 */

/** How much of a rollout is read to find its first line. */
const firstLineBytes = 16 * 1024

const codexHome = (): string =>
  process.env['CODEX_HOME'] ?? join(homedir(), '.codex')

/** Both places a rollout can be: the live sessions, and what was archived. */
const rolloutRoots = (): string[] => [
  join(codexHome(), 'sessions'),
  join(codexHome(), 'archived_sessions'),
]

/**
 * The path with every symlink resolved, or the path itself when there is
 * nothing on disk to resolve. Codex writes the cwd as the operating system
 * gave it — a worktree under `/var` on macOS comes back under `/private/var` —
 * while Handella holds the path as it spelled it when it cut the worktree.
 */
const resolved = (path: string): string => {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

const directoriesIn = async (path: string): Promise<string[]> => {
  try {
    const entries = await readdir(path, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

const rolloutsIn = async (path: string): Promise<string[]> => {
  try {
    const entries = await readdir(path, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

/**
 * Every `<year>/<month>/<day>` directory under a root, newest first.
 *
 * Newest first because both callers want the recent end: a session Handella is
 * following was opened minutes ago, and one it is discovering was opened
 * since it began looking. The names sort lexically because Codex zero-pads
 * them, so no date is parsed to get the order.
 */
const dayDirectories = async (root: string): Promise<string[]> => {
  const days: string[] = []

  for (const year of (await directoriesIn(root)).sort().reverse()) {
    const yearPath = join(root, year)
    for (const month of (await directoriesIn(yearPath)).sort().reverse()) {
      const monthPath = join(yearPath, month)
      for (const day of (await directoriesIn(monthPath)).sort().reverse()) {
        days.push(join(monthPath, day))
      }
    }
  }

  return days
}

/** The first line of a file, without reading the rest of it. */
const firstLineOf = async (path: string): Promise<string | undefined> => {
  let handle
  try {
    handle = await open(path, 'r')
    const buffer = Buffer.alloc(firstLineBytes)
    const { bytesRead } = await handle.read(buffer, 0, firstLineBytes, 0)
    const text = buffer.subarray(0, bytesRead).toString('utf8')
    const newline = text.indexOf('\n')
    return newline === -1 ? undefined : text.slice(0, newline)
  } catch {
    return undefined
  } finally {
    await handle?.close()
  }
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined

/**
 * A session's own account of itself, from the `session_meta` every rollout
 * opens with — or nothing, for a line that is not one or does not parse.
 */
const sessionMeta = (
  line: string,
):
  | { cwd: string; sessionId: string; source: string; startedAt: Date }
  | undefined => {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return undefined
  }

  const record = asRecord(parsed)
  if (record?.['type'] !== 'session_meta') return undefined

  const payload = asRecord(record['payload'])
  if (payload === undefined) return undefined

  const sessionId = payload['id']
  const cwd = payload['cwd']
  // An object rather than a string here is a sub-agent's thread, which carries
  // its parent's working directory and is nobody's to adopt.
  const source = payload['source']
  if (
    typeof sessionId !== 'string' ||
    typeof cwd !== 'string' ||
    typeof source !== 'string'
  ) {
    return undefined
  }

  const timestamp = payload['timestamp'] ?? record['timestamp']
  const startedAt = new Date(typeof timestamp === 'string' ? timestamp : 0)

  return {
    cwd,
    sessionId,
    source,
    startedAt: Number.isNaN(startedAt.getTime()) ? new Date(0) : startedAt,
  }
}

export const createCodexSessions = (): CodexSessions => ({
  // Asked each time rather than once at startup: a Handler who has just
  // upgraded Codex should not have to restart Handella to be followed again.
  get available(): boolean {
    return existsSync(join(codexHome(), 'sessions'))
  },

  async locateRollout(sessionId) {
    // The id becomes a filename suffix, so it is checked before it becomes
    // one: a `/` in it would search a directory Handella never meant to.
    if (!codexSessionIdShape.test(sessionId)) return null

    const suffix = `-${sessionId}.jsonl`
    for (const root of rolloutRoots()) {
      for (const day of await dayDirectories(root)) {
        const found = (await rolloutsIn(day)).find((name) =>
          name.endsWith(suffix),
        )
        if (found !== undefined) return join(day, found)
      }
    }

    return null
  },

  async readFrom(path, offset) {
    let handle
    try {
      handle = await open(path, 'r')
      const { size } = await handle.stat()

      // Shorter than where the last read ended: this is not the file that
      // offset was measured against, so nothing about it can be resumed.
      if (size < offset) {
        return { lines: [], nextOffset: 0, truncated: true }
      }
      if (size === offset) {
        return { lines: [], nextOffset: offset, truncated: false }
      }

      const length = size - offset
      const buffer = Buffer.alloc(length)
      const { bytesRead } = await handle.read(buffer, 0, length, offset)
      const text = buffer.subarray(0, bytesRead).toString('utf8')

      // Only what is terminated. Codex is appending while this reads, so the
      // tail is as likely as not to be half a record.
      const lastNewline = text.lastIndexOf('\n')
      if (lastNewline === -1) {
        return { lines: [], nextOffset: offset, truncated: false }
      }

      const complete = text.slice(0, lastNewline)
      return {
        lines: complete.split('\n').filter((line) => line !== ''),
        nextOffset: offset + Buffer.byteLength(complete, 'utf8') + 1,
        truncated: false,
      }
    } catch {
      // The file has gone, or cannot be read. Either is the caller's to notice
      // by locating it again, not this adapter's to raise.
      return { lines: [], nextOffset: offset, truncated: false }
    } finally {
      await handle?.close()
    }
  },

  async discoverSessions(input: DiscoverSessionsInput) {
    const wanted = resolved(input.cwd)
    const found: DiscoveredSession[] = []

    // The live sessions only: a thread the Handler has already archived is not
    // one they have just opened to plan in.
    for (const day of await dayDirectories(join(codexHome(), 'sessions'))) {
      for (const name of await rolloutsIn(day)) {
        const path = join(day, name)

        // The cheap filter first: a session opened before Handella started
        // looking cannot be the one it is waiting for, and the file's own
        // mtime rules most of them out without being read.
        try {
          const { mtimeMs } = await stat(path)
          if (mtimeMs < input.since.getTime()) continue
        } catch {
          continue
        }

        const line = await firstLineOf(path)
        if (line === undefined) continue

        const meta = sessionMeta(line)
        if (meta === undefined) continue
        // `cli` is the Handler sitting in a terminal. `exec` is Handella's own
        // pass, and anything else is a client that is not this.
        if (meta.source !== 'cli') continue
        if (meta.startedAt.getTime() <= input.since.getTime()) continue
        if (resolved(meta.cwd) !== wanted) continue

        found.push({
          cwd: meta.cwd,
          path,
          sessionId: meta.sessionId,
          startedAt: meta.startedAt,
        })
      }
    }

    // Oldest first: the session the Handler opened when they were asked to is
    // the first one, and anything after it is a second window.
    return found.sort(
      (left, right) => left.startedAt.getTime() - right.startedAt.getTime(),
    )
  },
})

export type { RolloutChunk }
