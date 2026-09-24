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

Note: the Intake screen runs Dispatch straight after itself, per issue, so work
the Handler has just taken reaches the queue in one submission. The two stay
separate underneath — one request commits the Job, the next claims the branch —
so either may be refused without the other being undone, and "Create only"
stops after the first.

**Selection**:
The Actionable Issues the Handler has picked to take, each with its Choices,
before any Job exists. It outlives leaving the Intake screen and is emptied
issue by issue as each Job is created; an issue a live Job already holds stays
in it, blocked, rather than vanishing.
_Avoid_: Cart, basket, draft, session

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
suspended — a Job in Plan Review is waiting, and so is a Job on Hold.
_Avoid_: Pause, block, stall, hold

**Attention Item**:
Something the Handler must look at. It may belong to a Job or stand alone, and
it is resolved rather than deleted.
_Avoid_: Notification, alert, todo

**Plan**:
What a Job in particular will change, and how anyone could tell it worked.
Prose in the Job's Codex Session rather than a record Handella holds: the
Handler reads it in a terminal and answers it there, and approving is the one
part of it the dashboard has a say in (docs/adr/0015).
_Avoid_: Plan version, draft, proposal

**Session Watch**:
Handella following a Job's Codex Session through the file Codex writes it to,
so a plan approved in the terminal and a pull request opened there are noticed
without being reported. The second thing that runs on a timer
(docs/adr/0015).
_Avoid_: Poller, tail, listener

**Handler Turn**:
A turn in a Job's Codex Session that the Handler typed rather than Handella
sent. Told apart by where the session file stood when Handella's own pass
ended, never by what the turn says.
_Avoid_: Manual turn, interactive turn, intervention

**Hold**:
A Job kept in `planning` with no pass behind it, because Handella will not plan
it unattended and is waiting for the Handler to open its session. It holds no
Slot and is not a Suspension: nothing has stopped (docs/adr/0017).
_Avoid_: Pause, block, park

**Runbook**:
The procedure every Job's implementation follows, whatever the Job is: commit,
test, open the pull request. The Handler writes it and Handella never does. It
is what the Plan is not — the Plan is this Job's work, the Runbook is the way
all work is done here — and the two are read together, so a Plan is written
knowing the Runbook that will carry it out. Versions are added, never edited:
Jobs have approved against what it said.
_Avoid_: Checklist, template, playbook, process

**Runbook Snapshot**:
The immutable copy of the Runbook a Job will execute, taken when the Handler
approves — in the dashboard, or by telling Codex to go in the terminal. It holds the text and not merely a reference to a version, so a Job
can still say what it ran after the Handler has rewritten everything since.
_Avoid_: Checklist, template

**Codex Session**:
The conversation a Job's planning and implementation happen inside. The Plan is
proposed and read there, approving resumes it for implementation, and the
Handler finishes there whatever Handella's one turn left undone. "Open session"
is how they reach it, and Handella follows the same conversation from the
outside rather than being told about it (docs/adr/0011, docs/adr/0015).
_Avoid_: Thread, run, context

**Attempt**:
Handella's one unattended implementation turn on a Job, taken in the Codex
Session once the Plan is approved. Its ending is a record and not a verdict: the
Job moves on only when GitHub shows an open pull request on the Canonical
Branch, and a turn that ends without one hands the Job back to the Handler
rather than to another turn (docs/adr/0015).
_Avoid_: Retry, repair, round

**Milestone**:
Something the agent did that the Handler can read at a glance: a command and how
it ended, files changed, its own narration of the work. Not what it thought —
reasoning is kept with the rest of the turn's output and read only by someone
who goes looking.
_Avoid_: Event, log line, step

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

**Reconciliation**:
Making the machine agree with the database. The database says a process is
running, a Worktree belongs to a Job, a pull request is still open; a crash, a
machine restart or a merge the Handler made on github.com can falsify any of
them, and none of the three announce itself. It is the one part of Handella that
runs on a timer, which is why it is not the scheduler (docs/adr/0013).
_Avoid_: Sync, cleanup, garbage collection, sweep

**Orphan**:
A Codex process or a Worktree that outlived whatever Handella knew it by: a pid
in a row no live pass is behind, a directory under the Worktree root that no Job
row names. Being one says nothing about whose it is, which is why
Reconciliation kills an Orphan process and only reports an Orphan Worktree —
a process it can prove is the one it spawned, a directory it cannot prove is
not the Handler's.
_Avoid_: Stale, leaked, zombie, dangling

**Queue Position**:
Where a Job sits among those waiting for a Slot. Set by the Handler, who may
reorder the queue; a Job with no position waits behind every Job that has one.
_Avoid_: Priority, rank

**Slot**:
One of the three concurrent places Handella may be running a Codex pass. Held by
a pass and not by a Lifecycle State: a Job the Handler is driving in their own
terminal is working and holds none, because the machine it occupies is theirs
(docs/adr/0015). A suspended Job holds none either — its worktree is kept, not
worked in.
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
