import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { folderPickerUnavailable } from '../domain/errors.js'
import { isMissingCommand, stderrOf } from './command.js'
import type { FolderPicker } from './folders.js'

const run = promisify(execFile)

/**
 * Long enough that a Handler who went to look something up still finds their
 * dialog waiting, short enough that one they walked away from does not hold a
 * request open for the rest of the session.
 */
const dialogTimeoutMs = 5 * 60_000

/**
 * `POSIX path of` rather than the raw result: AppleScript answers a `choose`
 * with an HFS alias (`Macintosh HD:Users:ell:…`), and nothing above this deals
 * in anything but POSIX paths.
 */
const script =
  'POSIX path of (choose folder with prompt "Choose a checkout for Handella")'

/**
 * AppleScript's code for "the Handler pressed Cancel", stable across locales.
 * Matched in its parentheses rather than as a bare substring, which any other
 * failure's number could contain.
 */
const cancelled = /\(-128\)/

const openDialog = async (): Promise<string | null> => {
  let stdout: string
  try {
    // An argv array and no shell, on the same terms as the git adapter. The
    // script is a constant, and it stays one.
    ;({ stdout } = await run('osascript', ['-e', script], {
      timeout: dialogTimeoutMs,
    }))
  } catch (error) {
    if (isMissingCommand(error)) {
      throw folderPickerUnavailable(
        'osascript is not installed, so no folder dialog can be opened',
        error,
      )
    }

    // Cancelling is an answer. Matched on the number rather than on "User
    // canceled", which is the same event said in whatever language the
    // Handler runs their Mac in.
    if (cancelled.test(stderrOf(error))) return null

    throw folderPickerUnavailable(
      'The folder dialog could not be opened',
      new Error(stderrOf(error) || String(error), { cause: error }),
    )
  }

  // A folder's POSIX path comes back with a trailing slash, which every
  // `join` below this would then have to tolerate. Root keeps its own.
  const path = stdout.trim().replace(/(?!^)\/$/, '')
  return path === '' ? null : path
}

export const createFolderPicker = (): FolderPicker => {
  /**
   * One dialog at a time, whatever asks. There is one field to fill and one
   * Handler to fill it, so a second ask joins the window already in front of
   * them rather than stacking another on top of it — and each one it does not
   * open is a request not held for the five minutes the first one may take.
   */
  let open: Promise<string | null> | null = null

  return {
    choose() {
      if (open === null) {
        open = openDialog()
        // Cleared through a handled copy, so the rejection the callers see is
        // not also an unhandled one here.
        const reset = () => {
          open = null
        }
        void open.then(reset, reset)
      }
      return open
    },
  }
}
