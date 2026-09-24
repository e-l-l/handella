# Local Engineering Orchestrator

## Summary

Build a single-user, local TypeScript application that turns Linear issues, forwarded Slack conversations, and ad hoc requests into supervised Codex jobs.

The dashboard is the command center for classification, plan approval, attention items, queue ordering, progress, and PR outcomes. Codex uses the existing local CLI configuration and skills. The system never merges implementation PRs, deploys code, or manages Linear workflow states.

Success means reducing hands-on coordination time by at least 50%, measured across an initial baseline and the first month of use.

## Architecture and Contracts

- Use a TypeScript workspace with:
  - React/Vite dashboard.
  - Fastify local service bound only to `127.0.0.1`.
  - SQLite in WAL mode with Drizzle migrations.
  - REST actions plus server-sent events for live milestones.
  - Slack Bolt in Socket Mode.
  - `@linear/sdk`, GitHub CLI, Git, and the local Codex CLI.
- Start the application manually with one command; no login service or hosted component.
- Store Slack and Linear secrets in an external, Git-ignored `.env` with owner-only permissions. Reuse existing GitHub and Codex CLI authentication.
- Define these core records:
  - `Job`: source, Linear issue, canonical branch, selected base branch, work class, state, queue priority, worktree, Codex session, original PR, and timestamps.
  - `Attempt`: the one unattended implementation turn Handella takes, how it ended, and where its log is.
  - `RunbookSnapshot`: immutable copy of the dashboard-managed runbook used by that job.
  - `AttentionItem`: plan approval, blocker, disputed review, conflict proposal, ready PR, failure, orphaned worktree, or a handoff to your terminal.
  - `ReviewRound`: review comments, agent verdicts, child branch, and child PR.
- Implement typed adapters:
  - Linear: list assigned actionable issues, create issues, and fetch canonical branch names.
  - Slack: capture forwarded messages and threads, render previews, and send DMs.
  - Codex: plan, resume sessions, execute, parse JSONL milestones, pause, and recover.
  - GitHub: create PRs, inspect checks/reviews/conflicts, create child PRs, and post replies.
- Persist full context and logs for 30 days, then delete detailed Slack content, transcripts, and logs while retaining lightweight metadata and links. Redact configured secret values from stored output.

## Workflow

- Intake:
  - Dashboard shows your assigned actionable Linear issues with search and filters.
  - Multi-selection is supported, but each issue is classified, planned, approved, and executed independently.
  - Ad hoc work uses a dashboard quick-create flow that creates a Linear issue before dispatch.
  - Slack capture begins by forwarding a message to the bot. The bot fetches the full accessible thread plus your note and presents an editable preview containing title, summary, acceptance criteria, team/project defaults, priority, Feature/Routine suggestion, and base branch.
  - Slack offers “Create only” and “Create and dispatch.” Linear descriptions contain a concise synthesis and Slack permalink, not a transcript dump.
- Dispatch:
  - AI proposes Feature or Routine and you confirm or change it.
  - Base branch defaults to `dev` but is selectable per job.
  - Dispatch blocks if Linear does not provide its canonical branch name or if that branch is already owned by an unknown job.
  - Create an isolated worktree from the latest selected remote base using Linear’s exact branch name.
- Planning:
  - Jobs run Codex in the worktree and propose a plan inside the Codex session. You read it in a terminal and answer it there, or press Approve in the dashboard once you have; approving freezes the runbook snapshot and continues the same session into implementation (ADR 0015).
  - An issue that leans on a video is not planned unattended: the job is held, and "Open session" starts Codex on the planning brief so you can supply a local path to the recording (ADR 0017).
  - Feature jobs additionally invoke `/grill-with-docs` in that session, and their glossary and ADR edits are made in the feature worktree and included in the implementation PR.
