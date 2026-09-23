import { execFileSync } from 'node:child_process'
import { accessSync, constants, writeFileSync } from 'node:fs'
import { delimiter, join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createCodexAdapter } from '../src/adapters/codex-cli.js'
import { aTemporaryDirectory, cleanupTestContexts } from './helpers.js'
import { aLinearIssue } from './linear-fake.js'
import { aDispatchableJob } from './helpers.js'

afterEach(cleanupTestContexts)

/**
 * Deliberately a second implementation rather than the adapter's own: asking
 * the module under test whether it agrees with itself would assert nothing.
 */
const codexOnPath = (): boolean => {
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    if (directory === '') continue
    try {
      accessSync(join(directory, 'codex'), constants.X_OK)
      return true
    } catch {
      // Keep looking.
    }
  }
  return false
}

describe('what the adapter reports about itself', () => {
  it('is configured exactly when the binary is installed', () => {
    expect(createCodexAdapter().configured).toBe(codexOnPath())
  })
})

/**
 * The real binary, on the same terms as `git-cli.test.ts`: a fake can prove
 * the ordering around a pass but not the flags, the JSONL, or that the sandbox
 * is where it was asked to be. Gated because a pass costs tokens and minutes,
 * which is not something `npm test` should spend without being asked.
 *
 *   HANDELLA_CODEX_E2E=1 npm test --workspace @handella/service
 */
describe.skipIf(process.env['HANDELLA_CODEX_E2E'] === undefined)(
  'a real planning pass',
  () => {
    it('opens a session and proposes a plan without committing anything', async () => {
      const worktree = aTemporaryDirectory('handella-codex-')
      execFileSync('git', ['init', '--quiet'], { cwd: worktree })
      writeFileSync(
        join(worktree, 'greet.js'),
        'export const greet = (name) => `Hello ${name}`\n',
      )
      execFileSync('git', ['add', '.'], { cwd: worktree })
      execFileSync(
        'git',
        ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init'],
        { cwd: worktree },
      )

      const adapter = createCodexAdapter()
      const request = {
        issue: aLinearIssue({
          description: 'greet() should say "Good morning" before noon.',
          title: 'Greet by time of day',
        }),
        job: { ...aDispatchableJob(), id: 'e2e' } as never,
        runbook: 'Run the tests. Open a pull request.',
        signal: AbortSignal.timeout(10 * 60_000),
        worktreePath: worktree,
      }

      const result = await adapter.plan(request)

      expect(result.sessionId).toMatch(/\S/)

      // Asked to plan and not to make: the planner runs under the Handler's
      // own sandbox now, so what is checked is that it did as it was told —
      // the history is one commit long, the same as before it ran.
      const commits = execFileSync('git', ['rev-list', '--count', 'HEAD'], {
        cwd: worktree,
        encoding: 'utf8',
      })
      expect(commits.trim()).toBe('1')
    }, 1_200_000)
  },
)
