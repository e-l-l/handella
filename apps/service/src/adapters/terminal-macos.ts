import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { codexSessionIdShape } from '@handella/contracts'

import { terminalUnavailable } from '../domain/errors.js'
import { isMissingCommand, stderrOf } from './command.js'
import type { TerminalOpener, TerminalRequest } from './terminal.js'

const run = promisify(execFile)

/**
 * Long enough for a terminal that has to launch from cold, short enough that a
 * window the Handler will never see does not hold a request open.
 */
const launchTimeoutMs = 20_000

/** The three places macOS keeps applications, in the order it looks. */
const applicationDirectories = [
  '/Applications',
  join(homedir(), 'Applications'),
  '/System/Applications/Utilities',
]

/**
 * Which terminal gets the window, in the order they are preferred. Terminal
 * last because it is the one that is always installed, which makes it the
 * floor rather than a choice.
 *
 * Asked of the filesystem rather than of Launch Services: `osascript`
 * resolving an application by name can put a chooser dialog in front of
 * someone when the name is unknown, and a probe that opens a window is not a
 * probe.
 *
 * Both of these take a document and make one window of it. A terminal that has
 * to be told how to build a window instead is not listed here: Ghostty was
 * driven that way and the telling arrived as a second window, which is the one
 * thing "open the terminal" must not do. docs/adr/0011 records the trade.
 */
const preferenceOrder = ['iTerm', 'Terminal'] as const

const isInstalled = (application: string): boolean =>
  applicationDirectories.some((directory) =>
    existsSync(join(directory, `${application}.app`)),
  )

/**
 * The Handler's spelling, answered with Handella's own wherever it names one
 * of the terminals above.
 *
 * macOS filesystems are case-insensitive by default, so `iterm` finds
 * `iTerm.app` and passes the installed check whatever case it was typed in.
 * What this decides is the spelling everything downstream says: the name
 * `open -a` is handed and the name a refusal quotes back. A name that is not
 * one of these is left as it was typed, because `open -a` is what it will get
 * either way.
 */
export const canonicalNameFor = (application: string): string =>
  preferenceOrder.find(
    (known) => known.toLowerCase() === application.toLowerCase(),
  ) ?? application

const checkSessionId = (sessionId: string): void => {
  if (!codexSessionIdShape.test(sessionId)) {
    throw terminalUnavailable(
      'That job’s Codex session id is not a shape Handella will hand to Codex',
    )
  }
}

/**
 * The launcher a terminal that takes documents is handed instead of a folder.
 *
 * Terminal.app and iTerm both open a directory as a shell standing in it and
 * neither can be told to run something, so a resumed session has to arrive as
 * a file they can run. The text of it is a constant: the two values it needs
 * are read out of files beside it rather than written into it, which is how
 * this keeps the rule the `argv` arrays elsewhere keep.
 *
 * The directory is removed once Codex exits rather than up front — an open
 * file descriptor outlives the unlink, so the shell reads the rest of itself
 * from a file that is already gone. Then a login shell, so quitting Codex
 * leaves the Handler in the Worktree rather than closing the window.
 *
 * The trap is every other way out: a read that failed, or the Handler closing
 * the window while Codex is still running. It cannot cover the last line —
 * `exec` replaces the shell and takes the trap with it — which is why the
 * removal is also written out before it.
 */
const launcherScript = [
  '#!/bin/sh',
  '# Written by Handella to open a Codex session. Safe to delete.',
  'dir=$(dirname "$0")',
  'trap \'rm -rf "$dir"\' EXIT HUP INT TERM',
  'cwd=$(cat "$dir/cwd") || exit 1',
  'session=$(cat "$dir/session") || exit 1',
  'cd "$cwd" || exit 1',
  'codex resume "$session"',
  'rm -rf "$dir"',
  'exec "${SHELL:-/bin/sh}" -l',
  '',
].join('\n')

const writeLauncher = (cwd: string, sessionId: string): string => {
  const directory = mkdtempSync(join(tmpdir(), 'handella-terminal-'))
  const launcher = join(directory, 'open-session')
  writeFileSync(join(directory, 'cwd'), cwd, { mode: 0o600 })
  writeFileSync(join(directory, 'session'), sessionId, { mode: 0o600 })
  writeFileSync(launcher, launcherScript, { mode: 0o700 })
  return launcher
}

/**
 * The whole of how a window is opened: a terminal handed a document, which is
 * the Worktree for a Job with no session yet and the launcher above for one
 * that has. An argv array and no shell, on the same terms as every other
 * adapter here.
 *
 * One document, so one window. Nothing here activates the application first:
 * `open` brings it forward on its own, and asking for that separately is what
 * left a bare window standing beside the one the Handler asked for.
 */
const openWithOpen = async (
  application: string,
  request: TerminalRequest,
): Promise<void> => {
  const document =
    request.sessionId === null
      ? request.path
      : writeLauncher(request.path, request.sessionId)

  await run('open', ['-a', application, document], {
    timeout: launchTimeoutMs,
  })
}

interface TerminalOptions {
  /**
   * The application the Handler named, if they named one. Tried alone rather
   * than first: someone who set this and misspelled it should be told so,
   * rather than quietly given Terminal.app.
   */
  preferred?: string | undefined
}

/**
 * Which terminal this window opens in, or why none can.
 *
 * Asked per call rather than at startup, for the reason `onPath` is: a
 * Handler who installs a terminal because Handella said it had none should
 * not have to restart to be told they succeeded.
 *
 * Each refusal lives in the branch that can reach it. A search of the
 * preference order has already proved what it found is installed, and only a
 * name the Handler typed can be a name of something that is not there.
 */
const chooseTerminal = (preferred: string | undefined): string => {
  if (preferred === undefined) {
    const found = preferenceOrder.find(isInstalled)
    if (found === undefined) {
      throw terminalUnavailable(
        `No terminal Handella knows how to open is installed (looked for ${preferenceOrder.join(', ')})`,
      )
    }
    return found
  }

  const named = canonicalNameFor(preferred)
  if (!isInstalled(named)) {
    throw terminalUnavailable(
      `HANDELLA_TERMINAL_APP names ${named}, which is not installed`,
    )
  }
  return named
}

export const createTerminalOpener = (
  options: TerminalOptions = {},
): TerminalOpener => ({
  async open(request) {
    // Checked before anything is launched, so a bad id is reported as itself
    // rather than as the terminal having failed to open.
    if (request.sessionId !== null) checkSessionId(request.sessionId)

    const chosen = chooseTerminal(options.preferred)

    try {
      await openWithOpen(chosen, request)
    } catch (error) {
      if (isMissingCommand(error)) {
        throw terminalUnavailable(
          'open is not installed, so no terminal can be opened',
          error,
        )
      }

      throw terminalUnavailable(
        `${chosen} could not be opened at ${request.path}`,
        new Error(stderrOf(error) || String(error), { cause: error }),
      )
    }
  },
})
