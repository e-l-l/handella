import { execFile } from 'node:child_process'
import { accessSync, constants } from 'node:fs'
import { delimiter, join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

/**
 * What `execFile` rejects with, as far as anything here needs it: `code` is
 * `ENOENT` when the binary was never found and the exit status when it ran and
 * failed, and `stderr` is whatever it said on the way out.
 */
interface CommandFailure {
  code?: string | number
  stderr?: string
}

/** The tool is not installed, as opposed to installed and unhappy. */
export const isMissingCommand = (error: unknown): boolean =>
  (error as CommandFailure).code === 'ENOENT'

/**
 * The tool's own text. It is the only thing that makes a failure diagnosable,
 * and it is what every adapter wraps rather than the rejection itself.
 */
export const stderrOf = (error: unknown): string =>
  ((error as CommandFailure).stderr ?? '').trim()

/**
 * Whether a binary is there, asked the way a shell asks.
 *
 * Live rather than cached at startup: a Handler who installs a tool because the
 * status page told them to should not have to restart Handella to be told they
 * succeeded.
 */
export const onPath = (name: string): boolean => {
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    if (directory === '') continue
    try {
      accessSync(join(directory, name), constants.X_OK)
      return true
    } catch {
      // Not here; the next entry is not an error either.
    }
  }
  return false
}

/**
 * The environment an adapter's child runs under. `LC_ALL` because a localised
 * failure is not something error mapping can read. Built once per adapter: it
 * is a full copy of the environment and identical on every invocation.
 */
export const commandEnv = (
  extra: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv => ({ ...process.env, LC_ALL: 'C', ...extra })

/**
 * `execFile` with an argv array and no shell, and the error mapping every
 * adapter wants around it. Branch names come from Linear and paths from the
 * Handler, and neither may ever reach a command string.
 */
export const cliRunner =
  (
    binary: string,
    unavailable: (message: string, cause?: unknown) => Error,
    env: NodeJS.ProcessEnv,
  ) =>
  async (cwd: string, args: readonly string[]): Promise<{ stdout: string }> => {
    try {
      return await run(binary, [...args], { cwd, env })
    } catch (error) {
      if (isMissingCommand(error)) {
        throw unavailable(`${binary} is not installed or is not on PATH`, error)
      }
      throw unavailable(
        `${binary} ${args[0] ?? ''} failed in ${cwd}`.trim(),
        new Error(stderrOf(error) || String(error), { cause: error }),
      )
    }
  }
