import { githubNotAuthenticated } from '../src/domain/errors.js'
import type {
  GitHubAdapter,
  PullRequestSummary,
} from '../src/adapters/github.js'

export interface FakeGitHubAdapter extends GitHubAdapter {
  /** Every branch this fake was asked about, in order. */
  readonly asked: string[]
  /** Whether `checkAuth` should refuse, for the pre-flight path. */
  authenticated: boolean
  /** The pull request each branch has, if any. */
  readonly pullRequests: Map<string, PullRequestSummary>
}

export const aPullRequest = (
  overrides: Partial<PullRequestSummary> = {},
): PullRequestSummary => ({
  baseRefName: 'dev',
  isDraft: false,
  state: 'OPEN',
  url: 'https://github.com/acme/monorepo/pull/41',
  ...overrides,
})

/**
 * Enough GitHub for the scheduler suite, which cares about what Handella does
 * with an answer rather than about `gh`. What `gh` actually says is proven
 * against the real binary in `github-cli.test.ts`.
 */
export function createFakeGitHubAdapter(
  options: { pullRequests?: Record<string, PullRequestSummary> } = {},
): FakeGitHubAdapter {
  const asked: string[] = []
  const pullRequests = new Map<string, PullRequestSummary>(
    Object.entries(options.pullRequests ?? {}),
  )

  const fake: FakeGitHubAdapter = {
    asked,
    authenticated: true,
    configured: true,
    pullRequests,

    async checkAuth() {
      if (!fake.authenticated) throw githubNotAuthenticated()
    },

    async findPullRequest(_repositoryPath, branch) {
      asked.push(branch)
      return pullRequests.get(branch) ?? null
    },
  }

  return fake
}
