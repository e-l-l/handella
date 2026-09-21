# Codex runs in its own process group and Handella records its pid

Every Codex pass is spawned `detached`, so Codex leads a process group of its
own, and a row in `codex_processes` holds its pid until the pass ends. Both
halves exist because of the same gap: the pass is the only thing that held a
handle on the process, and a crash took the handle with it. Handella then
believed a Job was implementing, the agent carried on writing in the worktree,
and a Handler who resumed the Job put a second agent in the same directory.
Nothing in the database could have found the first one — an Attempt records
that a turn was open, not what to signal, and a planning pass has no Attempt at
all, which is why the row hangs off the Job rather than off
`implementation_attempts`.

The group matters separately from the record. A Runbook has the agent install
dependencies and run a test suite, so a pass is usually waiting on an `npm` or
a `vitest` of its own when it is stopped, and `child.kill` reaches Codex alone.
The Handler's stop then freed the slot in the database while the work carried on
in the worktree, which is the failure a stop is supposed to prevent. Signalling
the negated pid reaches the whole group. That is also why the grace period
between SIGTERM and SIGKILL is spelled once, in the contracts, and shared with
the reap: Codex writes the session file the Handler will resume from as it
exits, and two different waits would be two answers to how long Handella gives
it.

A reap will not signal a pid on the strength of the pid alone. The operating
system hands numbers out again, and a machine restart makes that likely rather
than merely possible, so a row that survived the restart may name something the
Handler is running right now. Two checks have to agree before anything is sent:
`ps` must show a command naming `codex`, and the process's own start time must
be within seconds of what the row recorded. Either alone is too weak — the
Handler may well be running their own `codex`, and a start time by itself says
nothing about what started — and a coincidence would have to satisfy both. When
they disagree the row is closed and nothing is signalled, which is the whole
point of the check: the cost of being wrong here is not a stale process, it is
a signal delivered to somebody else's work. The same pair is re-checked before
the SIGKILL, because the process may have exited during the grace period and
its pid been reissued inside it.

Three alternatives were refused. A pidfile keeps the same fact in a second
place that can disagree with the database, and it is the database that already
has a row per Job to hang this on. A real supervisor — launchd, or a wrapper
process — would own the lifecycle properly, but it is a second thing to install
and keep running for a single-user application whose whole premise is one
command on a laptop. `pkill -f codex` at startup needs no bookkeeping at all
and is the most dangerous option on the list: the Handler runs Codex themselves,
in terminals Handella knows nothing about, and ADR 0011 makes that overlap a
feature by inviting them into the session.

What this costs is that a detached child outlives a crash rather than dying
with its parent. That is already what happened, because a non-detached child
of a service is not signalled when the service dies either; the difference is
that Handella can now find it. The remaining gap is a process Handella spawned
but never got a pid for, which the row is written to narrow and cannot close:
the reap logs what it could not record and leaves the worktree's own residue
to be reported by the pass that looks for orphans.
