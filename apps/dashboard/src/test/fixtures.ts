import type { Job, Repository, StatusResponse } from '@handella/contracts'

/**
 * The records more than one suite needs, typed against the contracts so a
 * field added there fails the build here rather than leaving a fixture quietly
 * describing a response the service can no longer send.
 */

export const aStatus = (
  overrides: Partial<StatusResponse> = {},
): StatusResponse => ({
  status: 'ok',
  version: '0.1.0',
  startedAt: '2026-09-18T10:00:00.000Z',
  uptimeSeconds: 93,
  installation: {
    id: '123e4567-e89b-42d3-a456-426614174000',
    createdAt: '2026-09-18T09:00:00.000Z',
    lastStartedAt: '2026-09-18T10:00:00.000Z',
  },
  integrations: { linear: { configured: true } },
  database: { status: 'ok', journalMode: 'wal' },
  ...overrides,
})

export const aJob = (overrides: Partial<Job> = {}): Job => ({
  id: '123e4567-e89b-42d3-a456-426614174000',
  source: 'adhoc',
  title: 'Fix the flaky login test',
  workClass: 'routine',
  state: 'intake',
  suspension: null,
  linearIssueKey: null,
  linearIssueId: null,
  linearIssueUrl: null,
  repositoryId: null,
  canonicalBranch: 'ell/eng-412-fix-flaky-login-test',
  baseBranch: 'dev',
  queuePriority: null,
  worktreePath: null,
  codexSessionId: null,
  originalPrUrl: null,
  createdAt: '2026-09-18T10:00:00.000Z',
  updatedAt: '2026-09-18T10:00:00.000Z',
  ...overrides,
})

/** A job that came in through intake, so it carries its issue. */
export const aLinearJob = (overrides: Partial<Job> = {}): Job =>
  aJob({
    source: 'linear',
    linearIssueKey: 'ENG-412',
    linearIssueId: 'issue-412',
    linearIssueUrl: 'https://linear.app/acme/issue/ENG-412',
    ...overrides,
  })

export const aRepository = (
  overrides: Partial<Repository> = {},
): Repository => ({
  id: '9f1d2c3b-4a5e-4b6c-8d7e-0f1a2b3c4d5e',
  name: 'acme monorepo',
  path: '/Users/ell/workspace/work/monorepo',
  defaultBaseBranch: 'dev',
  createdAt: '2026-09-18T09:00:00.000Z',
  updatedAt: '2026-09-18T09:00:00.000Z',
  ...overrides,
})
