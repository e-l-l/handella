# A video hands planning to the Handler

Codex takes images. It does not take video, and there is no flag, encoding or
attachment that changes that. An issue whose evidence is a Loom, a screen
recording or an `.mp4` dropped into the description is therefore an issue
Handella can plan _around_ but not _from_ — and the video is rarely decoration.
It is usually the bug: the flicker, the wrong order, the thing that is hard to
write down, which is exactly why somebody recorded it instead of writing it
down.

Planning it anyway produces a plan about the half of the issue that was typed.
That plan looks like every other plan, reads as confident, and is wrong in a way
the Handler only discovers by watching the video themselves — at which point
they have read a plan they now have to unpick.

So Handella declines. A Job whose issue names a video is held: it stays in
`planning`, no pass is spawned, it holds no Slot, and one Attention Item names
the URLs and says what to do. The Hold is its own column rather than a
Suspension, because nothing stopped — CONTEXT.md's Suspension is for a Job that
is not progressing abnormally, and this one is progressing exactly as intended,
towards a person.

## What "Open session" does for a held Job

It opens Codex in the worktree with the planning brief already typed — the same
brief a pass would have sent, plus a paragraph saying a video could not be
passed along, naming it, and asking for a local path. The Handler downloads the
recording, drags it in, and the planner watches it and plans. Everything they
add is the one thing Handella could not do.

The brief reaches Codex the way the session id already did: written to a file
beside the launcher and read back as `codex "$prompt"`. The script's text stays
a constant with nothing interpolated into it, which is
[ADR 0011](./0011-the-terminal-opens-the-codex-session.md)'s rule and matters
more here than it did there — a session id is a UUID, and a brief is an issue
description the Handler wrote, containing whatever they wrote. Asking for a
brief and a session id in one request is refused: one starts a conversation and
the other continues one, and a caller asking for both has not decided which
window it wants.

From there it is an ordinary session. Session Watch discovers it — an
interactive session, in that worktree, started since the Hold began — records
its id against the Job, and follows it like any other (docs/adr/0015). The
first turn that completes moves the Job to `planReview`, and the Handler
approves in the terminal or in the dashboard as usual.

## What counts as a video

Attachments and the description alike, matched on hosts that serve nothing else
(Loom, YouTube, Vimeo) and on path extensions (`.mp4`, `.mov`, `.webm`, `.m4v`,
`.avi`), with the query string ignored so Linear's own signed uploads match. A
scan for URLs rather than a markdown parse, because a video arrives as a bare
link, an embed, a `<video src>` and Linear's own upload syntax, and a parser
that understands three of those and misses the fourth is worse than reading the
text for the thing all four contain.

The asymmetry is deliberate. A false positive holds a Job the Handler could
have let Handella plan, and they see it in their inbox with the URL that caused
it and can open the session themselves — a minute, and they were going to read
the plan anyway. A false negative is a plan written about half an issue, which
costs the whole planning pass and the reading of it. So the matching is
generous, and the list of hosts is short enough to stay honest.

## What was refused

Downloading the video for them. It is behind their Linear credentials or their
Loom account, it lands on their disk, and Handella would be fetching megabytes
over a network it otherwise only uses to ask GitHub questions — to feed it to
an agent that still cannot watch it. Transcribing it server-side is the same
objection plus a dependency and an API key.

Planning without it and noting the gap in the plan was the closest alternative,
and it fails on what the Handler ends up doing: reading a plan, noticing it
never saw the video, watching the video, and rewriting the plan. Holding costs
them the watching alone.
