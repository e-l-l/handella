# Let the implementation sandbox reach the network, and let the agent open the pull request

Planning runs read-only, and nothing about it needs a network beyond the model
call Codex makes for itself. Implementation is not like that. A worktree is a
fresh checkout with nothing ignored in it, so it holds no `node_modules`, no
`.venv`, no build cache — and the runbook's "run the repository's test suite,
type check and linter" cannot begin until those are installed. A workspace-write
sandbox with `network_access` left off cannot install them, which makes the
verification half of every runbook unreachable and turns the phase's whole point
— a pull request somebody could review — into a pull request nobody has run.

So `sandbox_workspace_write.network_access` is true for the implementation pass.
That is not a sandbox bypass: writes are still confined to the cwd, which is the
job's worktree, and `danger-full-access` is used nowhere. It is the difference
between an agent that can fetch a dependency and one that cannot.

Once the network is open the second question answers itself. Handella could
still have opened the pull request itself — push the branch, run `gh pr create`
— but it would be writing the description of a diff it has never read. ADR 0005
draws the seam at the container: Handella fetches, claims the branch, cuts the
worktree and hands it over, and the agent owns what happens inside. The pull
request is made of what happened inside. The agent has the diff, the commits and
the runbook in front of it and a `/create-pr` skill to do it properly, so it
opens the pull request and Handella's own GitHub adapter has no write methods at
all.

What this costs is stated plainly: "never merge the original PR" is no longer
structural. With a reachable network and the Handler's own `gh` login, nothing
in the sandbox physically prevents a merge; the runbook forbidding it is prose,
and prose is not a boundary. Keeping the network closed would have kept that
guarantee and cost the tests, which was the worse trade — a system that opens
unverified pull requests is not safer for having been unable to merge them.

What buys it back is that Handella believes nothing the agent reports. The
completion report is stored and read, never acted on: a job reaches `prOpen`
only after Handella asserts the worktree's HEAD is still the canonical branch
(the assertion ADR 0006 asked for), asks GitHub itself which pull request exists
on that branch, and checks that it is open, not a draft, and aimed at the base
the Handler chose. A report claiming a pull request that is not there spends a
repair turn rather than moving the job. And because the adapter can only read,
no path through this application can merge, close or comment on anything —
which is the part of the guarantee that was always going to have to be
structural.
