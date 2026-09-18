# Handella creates worktrees itself rather than asking the agent to

Dispatch cuts each Job's worktree with `git worktree add` from the Local
Service. The alternative considered was leaving it to the agent: launch Codex in
the main checkout and have its runbook create the worktree as its first step,
which would keep Git out of a process that until now held nothing but SQLite and
HTTP. Three things rule that out, none of them about trusting the agent.

Ordering. The scheduler decides whether to start a Job before the Job runs, and
that decision depends on a worktree existing, because the worktree is the
agent's working directory. A worktree the agent creates makes Handella
downstream of a fact it needs upstream, and there is no point at which it could
ask.

Lifetime. A worktree is created at Dispatch and removed once the pull request is
confirmed merged, which is days later and spans application restarts and several
separate Codex sessions — planning, implementing, CI repair, review rounds. A
runbook is scoped to one invocation. Whatever owns a resource has to outlive it,
and only Handella does.

Read-only planning. Routine Jobs run Codex read-only in the worktree, so at the
moment planning begins the agent could not create one even if asked.

The Git operations shell out to the system `git` binary through `execFile` with
an argument array and no shell, rather than using a JavaScript Git
implementation. Shelling out inherits the Handler's ssh agent, credential helper
and configuration, which is what keeps Handella from ever handling a secret to
reach a remote; a library would need its own credentials and its own copy of
that setup. The argument array rather than a command string is not a style
preference: branch names arrive from Linear, and a name is not something to
interpolate into a shell.

The seam this draws is that Handella owns the container and the runbook owns the
contents. Handella fetches the base, claims the branch, cuts the worktree and
hands over its path; what happens inside — commits, tests, the pull request — is
the agent's. Handella asserts afterwards that the worktree is still on the
Canonical Branch, because the realistic failure is not an agent escaping to
another directory but one cutting its own branch where it already stands.
