# Handella observes the Codex session instead of holding a structured plan

Supersedes [ADR 0007](./0007-unbounded-plan-revisions.md) and
[ADR 0014](./0014-overlap-is-warned-about-at-plan-approval.md).

The plan used to be a record. Codex was run read-only against a JSON schema,
the answer was validated and stored as a Plan Version, the dashboard drew it as
a summary and a list of steps, and the Handler answered it there — approve, or
write feedback that became the next turn in the same session. It worked, and it
was most of the application: a schema, a table, a revision history, a review
screen, a change-request loop, and an overlap warning computed from the file
list each step promised to touch.

What it bought was worse than what it cost. The plan a planner writes is prose
— an argument about what should change and why — and putting it through a
schema kept the shape and lost the argument. The Handler read a flattened
version of a conversation they could have had, then answered it through a
textarea that became a turn in that same conversation anyway. Every revision
made the record longer and the reading no better.

So the plan stays where it is made. Handella starts a Codex session in the
worktree, the planner proposes and stops, and the Handler opens the session in
their terminal and reads it there — the whole thing, including the parts a
schema had nowhere to put. They answer there too, by typing, which is what they
were doing through the dashboard already. Approving is the dashboard's one
remaining say in it: a button that freezes the Runbook Snapshot and sends the
implementation turn.

## What this costs, and what pays for it

Handella is now blind to something it used to own. A Handler who reads the plan
in the terminal and tells Codex to go there has approved a Job without touching
the dashboard, and nothing in a write Handella makes would ever say so.

What pays for it is the file Codex already writes. Every session is appended to
a rollout — JSONL, one record per event — and reading it is how Handella learns
what happened in a conversation it is not part of. Session Watch follows the
rollout of every Job in `planning`, `planReview` or `implementing` and moves the
Job on three observations:

- a session created in a worktree Handella is holding for the Handler, which is
  them starting the planning it declined to do (docs/adr/0017);
- a file changing while a Job waits in `planReview`, which is them having said
  go;
- a turn ending while a Job is `implementing`, which is the moment to ask GitHub
  whether the work landed.

The middle one is the interesting rule. "Any turn the Handler takes" would be
wrong in the ordinary case: the ordinary turn in `planReview` is a question
about the plan, and calling that an approval would put a Job into
`implementing` with nothing implemented. A file change under the Handler's own
sandbox happens when Codex has been told to build. The Job that implements
through shell redirection and writes no patch is caught by the safety net
underneath: a turn ending in `planReview` makes Handella ask GitHub anyway, and
a pull request on the branch is an approval nobody can argue with.

Handella's own turns must never be read back as the Handler's, and the fence is
the byte offset rather than anything in the records. The scheduler says when a
pass owns a session and when it gives it back; on the way out the offset moves
past everything that pass wrote. The discriminator that suggests itself —
`approval_policy`, which is `never` for Handella's passes — is refused, because
a Handler whose own config says `never` would look exactly like Handella, and a
rule that depends on their settings is not a rule.

## What still decides whether a Job is done

[ADR 0010](./0010-network-in-the-implementation-sandbox.md) says Handella
believes nothing the agent reports, and this makes that the whole mechanism
rather than a qualification on it. The completion report is gone: there is no
schema to hold the agent to and no JSON to parse. An implementation turn ends,
and the only question asked afterwards is the one GitHub can answer — is there
an open, non-draft pull request on the Canonical Branch, aimed at the base the
Handler chose, with the worktree still on that branch. Yes moves the Job to
`prOpen`. Anything else leaves it exactly where it is, unsuspended, with one
Attention Item saying the session needs them.

That replaces the bounded repair loop. Handella used to answer a turn that fell
short with another turn — up to three, then a failure item — which is a
reasonable thing to do when the agent has told you what went wrong in a
structured field. Without that field it is guessing, and a second ninety-minute
turn against a question nobody asked is the most expensive way to guess. The
Handler is already in the session; handing it to them is both cheaper and what
they would have done anyway.

## Slots, and why they are no longer about states

A Slot used to be a fact about a Lifecycle State: `planning` and `implementing`
held one, everything else did not. That is wrong now in the ordinary case,
because a Job the Handler is finishing in their terminal is `implementing` for
as long as they take over it, and it would hold a third of the machine while
Handella ran nothing in it. So a Slot is a fact about a pass: the Job's row
names the Handella pass that claimed it, and a Job nobody's pass is running in
holds nothing. Work in flight and work holding a Slot are now two questions, and
the dashboard asks the first where it lists what is running and the second where
it counts against the ceiling.

## The second timer

[ADR 0013](./0013-reconciliation-removes-only-what-it-can-attribute.md) says
Reconciliation is the one part of Handella that runs on a timer, and gives the
reason: what it waits for happens somewhere Handella cannot hear. Session Watch
is the second, for that reason exactly — the Handler's terminal is somewhere
Handella cannot hear either. It is not folded into Reconciliation's pass because
the intervals are answering different people: five minutes is right for a merge
that happened on github.com and will keep until someone looks, and wrong for a
Handler who typed "go" ten seconds ago and is watching the dashboard to see
whether Handella noticed. Three seconds, and a pass costs one `stat` per
followed Job.

The scheduler stays event-driven and keeps its own argument: every Slot it
grants is freed or filled by a write this process makes. Session Watch writes
through the store like everything else, so the events it publishes tick the
scheduler the way any other write would.

## What is deliberately not watched

A Job whose pull request is open. The Handler goes on using that session —
answering review comments, pushing fixes — and every one of those turns would
look like work Handella should react to. It should not: the pull request is the
fact from `prOpen` onwards, the merge check owns what happens to it, and an
edge back to `implementing` would spend the one Phase 10 has reserved for CI
repair. A suspended Job is not watched either, for the reason a stop exists: it
means leave it alone.

## What goes with the record

Overlap was computed from `PlanStep.files` and cannot survive the plan not being
structured. It could be rebuilt from the diffs as turns run, which ADR 0014
already named and refused as accurate and too late. So it goes, and ADR 0014 is
superseded rather than reinterpreted. ADR 0007's unbounded revisions go the same
way, and get what they were reaching for: there was never a ceiling on how often
a Handler could ask for changes, and now there is no ceiling and no record
either — they are talking to the planner.

## The rollout format is not Handella's

Codex owns it, adds to it, and ships a `migrate-rollouts` command that moves
sessions into a paginated history. So reading it is an adapter with a fake
behind it, and the one module that knows about day directories and filename
suffixes is the one that reads them. A Codex that keeps no rollouts where
Handella looks degrades to an Attention Item per watched Job saying so — the
sessions still work, the dashboard's Approve button still works, and what is
lost is the noticing. Unknown record types are skipped rather than rejected, and
a line that does not parse is skipped too: the file is being appended to while
it is read, and half a record is the ordinary case rather than corruption.
