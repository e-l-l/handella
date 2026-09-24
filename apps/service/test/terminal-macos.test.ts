import { describe, expect, it } from 'vitest'

import {
  canonicalNameFor,
  createTerminalOpener,
  launcherScript,
} from '../src/adapters/terminal-macos.js'

/**
 * The real adapter puts a window in front of a person, so nothing here is
 * allowed to reach `open`. Every case is one the adapter refuses before it
 * launches anything, which is the half of it worth asserting anyway: the
 * session id check is the only guard on the one value that is read back out
 * of a file rather than passed straight through.
 */
const noSuchTerminal = 'HandellaNoSuchTerminal'

const worktreePath = '/Users/handler/.data/worktrees/acme/eng-412'
const sessionId = '0198f2c1-7a3e-7bd2-9f10-2c4a6b8e0d31'

const anOpener = () => createTerminalOpener({ preferred: noSuchTerminal })

describe('the terminal the Handler named', () => {
  it('answers a known terminal in Handella’s own spelling', () => {
    // macOS finds `iTerm.app` for either, so the case the Handler typed
    // decides nothing about whether it is installed — only how the name is
    // spelled back at them.
    expect(canonicalNameFor('ITERM')).toBe('iTerm')
    expect(canonicalNameFor('terminal')).toBe('Terminal')
  })

  it('leaves a terminal it has no name of its own for as it was typed', () => {
    expect(canonicalNameFor('WezTerm')).toBe('WezTerm')
    // Ghostty is one of those now. It is still openable by name, on the same
    // terms as any other: handed to `open` as a document, one window.
    expect(canonicalNameFor('Ghostty')).toBe('Ghostty')
  })

  it('is an error when it is not installed, rather than a quiet fallback', async () => {
    await expect(
      anOpener().open({ path: worktreePath, prompt: null, sessionId: null }),
    ).rejects.toMatchObject({
      code: 'terminal_unavailable',
      message: `HANDELLA_TERMINAL_APP names ${noSuchTerminal}, which is not installed`,
    })
  })
})

describe('a session id on its way to a command line', () => {
  const refused = [
    ['a space', 'thr_412 rm -rf /'],
    ['a separator', 'thr_412; open /Applications'],
    ['a substitution', '$(whoami)'],
    ['a backtick', '`whoami`'],
    ['a leading dash', '-rf'],
    ['nothing at all', ''],
    ['more than Codex has ever sent', 'a'.repeat(129)],
  ] as const

  it.each(refused)('refuses %s', async (_shape, candidate) => {
    await expect(
      anOpener().open({
        path: worktreePath,
        prompt: null,
        sessionId: candidate,
      }),
    ).rejects.toMatchObject({
      code: 'terminal_unavailable',
      message: expect.stringContaining('Codex session id'),
    })
  })

  it('is checked before a terminal is looked for, so a bad id reads as one', async () => {
    // Both are wrong here. The one reported is the id, because the id is
    // checked first — which is also what keeps a bad id from reaching a
    // window that has already opened.
    await expect(
      anOpener().open({
        path: worktreePath,
        prompt: null,
        sessionId: 'thr 412',
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining('Codex session id'),
    })
  })

  it('lets through the shape Codex actually sends', async () => {
    // Past the guard and refused for the terminal instead, which is the only
    // way to say "the id was fine" without opening a window.
    await expect(
      anOpener().open({ path: worktreePath, prompt: null, sessionId }),
    ).rejects.toMatchObject({
      message: expect.stringContaining(noSuchTerminal),
    })

    await expect(
      anOpener().open({
        path: worktreePath,
        prompt: null,
        sessionId: 'thr_01HZY8Q.v2-3',
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining(noSuchTerminal),
    })
  })
})

describe('the launcher a window is handed', () => {
  it('reads every value it needs out of a file, and interpolates none', () => {
    // The whole rule in one assertion: the script is a constant, so nothing a
    // Handler wrote in an issue — quotes, newlines, `$(…)` — can become part
    // of it. The brief and the session id arrive beside it (ADR 0011).
    expect(launcherScript).toContain('cwd=$(cat "$dir/cwd")')
    expect(launcherScript).toContain('prompt=$(cat "$dir/prompt")')
    expect(launcherScript).toContain('session=$(cat "$dir/session")')
    // One argv item each, so a brief with a space in it is still one argument.
    expect(launcherScript).toContain('codex "$prompt"')
    expect(launcherScript).toContain('codex resume "$session"')
  })

  it('chooses the brief or the session by which file is there', () => {
    expect(launcherScript).toContain('if [ -f "$dir/prompt" ]; then')
    expect(launcherScript).toContain('else')
    expect(launcherScript).toContain('fi')
  })
})

describe('a window that is asked to be two windows', () => {
  it('is refused before a terminal is even looked for', async () => {
    // A brief starts a conversation and a session id continues one; a caller
    // asking for both has not decided which window it wants.
    await expect(
      anOpener().open({
        path: worktreePath,
        prompt: 'Plan this.',
        sessionId,
      }),
    ).rejects.toMatchObject({
      code: 'terminal_unavailable',
      message: expect.stringContaining('not both'),
    })
  })
})
