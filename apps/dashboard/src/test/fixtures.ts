import type {
  Attempt,
  Job,
  Milestone,
  PlanVersion,
  Repository,
  RunbookVersion,
  StatusResponse,
} from '@handella/contracts'

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
  integrations: {
    linear: { configured: true },
    codex: { configured: true },
    github: { configured: true },
  },
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

export const anAttempt = (overrides: Partial<Attempt> = {}): Attempt => ({
  id: 'aaaaaaaa-e89b-42d3-a456-426614174000',
  jobId: '123e4567-e89b-42d3-a456-426614174000',
  round: 1,
  attempt: 1,
  codexSessionId: 'session-1',
  startedAt: '2026-09-18T10:05:00.000Z',
  endedAt: null,
  outcome: null,
  report: null,
  failureReason: null,
  ...overrides,
})

export const aMilestone = (overrides: Partial<Milestone> = {}): Milestone => ({
  id: 'bbbbbbbb-e89b-42d3-a456-426614174000',
  jobId: '123e4567-e89b-42d3-a456-426614174000',
  attemptId: 'aaaaaaaa-e89b-42d3-a456-426614174000',
  seq: 0,
  kind: 'command',
  summary: 'npm test',
  detail: null,
  exitCode: 0,
  occurredAt: '2026-09-18T10:06:00.000Z',
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

export const aRunbookVersion = (
  overrides: Partial<RunbookVersion> = {},
): RunbookVersion => ({
  id: '5c6d7e8f-9a0b-4c1d-8e2f-3a4b5c6d7e8f',
  version: 1,
  content: 'Run the suite. Open a pull request.',
  createdAt: '2026-09-18T09:00:00.000Z',
  ...overrides,
})

export const aPlanVersion = (
  overrides: Partial<PlanVersion> = {},
): PlanVersion => ({
  id: '7e8f9a0b-1c2d-4e3f-8a4b-5c6d7e8f9a0b',
  jobId: '123e4567-e89b-42d3-a456-426614174000',
  revision: 1,
  content: {
    summary: 'Make the login test wait for the session cookie.',
    steps: [
      {
        id: 'await-cookie',
        title: 'Await the session cookie before asserting',
        detail: 'The assertion races the redirect.',
        files: ['test/login.test.ts'],
        required: true,
      },
    ],
    verification: ['npm test -- login'],
    risks: [],
    outOfScope: [],
  },
  feedback: null,
  approvalState: 'pending',
  approvedAt: null,
  createdAt: '2026-09-18T09:00:00.000Z',
  ...overrides,
})