- Execution:
  - Run at most three jobs concurrently.
  - Queue order is manually adjustable, with FIFO as the fallback.
  - Codex inherits the user’s local model, reasoning, skills, hooks, sandbox and configuration; Handella overrides only approval prompts, desktop notifications and network access (ADR 0016).
  - Execute the immutable runbook snapshot. Handella takes one unattended turn: the job reaches PR open only when GitHub shows an open pull request on its canonical branch, and anything short of that hands the session back to you (ADR 0015).
  - Stopping a job pauses it and preserves its session, branch, worktree, and logs. After an app or machine restart, active jobs become Interrupted and require manual resume.
- Pull requests:
  - Open one ready-for-review PR per Linear issue and link the issue.
  - Do not update Linear states or progress comments; the existing Linear/GitHub integration owns lifecycle transitions through the canonical branch name.
  - Monitor GitHub checks. In-scope failures receive up to two automatic repair cycles on the original PR branch; material scope changes pause for approval.
  - A merge conflict produces a proposed resolution plan and waits for approval before changing the original branch.
  - Review comments are evaluated rather than blindly accepted. Accepted comments from one review round are grouped into a child branch based on the original PR head and a child PR targeting the original PR branch.
  - Disputed comments create an attention item with evidence and a suggested reply, but no child PR.
  - After a child PR merges, reply to the corresponding original threads with the child PR and commit references, but do not resolve the threads.
  - Only the user may merge the original PR. After that merge is confirmed, remove its worktree safely and retain job metadata.
- Experience:
  - Home screen prioritizes attention items, with queued and running jobs summarized underneath.
  - Job pages show structured milestones with expandable raw logs.
  - Slack DMs are limited to required decisions, ready PRs/child PRs, and unrecoverable failures.

## Delivery Plan

1. Ship the Linear/ad hoc → Routine plan approval → Codex worktree → ready GitHub PR loop, including the scheduler, runbook, persistence, pause/resume, and attention inbox.
2. Add Feature routing and terminal-based `/grill-with-docs` in the job's own session.
3. Add Slack Socket Mode capture, editable issue previews, Create/Create-and-dispatch, and actionable DMs.
4. Add GitHub check repair, conflict proposals, review evaluation, child PRs, retention cleanup, and workflow metrics.

## Test and Acceptance Plan

- Unit-test the job state machine, three-slot scheduler, queue reordering, session watching, retention, branch collision handling, and runbook version snapshots.
- Contract-test Linear, Slack, Codex JSONL/session resume, Codex session rollouts, Git/GitHub, process interruption, and restart recovery using deterministic fakes.
- Run labeled end-to-end tests against the real Slack workspace, Linear workspace, and GitHub repository; cleanup remains explicit.
- Cover these acceptance scenarios:
  - Routine Linear issue reaches a ready PR after one plan approval, whether approved in the dashboard or in the terminal.
  - An issue carrying a video is held for you to plan in a terminal, and Handella follows the session you open.
  - Feature issue completes the terminal interview and includes design documents in the PR.
  - Forwarded Slack thread creates and optionally dispatches a correctly linked Linear issue.
  - Missing Linear branch, inaccessible Slack thread, runbook failure, crash, CI failure, merge conflict, accepted review, and disputed review all enter the correct attention state.
  - No workflow can merge the original PR, deploy, bypass the Codex sandbox, or mutate Linear lifecycle states.
- Measure active coordination time for at least ten comparable baseline issues and ten orchestrated issues; v1 is successful at a 50% or greater median reduction.

## Assumptions

- V1 is macOS-only, single-user, local-first, and initially manages one primary repository.
- GitHub is the only Git host.
- Slack custom-app installation and Linear personal API-key access are available.
- Slack can only import threads visible to the bot; inaccessible threads block the preview with corrective instructions.
- The runbook is versioned in dashboard settings and snapshotted into each job.
- Model choice and reasoning effort inherit the existing local Codex configuration.
- Team accounts, cloud runners, native Linear buttons, automatic original-PR merging, deployment, and direct Linear status management are out of scope.
