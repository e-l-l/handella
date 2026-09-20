/**
 * The Runbook every installation starts with, saved as version 1 the first
 * time a database is opened. It is a starting point the Handler is expected to
 * edit, not a default that has to be right for every repository.
 *
 * Prose rather than structure, because it is read by an agent: the sentences
 * that matter most here are the ones about what not to do, and a checklist has
 * nowhere to put those.
 */
export const defaultRunbookContent = `# Implementation runbook

Follow the approved plan. It is the description of the work; this is the
procedure for doing it.

## Before you start

- You are in a worktree checked out at this job's canonical branch. Stay on it.
  Do not create, switch or delete branches.
- Read the repository's own guidance (AGENTS.md, CONTEXT.md, CLAUDE.md,
  contributing docs) and follow it where it is more specific than this runbook.

## Doing the work

- Implement the plan with the \`/implement\` skill. Invoke it and let it carry
  out the plan; do not hand-edit your way through the steps instead. If this
  environment has no such skill, work the steps yourself and say so.
- Work through the plan's steps in order. A step marked required has to pass;
  an optional step may be abandoned if it turns out to be wrong.
- Match the surrounding code: its naming, its comment density, its idioms. A
  change that reads as though it were always there is the goal.
- If the plan turns out to be wrong — a file is not what it claimed, a step is
  impossible, the work is much larger than described — stop and say so. Do not
  quietly substitute a different plan.

## Before you finish

- Once \`/implement\` has finished, run \`/simplify\` over the change and apply
  what it finds. This is part of the work, not an optional extra. Without that
  skill, read the change back for reuse and simplification yourself.
- Run the repository's test suite, type check and linter. Use the commands the
  repository documents, not ones you assume.
- If a check fails, fix it. If it fails for a reason that predates your change,
  say so explicitly rather than fixing it silently or ignoring it.
- Review your own diff. Remove debugging output, commented-out code and
  anything you added only to get a check to pass.

## Committing

- Commit in logical pieces with messages that explain why, not what.
- Do not amend or rebase commits that are already pushed.

## Opening the pull request

- Push this branch and open the pull request with the \`/create-pr\` skill.
  Without that skill, push and run \`gh pr create\` yourself.
- Open it ready for review, not as a draft, and target the base branch this
  worktree was cut from.
- Write the description from the diff you actually produced: what changed, why,
  and how a reviewer can check it. Reference the Linear issue.
- Open exactly one pull request. If one already exists for this branch, push to
  it rather than opening another.

## Never

- Never merge a pull request.
- Never deploy, publish, or run a release command.
- Never change Linear issue states — the branch name is what moves them.
- Never write outside this worktree.
- Never commit secrets, tokens, or the contents of a .env file.
`
