import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

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
 * Which terminal gets the window, in the order they are preferred. Ghostty
 * first because it is what this Handler uses; Terminal last because it is the
 * one that is always installed, which makes it the floor rather than a choice.
 *
 * Asked of the filesystem rather than of Launch Services: `osascript` resolving
 * an application by name can put a chooser dialog in front of someone when the
 * name is unknown, and a probe that opens a window is not a probe.
 */
const preferenceOrder = ['Ghostty', 'iTerm', 'Terminal'] as const

const isInstalled = (application: string): boolean =>
  applicationDirectories.some((directory) =>
    existsSync(join(directory, `${application}.app`)),
  )

/**
 * The Handler's spelling, answered with Handella's own wherever it names one
 * of the terminals above.
 *
 * macOS filesystems are case-insensitive by default, so `ghostty` finds
 * `Ghostty.app` and passes the installed check — and would then fail the
 * `=== 'Ghostty'` below and be handed to `open -a`, which is the one
 * launcher Ghostty cannot be given a worktree with. A name that is not one of
 * these is left as it was typed: `open -a` is what it will get either way.
 */
export const canonicalNameFor = (application: string): string =>
  preferenceOrder.find(
    (known) => known.toLowerCase() === application.toLowerCase(),
  ) ?? application

/**
 * What a session id may look like before it is allowed to become text.
 *
 * Every other value this adapter handles reaches its process as an `argv`
 * item, which is why the Git adapter's rule about never building a command
 * string holds everywhere else here. A resumed session cannot: Ghostty's
 * `initial input` is typed into a shell, so it is a command line by
 * construction. The session id comes from Codex's own `thread.started` event
 * and is a UUID or a `thr_`-style name, so the shape is narrow and worth
 * insisting on rather than escaping — an id with a space in it is Codex having
 * changed, not a string to quote.
 */
const sessionIdShape = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

const checkSessionId = (sessionId: string): void => {
  if (!sessionIdShape.test(sessionId)) {
    throw terminalUnavailable(
      'That job’s Codex session id is not a shape Handella will put on a command line',
    )
  }
}

/**
 * Ghostty opens a window through its AppleScript dictionary rather than
 * through `open`, because `open -a` hands an application a document and
 * Ghostty's document is not a directory: the working directory is a property
 * of the surface being created, so the surface has to be described.
 *
 * `on run argv` rather than an interpolated path. A worktree path is composed
 * from a Canonical Branch that arrives from Linear, and the reason the Git
 * adapter never builds a command string is the reason this never builds a
 * script string.
 *
 * `initial input` rather than `command`, because `command` replaces the shell
 * and the window then dies with the session. Typing the line leaves the
 * Handler standing in the Worktree when they quit Codex, which is the other
 * half of what they opened this for.
 */
const ghosttyScript = [
  'on run argv',
  '\tset target to item 1 of argv',
  '\ttell application "Ghostty"',
  '\t\tactivate',
  '\t\tset cfg to new surface configuration',
  '\t\tset initial working directory of cfg to target',
  '\t\tif (count of argv) > 1 then',
  '\t\t\tset initial input of cfg to item 2 of argv',
  '\t\tend if',
  '\t\tnew window with configuration cfg',
  '\tend tell',
  'end run',
].join('\n')

const openGhostty = async (request: TerminalRequest): Promise<void> => {
  await run(
    'osascript',
    [
      '-e',
      ghosttyScript,
      request.path,
      ...(request.sessionId === null
        ? []
        : [`codex resume ${request.sessionId}\n`]),
    ],
    { timeout: launchTimeoutMs },
  )
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
 * Everything else: a terminal that takes a folder as a document, which is what
 * Terminal.app and iTerm both are — or, for a Job with a session, the launcher
 * above. An argv array and no shell, on the same terms as every other adapter
 * here.
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
      if (chosen === 'Ghostty') {
        await openGhostty(request)
      } else {
        await openWithOpen(chosen, request)
      }
    } catch (error) {
      if (isMissingCommand(error)) {
        throw terminalUnavailable(
          'osascript and open are not installed, so no terminal can be opened',
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
