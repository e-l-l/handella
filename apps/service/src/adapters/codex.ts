import type { Job } from '@handella/contracts'

export interface PlanningRequest {
  job: Job
  /** Codex runs read-only in here. The worktree exists before this is called. */
  worktreePath: string
}

export interface PlanningResult {
  /** Opaque until Phase 5, which owns the structured plan's shape. */
  content: string
}

/**
 * The read-only planning pass. Phase 5 replaces the body behind this; Phase 4
 * ships the seam and a stub, so the scheduler it feeds is exercised rather than
 * asserted.
 */
export interface CodexAdapter {
  /** Whether a real Codex is behind this, so status can say so. */
  readonly configured: boolean
  plan(input: PlanningRequest): Promise<PlanningResult>
}

/**
 * What an installation without Phase 5 gets: a pass that does nothing and says
 * so. It completes rather than parking the job, because a slot that is claimed
 * and never released jams the scheduler after three dispatches and makes the
 * queue impossible to watch working.
 */
export const stubCodexAdapter: CodexAdapter = {
  configured: false,
  plan: ({ job, worktreePath }) =>
    Promise.resolve({
      content: [
        '# Placeholder plan',
        '',
        `Codex planning arrives in Phase 5. This job (${job.title}) has a`,
        `worktree at ${worktreePath} and is waiting for a real planning pass.`,
      ].join('\n'),
    }),
}
