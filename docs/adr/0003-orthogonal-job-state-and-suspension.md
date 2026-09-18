# Keep a job's lifecycle state and its suspension on separate axes

A Job records where it is with `state` and, separately, whether it is stopped
with a nullable `suspension`. The state union deliberately has no `paused`,
`interrupted` or `blocked` member, because pausing during planning and pausing
during implementation are the same reason at different points in a Job's life,
and one column cannot honestly carry both. Two alternatives were considered:
making `paused` a state alongside a `resumeState` column, which reintroduces the
position axis as a shadow column and fans `paused → every active state` edges
back into the transition table; and enumerating the products, such as
`planningPaused`, which turns four active states and three suspension reasons
into twelve. Keeping the axes apart means the scheduler asks
`suspension IS NULL`, restart recovery is one update over the active states, and
the transition table stays a statement about a Job's life rather than about its
interruptions. A state that waits on the Handler in the ordinary course, such as
`planReview` or `prOpen`, carries no suspension at all: the state already is the
wait, and what the Handler must do about it is an Attention Item.
