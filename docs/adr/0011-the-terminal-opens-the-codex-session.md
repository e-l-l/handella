# The dashboard opens the Codex session in a terminal, not a shell beside it

_Amended by [ADR 0015](./0015-handella-observes-the-codex-session.md): the
terminal is now where the plan is read and answered rather than a side channel,
and Handella follows the session it opens. Amended by
[ADR 0017](./0017-a-video-hands-planning-to-the-handler.md): a held Job's window
starts Codex on a brief instead of resuming a session, under the same rule about
nothing being interpolated into the launcher._

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
is unknown — a probe that opens a window is not a probe. iTerm first, then
Terminal.app, which is always installed and so is the floor rather than a
choice; `HANDELLA_TERMINAL_APP` overrides the order for a Handler who has a
different preference, and naming one that is not installed is an error rather
than a silent fallback.

Ghostty was first, and was driven through its AppleScript dictionary rather
than through `open`, because `open -a` hands an application a document and a
directory is not one of Ghostty's: the working directory is a property of the
surface being created, so the surface had to be described. Describing it meant
`activate` and then `new window with configuration`, and the Handler got two
windows — the one the application opens for itself on being brought forward,
and the one that was asked for. Reaching the session past a bare window is not
what a button called "open the terminal" promises, and no ordering of the two
verbs removed the first window, so the special case went rather than growing a
workaround. What is left is the one way every terminal here is driven: hand
`open` a document, get a window. A terminal that has to be told how to build
one is out of scope; it can still be named in `HANDELLA_TERMINAL_APP`, and it
gets a document like the rest.

Terminal.app and iTerm cannot be told to run anything at all — they open a
folder as a shell and that is the whole of their document handling — so a Job
with a session is handed a launcher script instead of its Worktree. The
script's text is a constant and the two values it needs sit in files beside it,
so nothing is interpolated and nothing is quoted, which is the rule the Git
adapter keeps by never building a command string. It ends in a login shell, so
quitting Codex leaves the Handler standing in the Worktree rather than closing
the window — the other half of what they opened it for.

The session id is still checked against a shape before it is written, for a
narrower reason than the one Ghostty gave it. It reaches `codex resume` as an
`argv` item now, so quoting is not the worry; the worry is the id itself. A
newline makes the file two lines and the read keeps the first, and a leading
dash arrives as a flag rather than as a session. It comes from Codex's own
`thread.started` event as a UUID or a `thr_`-style name, so an id outside that
shape is Codex having changed rather than a string worth patching around, and
refusing it is the honest answer.

The refusal path stays mild. A platform with no terminal, a terminal that would
not open, or a session id that will not be typed all answer 502 beside a job
page that is already showing the Worktree path and the session id. Handella has
not failed to do anything; it has failed to save the Handler from typing `cd`
and `codex resume` themselves.
