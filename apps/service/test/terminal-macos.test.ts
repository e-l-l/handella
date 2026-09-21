import { describe, expect, it } from 'vitest'

import {
  canonicalNameFor,
  createTerminalOpener,
} from '../src/adapters/terminal-macos.js'

/**
 * The real adapter puts a window in front of a person, so nothing here is
 * allowed to reach `osascript` or `open`. Every case is one the adapter
 * refuses before it launches anything, which is the half of it worth
 * asserting anyway: the session id check is the only guard on the one value
 * that becomes a command line.
 */
const noSuchTerminal = 'HandellaNoSuchTerminal'

const worktreePath = '/Users/handler/.data/worktrees/acme/eng-412'
const sessionId = '0198f2c1-7a3e-7bd2-9f10-2c4a6b8e0d31'

const anOpener = () => createTerminalOpener({ preferred: noSuchTerminal })

describe('the terminal the Handler named', () => {
  it('answers a known terminal in Handella’s own spelling', () => {
    // macOS finds `Ghostty.app` for either, so the case the Handler typed
    // decides nothing about whether it is installed — only about which
    // launcher it would otherwise be given.
    expect(canonicalNameFor('ghostty')).toBe('Ghostty')
    expect(canonicalNameFor('ITERM')).toBe('iTerm')
    expect(canonicalNameFor('terminal')).toBe('Terminal')
  })

  it('leaves a terminal it does not drive specially as it was typed', () => {
    expect(canonicalNameFor('WezTerm')).toBe('WezTerm')
  })

  it('is an error when it is not installed, rather than a quiet fallback', async () => {
    await expect(
      anOpener().open({ path: worktreePath, sessionId: null }),
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
      anOpener().open({ path: worktreePath, sessionId: candidate }),
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
      anOpener().open({ path: worktreePath, sessionId: 'thr 412' }),
    ).rejects.toMatchObject({
      message: expect.stringContaining('Codex session id'),
    })
  })

  it('lets through the shape Codex actually sends', async () => {
    // Past the guard and refused for the terminal instead, which is the only
    // way to say "the id was fine" without opening a window.
    await expect(
      anOpener().open({ path: worktreePath, sessionId }),
    ).rejects.toMatchObject({
      message: expect.stringContaining(noSuchTerminal),
    })

    await expect(
      anOpener().open({ path: worktreePath, sessionId: 'thr_01HZY8Q.v2-3' }),
    ).rejects.toMatchObject({
      message: expect.stringContaining(noSuchTerminal),
    })
  })
})
