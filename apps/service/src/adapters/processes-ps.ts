import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { commandEnv, isMissingCommand } from './command.js'
import type { ProcessDescription, ProcessInspector } from './processes.js'

const run = promisify(execFile)

const psEnv = commandEnv()

/**
 * `ps` prints the start time as five whitespace-separated fields — weekday,
 * month, day, time, year — and the day is space-padded for single digits, so
 * the split has to tolerate runs of whitespace rather than counting columns.
 * Everything after those five fields is the command.
 */
const startTimeFields = 5

/**
 * Not `cliRunner`: `ps` exits non-zero when no process holds the pid, and that
 * is the answer rather than a failure. Wrapping it would turn the ordinary
 * post-restart case into an error every caller had to unwrap.
 */
const parseDescription = (stdout: string): ProcessDescription | null => {
  const line = stdout.trim()
  if (line === '') return null

  const fields = line.split(/\s+/)
  if (fields.length <= startTimeFields) return null

  const startedAt = new Date(fields.slice(0, startTimeFields).join(' '))
  if (Number.isNaN(startedAt.getTime())) return null

  return { command: fields.slice(startTimeFields).join(' '), startedAt }
}

/**
 * Signals the process group led by `pid`.
 *
 * The negated pid is the whole convention, and it is what ADR 0012 is about:
 * a Codex pass is usually waiting on an `npm` or a `vitest` of its own, and
 * signalling Codex alone leaves that holding the worktree. Exported because
 * both things that stop a Codex reach for it — the pass that spawned it, which
 * holds the handle, and the reap, which has only a row — and one of them
 * having its own spelling of it is how the two drift apart.
 *
 * A group that has already gone is success: the caller wanted it stopped and
 * it is stopped. Anything else is raised, because it means the signal was not
 * delivered and the caller is the only one that knows what that costs.
 */
export const signalProcessGroup = (
  pid: number,
  signal: NodeJS.Signals,
): void => {
  try {
    process.kill(-pid, signal)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return
    throw error
  }
}

export const createProcessInspector = (): ProcessInspector => ({
  async describe(pid) {
    let stdout: string
    try {
      ;({ stdout } = await run(
        'ps',
        ['-o', 'lstart=,command=', '-p', String(pid)],
        { env: psEnv },
      ))
    } catch (error) {
      // A missing `ps` is worth saying out loud, because it means the reap
      // cannot check identity and so will refuse to signal anything at all.
      if (isMissingCommand(error)) {
        throw new Error('ps is not installed or is not on PATH', {
          cause: error,
        })
      }
      // Anything else is `ps` telling us nothing holds the pid.
      return null
    }

    return parseDescription(stdout)
  },

  terminateGroup: signalProcessGroup,
})
