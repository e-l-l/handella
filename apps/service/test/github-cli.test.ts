import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

import { createGitHubAdapter } from '../src/adapters/github-cli.js'

/**
 * Gated the way `codex-cli.test.ts` is gated: this talks to GitHub with the
 * Handler's own login, so it runs when a Handler asks it to and never in an
 * ordinary `npm test`. What the adapter does with an answer is proven with a
 * fake in `implementation.test.ts`; this proves the answer is what it expects.
 *
 * HANDELLA_GITHUB_E2E is the repository directory to ask about.
 */
const repositoryPath = process.env['HANDELLA_GITHUB_E2E']

describe.skipIf(repositoryPath === undefined)('the real gh', () => {
  it('finds the binary', () => {
    expect(createGitHubAdapter().configured).toBe(true)
  })

  it('accepts the Handler’s login', async () => {
    await expect(createGitHubAdapter().checkAuth()).resolves.toBeUndefined()
  })

  it('answers null for a branch with no pull request', async () => {
    const adapter = createGitHubAdapter()
    await expect(
      adapter.findPullRequest(
        repositoryPath ?? '',
        'handella/a-branch-that-does-not-exist',
      ),
    ).resolves.toBeNull()
  })

  it('reads the fields the verification asks about', async () => {
    const adapter = createGitHubAdapter()
    const head = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: repositoryPath ?? '',
      encoding: 'utf8',
    }).trim()

    const found = await adapter.findPullRequest(repositoryPath ?? '', head)

    if (found === null) return
    expect(found).toMatchObject({
      baseRefName: expect.any(String),
      isDraft: expect.any(Boolean),
      state: expect.any(String),
      url: expect.stringContaining('http'),
    })
  })
})
