# Build Phases

This roadmap divides the project described in `masterplan.md` into bounded build phases. Each phase should receive its own implementation plan when work begins; this document intentionally defines outcomes and boundaries rather than detailed tasks.

## Guiding constraints

These apply to every phase:

- The application remains local-first, single-user, macOS-only, and bound to `127.0.0.1`.
- The system never merges an original implementation PR, deploys code, or changes Linear workflow state.
- Codex runs with workspace-write isolation and automatic approval review; unrestricted sandbox bypass is not allowed.
- Linear canonical branch names are authoritative.
- Secrets stay in an external, Git-ignored `.env`; persisted output is redacted.
- Each completed phase includes focused automated tests for the behavior introduced in that phase.

## Phase 1: Application foundation

Establish the TypeScript workspace, React/Vite dashboard, Fastify service, SQLite/Drizzle persistence, local configuration, and the one-command development startup path.

**Outcome:** The local dashboard and service start together, expose a health/status view, and can read and write migrated application data.

## Phase 2: Core job domain and operator shell

Implement the core records and lifecycle foundations: jobs, plan versions, runbook snapshots, attention items, and review rounds. Add the job state machine, basic dashboard navigation, attention inbox shell, job list/detail views, and server-sent event plumbing.

**Outcome:** Jobs and their history can be created, inspected, transitioned through validated states, and reflected live in the dashboard without external integrations.

## Phase 3: Linear and ad hoc intake

Add the typed Linear adapter and intake experience for assigned actionable issues, search/filtering, multi-selection, work-class confirmation, base-branch selection, and ad hoc issue creation.

**Outcome:** A user can select an existing Linear issue or create an ad hoc one, classify it independently, and produce a dispatchable local job linked to its canonical Linear issue and branch.

## Phase 4: Repository and worktree dispatch

Add Git and repository operations for refreshing a selected remote base, validating canonical branch ownership, detecting collisions, and creating isolated worktrees. Introduce the manually reorderable queue and three-slot scheduler.

**Outcome:** Dispatch safely creates a queued job in its own canonical-branch worktree, and the scheduler can start eligible jobs with a maximum concurrency of three.

## Phase 5: Routine planning and approval

Add the Codex adapter for read-only planning, structured plan capture, plan revision history, an unbounded change-request cycle, approval, and immutable runbook snapshots.

**Outcome:** A Routine job can move from intake through a supervised, persisted planning flow and become approved for implementation with the exact runbook version it will execute.

## Phase 6: Routine execution and ready PR

Implement resumable Codex execution, JSONL milestone parsing, log storage and redaction, pause/stop/resume, bounded runbook repair cycles, GitHub PR creation, Linear linking, and structured progress display.

**Outcome:** The primary v1 path works end to end: Linear or ad hoc intake → Routine plan approval → isolated Codex implementation → one ready-for-review GitHub PR.

## Phase 7: Recovery and operational hardening

Handle process interruption, application and machine restarts, orphaned processes/worktrees, failure attention items, overlap warnings, and safe cleanup after the original PR is confirmed merged.

**Outcome:** Interrupted or failed work is recoverable without losing its branch, worktree, session, or useful logs, and completed jobs are cleaned up safely.

## Phase 8: Feature planning workflow

Add Feature routing, the Terminal.app or iTerm conversation wrapper, explicit `/grill-with-docs` invocation, structured plan import, same-session implementation handoff, and inclusion of glossary/ADR edits in the implementation PR.

**Outcome:** Feature jobs can complete the interactive planning interview, receive dashboard approval, and resume the same Codex session for implementation.

## Phase 9: Slack intake and notifications

Add Slack Bolt Socket Mode, forwarded-message and accessible-thread capture, editable issue previews, Create only/Create and dispatch actions, Slack permalinks, and tightly scoped decision/result DMs.

**Outcome:** A forwarded Slack conversation can create a concise, linked Linear issue and optionally enter the existing dispatch workflow; inaccessible threads fail with corrective guidance.

## Phase 10: GitHub checks and conflict handling

Monitor checks and conflicts on original PRs. Add bounded automatic repair for in-scope check failures, approval gates for material scope changes, and proposed conflict-resolution plans that require approval before modifying the branch.

**Outcome:** CI failures and merge conflicts enter deterministic supervised flows without silently expanding scope or changing the original branch without permission.

## Phase 11: Review evaluation and child PRs

Evaluate review comments, separate accepted from disputed feedback, create review-round child branches and child PRs for accepted changes, and prepare evidence-backed replies for disputed comments.

**Outcome:** Accepted feedback is delivered through child PRs targeting the original branch, disputed feedback becomes an attention item, and merged child PRs are referenced in original review threads without resolving them.

## Phase 12: Retention, metrics, and release acceptance

Implement 30-day detailed-data cleanup, lightweight metadata retention, coordination-time measurement, final safety checks, contract coverage, and labeled real-integration acceptance runs.

**Outcome:** The system enforces its retention policy, reports the data needed to evaluate the 50% coordination-time target, and has evidence for every acceptance scenario in the master plan.

## Recommended phase handoff

At the start of each build session:

1. Read `masterplan.md` and this roadmap.
2. Confirm the prior phase's outcome and tests still pass.
3. Create a detailed implementation plan only for the current phase.
4. Record any scope or contract decision that affects later phases.

Phases should normally be completed in order. A later integration may be prototyped earlier when it reduces uncertainty, but it should not be wired into the main workflow until its prerequisite phases are complete.
