# Suffix a canonical branch when its issue is worked more than once

A Linear issue does not retire when its pull request merges. It moves on to In
Dev or In QA, and what is found there comes back to the same issue rather than a
new one, so one issue produces several Jobs over its life. Each Job owns a
worktree and a branch, and two Jobs cannot share either, so from the second Job
onwards the Canonical Branch is Linear's name with `-2`, `-3` and so on
appended; the first Job gets Linear's name verbatim. The count includes settled
Jobs, so cancelling one never frees its name for reuse.

This reads as a contradiction of the guiding constraint that Linear canonical
branch names are authoritative, and it is worth saying why it is not. Linear
links a branch to an issue by finding the issue ID anywhere in the name, so a
suffixed branch still moves the issue through the workflow exactly as an
unsuffixed one does. Linear still names the branch; Handella only disambiguates
repeats, and only when there is something to disambiguate.

The alternative was one branch per issue forever, reused on each pass. That
fails the moment a second Job starts before the first one's branch is deleted,
which is the ordinary case: the merged Job keeps its worktree until Phase 7
confirms the merge and cleans up. It also makes a Job's branch a poor key for
anything, because two Jobs would answer to it.

The suffix is computed at Intake so the Handler sees the real name before
committing to it, and computed again when the branch is claimed at Dispatch,
because another Job for the same issue may have started in between. Dispatch is
what fixes it; after that it never changes, which is what keeps the pull
request, the worktree and Linear's own integration pointing at one thing.
