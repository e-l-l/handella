# Overlap is warned about at plan approval and never reaches the scheduler

_Superseded by [ADR 0015](./0015-handella-observes-the-codex-session.md): the
signal this rests on, `PlanStep.files`, went with the structured plan. The
alternative this ADR named and refused — computing overlap from the diffs as the
turns run — is still refused, for the reason given below._

masterplan.md:56 says predicted overlap produces a warning but never serialises
jobs. The second half is the hard half, because the obvious place to put a
prediction about two Jobs touching one file is in front of the thing that starts
them, and a guard there would be one line and permanently wrong. So the warning
is raised inside `approvePlan`, as an Attention Item, and nothing reads it back.
The scheduler does not know overlap exists. That makes the masterplan's promise
structural rather than a rule somebody has to remember in Phase 10 or 11: there
is no guard to extend, no predicate to consult, nothing for a later phase to
trip over on its way to being helpful.

The signal is `PlanStep.files`, which the planner filled in as the paths the
step expects to touch. Approval is the moment those paths mean something: the
revision is approved, a Runbook Snapshot has been taken against it, and what
the Job will execute is fixed. Earlier is a plan the Handler may still send
back — a proposal, not a commitment — which is also why a candidate Job counts
only when its own newest revision is approved. A Job whose newest revision is
pending will execute something nobody has agreed to yet, and warning about it
would be warning about a plan that no longer exists.

There is no edge out of `approved` back to a plan, so this runs once per Job and
the warning it raises belongs to the Job that approved second. The first had
nothing to overlap with when it was approved, and raising a second item against
it would put the same fact in the inbox twice. A merge resolves it: it was a
warning about what that Job was going to touch, and it has.

Paths are compared as the planners spelled them, normalised only for `.`, `..`
and a leading `./`. They are not resolved against the worktrees, because two
Jobs' copies of `src/store.ts` are two different absolute paths and resolving
would make every overlap invisible. Case is kept even though macOS would
usually treat two spellings as one file, because the repository is read on Linux
by CI and by everyone else, and a warning that guessed wrong about case is a
warning about a file that is not shared.

What this misses is real and accepted: two planners who spell the same file
differently, a step that names a directory where another names a file inside it,
work that touches a file no plan predicted. Every one of those is a false
negative, and a false negative here costs the Handler nothing they do not
already have — they were going to run both Jobs concurrently either way, and
Handella never promised to find every collision. A false positive is cheaper
still: a sentence in the inbox about two Jobs that are both fine. The
alternative worth naming and refusing is computing this from the diffs as the
turns run, which would be accurate and would arrive after the work it was
supposed to warn about.
