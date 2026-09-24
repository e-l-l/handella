import type { Job, LinearIssueSummary } from '@handella/contracts'

/**
 * What Handella says to Codex, and nothing about how it is said: no process,
 * no flags. Kept apart from the adapter because the same brief is typed into
 * an interactive session when Handella hands planning to the Handler, and a
 * brief that lived in the adapter would have to be reached through it.
 */

export interface PlanningBrief {
  issue: LinearIssueSummary
  job: Job
  runbook: string
}

export interface ImplementationBrief {
  job: Job
  runbook: string
}

export const describeIssue = (issue: LinearIssueSummary): string =>
  [
    `Issue: ${issue.identifier} — ${issue.title}`,
    `Linear: ${issue.url}`,
    '',
    issue.description ?? '(The issue has no description.)',
  ].join('\n')

/**
 * A first and only pass: the plan is a conversation the Handler reads and
 * answers in their terminal, so there is no revision for Handella to send. The
 * planner is asked to stop and wait, because the same session carries the
 * implementation once somebody says go.
 */
export const planningPrompt = (brief: PlanningBrief): string =>
  [
    'You are planning a change to this repository. Plan it; do not make it.',
    'Investigate as much as you need to — read files, run read-only commands —',
    'and propose the work rather than starting it. Do not edit anything and do',
    'not commit anything until the Handler tells you to.',
    '',
    describeIssue(brief.issue),
    '',
    'The plan will be implemented in this same session, by you, following this',
    'runbook. Plan the work itself; do not restate the procedure below.',
    '',
    '--- runbook ---',
    brief.runbook,
    '--- end runbook ---',
    '',
    `The work will be committed on the branch ${brief.job.canonicalBranch ?? '(unknown)'},`,
    `cut from ${brief.job.baseBranch}.`,
    '',
    'Read the repository before you plan. Name real files and real symbols; a',
    'step that names a file that does not exist is worse than a vague one. Say',
    'what you would change, in what order, how anyone could tell it worked, and',
    'what you are deliberately leaving out.',
    '',
    'Present the plan and wait for the Handler. They will read it here and',
    'answer here, or approve it from the dashboard.',
  ].join('\n')

/**
 * The turn that follows an approval. The plan is not quoted: it is already in
 * the session this turn resumes, and restating it would invite the agent to
 * plan again rather than build.
 */
export const implementationPrompt = (brief: ImplementationBrief): string =>
  [
    'The Handler approved the plan you proposed. Implement it now, in this',
    'worktree, following this runbook exactly. The plan is the work; the',
    'runbook is how work is done here, and it is the version this job approved',
    'against rather than whatever it says today.',
    '',
    '--- runbook ---',
    brief.runbook,
    '--- end runbook ---',
    '',
    `You are on the branch ${brief.job.canonicalBranch ?? '(unknown)'}, cut from`,
    `${brief.job.baseBranch}. Stay on it. The pull request targets ${brief.job.baseBranch}`,
    'and is opened ready for review, not as a draft.',
    '',
    'When the pull request is open, say so and stop. If you cannot finish, say',
    'what is left and stop: the Handler picks this session up from here.',
  ].join('\n')
