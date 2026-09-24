# Unattended passes run under the Handler's Codex configuration

Supersedes the read-only-planning half of
[ADR 0005](./0005-application-owned-worktree-creation.md) and the explicit
`workspace-write` of
[ADR 0010](./0010-network-in-the-implementation-sandbox.md).

Handella used to say what sandbox each pass ran under: planning was
`read-only`, on the reasoning that a planner that can write has already started
implementing, and implementation was `workspace-write` with the network open.
Both were passed as `-c` overrides, so whatever the Handler's own
`~/.codex/config.toml` said was overruled twice per Job.

The read-only planner was a good rule for a pass nobody watched. It is the
wrong rule now, because the session that pass opens is the session the Handler
goes on to drive from their terminal (docs/adr/0015), and a conversation whose
sandbox changes depending on who sent the current turn is a fact nobody would
ever be told. Worse, it was never really enforceable in the direction that
mattered: `codex exec resume` takes no `--sandbox`, so the override had to be
spelled as a config key anyway, and the Handler's own `codex resume` in a
terminal was never going to carry it.

So Handella stops having an opinion about the sandbox. It overrides exactly
three things, and each is about the pass being unattended rather than about
what the agent may touch:

- `approval_policy="never"` — the Handler's config asks on request, and there
  is nobody here to ask. A command that would need approval fails rather than
  hangs.
- `notify=[]` — their config fires a desktop notifier when a turn ends.
  Handella runs turns on its own schedule, and three Jobs would mean three
  pop-ups for work the Handler did not just do.
- `sandbox_workspace_write.network_access=true` — ADR 0010's reason, unchanged:
  a fresh worktree holds no dependencies, so the runbook's test step has to
  install them, and an agent that can reach the network can also push and open
  its own pull request. Under any mode other than `workspace-write` this key is
  inert, which is the right behaviour: it widens what the Handler chose and
  never narrows it.

## What this costs

A Handler whose config says `read-only` gets implementation turns that cannot
write, and they will find out from a Job that sits in `implementing` with an
item saying the session needs them rather than from a setting. That is the
honest failure: Handella did what they configured, and the dashboard says the
work did not land. One whose config says `danger-full-access` gets that, which
is the part worth being plain about — Handella no longer structurally prevents
it, and what stands in its place is that they chose it on their own machine for
their own sessions. Handella sets it nowhere.

[ADR 0006](./0006-fixed-worktree-root.md)'s containment is unaffected, because
it never depended on the mode: the boundary a `workspace-write` sandbox draws
is derived from the working directory, and the working directory is the
worktree. That is also why `--cd` survives on the fresh planning pass and the
cwd pins the resumed one.

## What the planner is told instead

It is asked. The planning brief says to plan and not to make, to investigate as
much as it needs to, and not to edit or commit anything until the Handler says
so. An instruction rather than a wall — and the Handler is in the same session,
reading the same conversation, able to see if it was ignored. The live
end-to-end test asserts the worktree's history is still one commit long after a
real planning pass, which is the same property the sandbox used to guarantee,
checked where it actually matters.
