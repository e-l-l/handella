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

**Source**:
Where the Handler's request came from: an issue already assigned to them, a
conversation they forwarded, or something they wrote themselves. It does not
record whether a Linear issue exists, because every Job has one.
_Avoid_: Type, channel, origin

**Actionable Issue**:
A Linear issue with work left in it: one whose Workflow State belongs to any
category except the three that end its life. A duplicate is not one, because its
work lives on the issue it duplicates. An Actionable Issue assigned to the
Handler is what Intake offers.
_Avoid_: Open issue, active issue

**Workflow State**:
Where an issue sits in one Linear team's process, named by the team that defined
it: In Review and In Dev (QA) are two of them. Every state belongs to one of
Linear's fixed categories, and one category can hold many states, so a category
is what Handella decides actionability by and a state is what the Handler reads
and filters by. States belong to a team and their names repeat across teams, so
a state only means something alongside the team it came from.
_Avoid_: Stage, column

**Intake**:
Turning an Actionable Issue, existing or newly created, into a Job. It precedes
Dispatch and commits nothing but the Job record.
_Avoid_: Import, ingest, triage

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
One revision of the structured plan proposed for a Job: what this Job in
particular will change, and how anyone could tell it worked. Every revision is
kept, and there may be any number of them, because the Handler may ask for
changes as often as the plan needs them. Only the newest can be answered.
_Avoid_: Draft, proposal

**Runbook**:
The procedure every Job's implementation follows, whatever the Job is: commit,
test, open the pull request. The Handler writes it and Handella never does. It
is what the Plan is not — the Plan is this Job's work, the Runbook is the way
all work is done here — and the two are read together, so a Plan is written
knowing the Runbook that will carry it out. Versions are added, never edited:
Jobs have approved against what it said.
_Avoid_: Checklist, template, playbook, process

**Runbook Snapshot**:
The immutable copy of the Runbook a Job will execute, taken when its plan is
approved. It holds the text and not merely a reference to a version, so a Job
can still say what it ran after the Handler has rewritten everything since.
_Avoid_: Checklist, template

**Codex Session**:
The conversation a Job's planning and implementation happen inside, kept so
Handella can return to it. A revision is a turn in the session that produced
the plan it revises, rather than a fresh briefing, and Phase 6 implements in
the session that planned.
_Avoid_: Thread, run, context

**Review Round**:
One pass of review comments on a Job's pull request, together with Handella's
verdicts and any child pull request that answers them.
_Avoid_: Review, feedback cycle

**Repository**:
A checkout on the Handler's machine that Handella cuts worktrees from. Handella
adopts one the Handler already has rather than cloning it, so their own
credentials reach the remote and Handella holds none.
_Avoid_: Project, codebase, clone

**Worktree**:
The isolated working directory a Job is planned and implemented in, checked out
at that Job's Canonical Branch. One per Job, created at Dispatch and kept until
its pull request is confirmed merged.
_Avoid_: Workspace, sandbox, checkout

**Queue Position**:
Where a Job sits among those waiting for a Slot. Set by the Handler, who may
reorder the queue; a Job with no position waits behind every Job that has one.
_Avoid_: Priority, rank

**Slot**:
One of the three concurrent places Codex may be working. Planning holds one as
surely as implementing does, and a suspended Job holds none: its worktree is
kept, not worked in.
_Avoid_: Runner, worker, lane

**Dispatch**:
Committing a Job to execution: claiming its canonical branch, creating its
worktree, and placing it in the queue.
_Avoid_: Start, launch, submit

**Canonical Branch**:
Linear's branch name for an issue, owned by one Job and fixed when that Job is
Dispatched. An issue worked more than once gives each Job its own branch, so the
name carries a numbered suffix from the second onwards. It is authoritative, and
a Job cannot be dispatched without it.
_Avoid_: Feature branch, working branch
