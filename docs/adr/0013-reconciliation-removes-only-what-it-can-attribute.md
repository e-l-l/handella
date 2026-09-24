# Reconciliation polls for merges and removes only what it can attribute

_Amended by [ADR 0015](./0015-handella-observes-the-codex-session.md):
Reconciliation is no longer the only part of Handella that runs on a timer.
Session Watch is the second, for the reason given here — what it waits for
happens somewhere Handella cannot hear — on a much shorter interval, because a
Handler who has just approved in their terminal is watching the dashboard._

Reconciliation is a component of its own, with a timer, and it is the only part
of Handella that has one. The scheduler says in its own header that it is
event-driven and that a timer would be a second source of truth that is usually
wrong. It is right about itself: every slot it grants is freed or filled by a
write this process makes, and every one of those writes publishes. Nothing
Reconciliation waits for is like that. Only the Handler may merge, and they do
it on github.com; a worktree is left behind by a crash; a process outlives the
run that spawned it. None of these announce themselves, so the choice is a
timer or never noticing. Keeping it out of the scheduler is what lets both
statements stay true, and it is why the merge check is a third module that
neither component owns — the Handler pressing "Check merge" and the timer
sweeping every open pull request want the same question asked and nothing else
in common.

Five minutes, and a button. The interval is slow because nothing downstream is
urgent: the Job is already `prOpen`, the Handler has what they wanted, and what
the merge releases is a directory. Every pass spends a `gh` invocation per Job
it is watching, so a tighter loop would buy nothing but processes. The button is
there because five minutes is a long time to look at a worktree you know has no
reason to exist, and because a Handler who has just merged is the one person
who knows the answer already.

Removal after a merge is guarded, and the guards are the substance of this
decision. This is the only place Handella deletes a directory an agent has been
writing in. Before it does, the worktree's HEAD must still be the Job's
Canonical Branch — the same drift assertion Phase 6 makes before it believes a
pull request, because a worktree moved onto another branch is not the one this
Job merged — and `git status --porcelain` must be empty, untracked files
included. Work the agent left uncommitted never reached the pull request, so it
is work the Handler has never seen. When either guard refuses, the Job still
becomes `merged`, because it is: that is GitHub's fact and not Handella's to
withhold. What failed is the tidying up, and it becomes a failure item naming
the path and the reason. The asymmetry is deliberate. A refusal leaves residue,
which the next pass reports and a Handler can clear in one command. A wrong
removal cannot be undone.

The same asymmetry decides what happens to residue nobody claims. Handella
reports the worktrees under its root that no Job row names and never deletes
one. ADR 0006 fixed that root partly so this comparison would be a directory
walk against `jobs.worktree_path`, and it would be easy to read that as licence
to clean up — the root is Handella's, after all. It is not. A path under it that
Handella cannot attribute to a Job is a path whose history Handella does not
know: a Job whose row was deleted, a repository the Handler de-registered, a
directory they made themselves while debugging.

The column is the attribution, and the Job's Lifecycle State has nothing to do
with it. A cancelled Job's worktree is still named by a row, and so is a merged
Job's when the removal above refused; both are residue the Handler may want to
clear, and neither is residue Handella cannot account for. Reading only live
Jobs would put them in an item that says nothing claims them, which is false —
and, because no later pass can make it true, an item that never resolves. The
refusal already has its own item, naming the path and the reason, and saying it
a second time in the language of residue nobody owns would be saying it wrong.

Paths are compared with their symlinks resolved. git answers `worktree list`
with real paths — a root under `/var` on macOS comes back under `/private/var` —
while the database holds the path as Handella spelled it when it cut the
worktree. Comparing the two spellings directly puts every one of git's answers
outside Handella's own root, and the half of the report that git provides
becomes silently empty. The one thing Reconciliation
does unprompted is `git worktree prune`, and only because that forgets git's
record of a directory that is already gone — it is metadata, and it cannot
touch a directory that exists.

A report is a complete set or it is nothing. When a checkout cannot be read the
pass reports no orphans at all rather than the ones it managed to find, because
the item is replaced wholesale on each pass and half a set would resolve an
item about residue that is still on disk. For the same reason the item is
replaced only when its contents change: a fresh row every five minutes would be
an inbox that never settles and an item whose age meant nothing.

Neither the orphan report nor the overlap warning is a `blocker`. A blocker is a
Job that has stopped and is waiting on the Handler, and neither of these is.
Giving each its own kind also gives Reconciliation a way to find the item it
raised last pass, which is what makes a standalone item replaceable rather than
duplicated.

A logged-out `gh` is logged and not raised. It will fail for every watched Job
on every pass, so an attention item would be minted forever by a timer, and
`/api/status` already reports whether `gh` is there and authenticated. A
condition the Handler can already see does not need an inbox entry per five
minutes to prove it.
