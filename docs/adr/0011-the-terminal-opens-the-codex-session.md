# The dashboard opens the Codex session in a terminal, not a shell beside it

A Job that is planning or implementing shows the Handler a spine of Milestones
and, per Attempt, a raw log they can unroll. Both are derived: the spine is the
readable subset of a conversation and the log is that conversation flattened
into lines. What neither is, is the conversation — and the conversation is what
a Handler wants when a pass is taking longer than it should, because the
question they have at that moment is what the agent thinks it is doing, which
only the agent can answer. An in-dashboard live view was offered and declined,
so the surface is a terminal; the question is what the terminal opens onto.

The first answer was the Worktree: a shell standing where the Job is, good for
`git status` and a diff and nothing else. It was the safe answer and it was the
wrong one, because standing in a directory tells you what has been written, not
what is being attempted. So the window resumes the Job's Codex session —
`codex resume` on the session id planning recorded — and falls back to a plain
shell only for a Job that has been dispatched but has not planned yet, which
has no session because none exists.

That costs the property the first answer was protecting. `resume` continues the
original thread; `fork` is the only way Codex offers to read one without
changing it. Handella resumes that same thread for every plan revision and for
the whole of implementation, so a turn the Handler types is a turn the next
pass continues from, and while a pass is actually running there are two writers
on one conversation. Forking instead was considered and refused: a copy answers
none of what the Handler opened the window for, because they want to interrupt
the session that is running, not read a snapshot of one that was. The Handler
was asked and chose this knowingly, so the mitigation is to say so rather than
to prevent it — the job panel carries the warning beside the button, and the
button is labelled "Open session" rather than "Open terminal" whenever it will
resume one.

Which terminal is decided by looking for the application bundle rather than by
asking Launch Services, which can put a chooser in front of someone when a name
is unknown — a probe that opens a window is not a probe. Ghostty first, then
iTerm, then Terminal.app, which is always installed and so is the floor rather
than a choice; `HANDELLA_TERMINAL_APP` overrides the order for a Handler who
has a different preference, and naming one that is not installed is an error
rather than a silent fallback.

Ghostty is driven through its AppleScript dictionary because `open -a` hands an
application a document and a directory is not one of Ghostty's: the working
directory is a property of the surface being created, so the surface has to be
described. The session is started with that surface's `initial input` rather
than its `command`, because `command` replaces the shell and the window would
then die the moment the Handler quit Codex — typing the line instead leaves
them standing in the Worktree, which is the other half of what they opened it
for. The path and the command are passed as `argv` to the script rather than
interpolated into it, for the reason the Git adapter never builds a command
string.

`initial input` is the one value here that cannot be an `argv` item, since it
is a command line by construction, so the session id is checked against a shape
before it is allowed to become text. It arrives from Codex's own
`thread.started` event as a UUID or a `thr_`-style name; an id with a space in
it is Codex having changed rather than a string worth escaping, and refusing it
is the honest answer. Terminal.app and iTerm cannot be told to run anything at
all — they open a folder as a shell and that is the whole of their document
handling — so a Job with a session is handed a launcher script instead. Its
text is a constant and the two values it needs sit in files beside it, which is
how that path keeps the same rule without quoting anything.

The refusal path stays mild. A platform with no terminal, a terminal that would
not open, or a session id that will not be typed all answer 502 beside a job
page that is already showing the Worktree path and the session id. Handella has
not failed to do anything; it has failed to save the Handler from typing `cd`
and `codex resume` themselves.
