import { execFileSync } from 'node:child_process'
import { accessSync, constants, writeFileSync } from 'node:fs'
import { delimiter, join } from 'node:path'

import { PlanContentSchema } from '@handella/contracts'
import { Check } from 'typebox/value'
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
    it('plans read-only and answers with a plan that validates', async () => {
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

      expect(Check(PlanContentSchema, result.content)).toBe(true)
      expect(result.sessionId).toMatch(/\S/)
      expect(result.content.steps.length).toBeGreaterThan(0)

      // The revision, in the session the first pass ran in. Worth the second
      // pass: `codex exec resume` takes a different set of flags, and a fake
      // that ignores flags cannot tell whether these are the right ones.
      const revised = await adapter.plan({
        ...request,
        feedback: 'Say "Good evening" after six as well.',
        sessionId: result.sessionId,
      })

      expect(Check(PlanContentSchema, revised.content)).toBe(true)
      // The same conversation, which is what makes it a revision.
      expect(revised.sessionId).toBe(result.sessionId)

      // Read-only means the worktree it planned in is exactly as it was.
      const status = execFileSync('git', ['status', '--porcelain'], {
        cwd: worktree,
        encoding: 'utf8',
      })
      expect(status.trim()).toBe('')
    }, 1_200_000)
  },
)
