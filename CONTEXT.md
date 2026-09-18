# Handella

Handella is a local engineering orchestrator that converts incoming work into supervised Codex jobs while keeping one human in control.

## Language

**Handella**:
The complete local system, including its dashboard, local service, persistence, and integrations.
_Avoid_: Bot, agent

**Handler**:
The single human who supervises Handella and retains approval and merge authority.
_Avoid_: User, operator, owner

Note: `BUILD_PHASES.md` phase 2 is titled "operator shell"; the shell it
names is the Handler's.

**Dashboard**:
The browser interface through which the Handler supervises Handella.
_Avoid_: Frontend, admin panel

**Local Service**:
The loopback-only process responsible for Handella's persistence and orchestration.
_Avoid_: Backend, server

**Installation**:
The persistent identity and metadata associated with one Handella database, surviving process restarts.
_Avoid_: Session, process

**Job**:
One unit of work Handella supervises from intake to a merged pull request,
owning a single canonical branch.
_Avoid_: Task, ticket, run

**Work Class**:
Whether a Job is a Feature, which needs an interactive planning interview, or a
Routine, which Handella can plan on its own.
_Avoid_: Type, category, kind

**Lifecycle State**:
Where a Job currently sits in its life. It never records whether the Job is
stopped; that is its Suspension.
_Avoid_: Status, stage, phase

**Suspension**:
Why a Job is not progressing, when the reason is abnormal or the Handler stopped
it deliberately. A Job waiting on the Handler in the ordinary course is not
suspended.
_Avoid_: Pause, block, stall, hold

**Attention Item**:
Something the Handler must look at. It may belong to a Job or stand alone, and
it is resolved rather than deleted.
_Avoid_: Notification, alert, todo

**Plan Version**:
One revision of the structured plan proposed for a Job. Every revision is kept.
_Avoid_: Draft, proposal

**Runbook Snapshot**:
The immutable copy of the Runbook a Job will execute, taken when its plan is
approved.
_Avoid_: Checklist, template

**Review Round**:
One pass of review comments on a Job's pull request, together with Handella's
verdicts and any child pull request that answers them.
_Avoid_: Review, feedback cycle

**Dispatch**:
Committing a Job to execution: claiming its canonical branch, creating its
worktree, and placing it in the queue.
_Avoid_: Start, launch, submit

**Canonical Branch**:
The branch name Linear assigns to an issue. It is authoritative, and a Job
cannot be dispatched without it.
_Avoid_: Feature branch, working branch
