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
