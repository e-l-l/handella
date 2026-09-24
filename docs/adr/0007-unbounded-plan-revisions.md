# Let a plan be revised as many times as it takes

_Superseded by [ADR 0015](./0015-handella-observes-the-codex-session.md): the
plan is no longer a record to revise. The Handler answers the planner in the
Codex session, which has no ceiling and keeps no revisions._

The Handler may send a change request on a plan as often as they like; every
revision is kept and any of them may be the one that is approved. The masterplan
and the build phases originally allowed exactly one, which reads as a healthy
bound until the second plan is also wrong: the only moves left would be to
approve a plan the Handler does not believe in, or to cancel — and `cancelled`
is terminal, so escaping costs the Job, its worktree, and its branch name, since
ADR 0004 counts settled Jobs and hands the replacement a `-2` suffix. Paying
that for a plan that needs a third sentence of feedback is a worse trade than
the one the bound was protecting against.

What the bound was protecting is real: `planning` holds one of three slots, so a
Job being revised forever is a Job occupying a third of the machine forever.
That is now protected directly instead — a pass is bounded by
`planningTimeoutMs`, and between passes the Job sits in `planReview`, which
holds no slot at all. An unbounded cycle therefore costs slots only while a pass
is actually running, which is the thing worth rationing. The revisions
themselves are cheap, and the count is visible on the job page, so a Handler on
their fifth revision can see that they are and draw their own conclusion.
