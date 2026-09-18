# Worktrees live under .data and the location is not configurable

Dispatch creates each worktree at `.data/worktrees/<repository>/<canonical
branch>`. The directory is already the one Handella owns: it is created 0700,
it is Git-ignored, and it holds the database, so a Handler who moves or deletes
`.data` moves or deletes all of Handella's state at once rather than some of it.
It also makes Phase 7's orphan cleanup a directory walk compared against
`jobs.worktree_path`, instead of a search of wherever worktrees might have been
put.

The location takes no setting, and that is the part worth recording, because the
obvious next change is to add one. Unattended execution runs Codex under
workspace-write isolation, whose boundary is derived from the working directory
it is given — the worktree. That boundary is only a boundary while the worktree
and the target checkout are separate trees. A worktree root placed inside the
target checkout collapses both under one sandbox root, and the agent may then
write the main working tree as freely as its own. Nothing would report this;
the Handler would have configured away a guarantee without being told, and every
Job afterwards would look exactly as correct as before.

A rule that can be configured incorrectly and fails silently is better spelled
as no setting at all. The cost is real but small: a Handler whose repository
lives on another volume gets worktrees beside the database rather than beside
the code, and Handella never asks where to put them.

One gap is left open deliberately. A worktree's `.git` is a file pointing into
`<repository>/.git/worktrees/<name>`, and commits inside the worktree fail
unless the sandbox may write there, so that grant is not optional. The agent can
therefore write refs in the main repository, though never its working tree,
which is why Phase 6 asserts the worktree's HEAD before opening a pull request
rather than treating containment as complete.
