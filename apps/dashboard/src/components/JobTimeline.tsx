import type {
  Attempt,
  Job,
  JobTransitionRecord,
  Milestone,
} from '@handella/contracts'
import { isAttemptRunning } from '@handella/contracts'
import { memo, useMemo, type ReactNode } from 'react'

import { waitingSince } from '../jobPresentation.ts'
import {
  attemptLabel,
  attemptOutcomeLabel,
  formatClock,
  formatDuration,
  milestoneKindLabels,
  stateLabels,
} from '../labels.ts'

/**
 * The three nodes the handoff draws on the spine.
 *
 * `current` is amber because amber waits: the newest node on a job that has
 * stopped is the one the Handler is standing at. `passed` is a mint tick.
 * `ended` is neither — a cancelled job's last move happened, but it ended the
 * job rather than advancing it, so it is marked rather than ticked.
 */
const nodes: Record<
  'current' | 'ended' | 'passed',
  { className: string; mark: string }
> = {
  current: {
    className: 'border-amber/[0.45] bg-amber/[0.18] text-amber text-[10px]',
    mark: '●',
  },
  ended: {
    className: 'border-line-strong bg-control text-ink-4 text-[10px]',
    mark: '·',
  },
  passed: {
    className: 'border-mint/40 bg-mint/[0.16] text-mint text-[9px]',
    mark: '✓',
  },
}

/**
 * One row of the spine. The node and the connector live here rather than in
 * each kind of beat, so a transition and an attempt line up on the same rail.
 */
function Beat({
  children,
  last,
  node,
}: {
  children: ReactNode
  last: boolean
  node: { className: string; mark: string }
}) {
  return (
    <li className="grid grid-cols-[22px_1fr] gap-3.5">
      <div className="flex flex-col items-center">
        <span
          aria-hidden="true"
          className={`grid size-[18px] flex-none place-items-center rounded-full border font-mono leading-none ${node.className}`}
        >
          {node.mark}
        </span>
        {last ? null : (
          <span
            aria-hidden="true"
            className="min-h-[22px] w-px flex-1 bg-mint-soft/[0.12]"
          />
        )}
      </div>
      <div className="min-w-0 pb-[18px]">{children}</div>
    </li>
  )
}

/** The title line every beat shares: what happened, and when. */
function BeatHead({
  at,
  current = false,
  title,
}: {
  at: string
  current?: boolean
  title: string
}) {
  return (
    <div className="flex items-center gap-2.5">
      <p
        className={`min-w-0 text-[14.5px] ${
          current ? 'font-[550] text-ink' : 'font-medium text-ink-2'
        }`}
      >
        {title}
      </p>
      <span className="ml-auto flex-none font-mono text-[11px] text-ink-6">
        {formatClock(at)}
      </span>
    </div>
  )
}

const beatBodyClass = 'mt-[5px] text-[13px] leading-[1.55] text-ink-3'

// Memoised because the spine invalidates about once a second while a turn
// runs, and React Query's structural sharing keeps the identity of every
// milestone that did not change — which, on any given beat, is all but one.
const MilestoneRow = memo(function MilestoneRow({
  milestone,
}: {
  milestone: Milestone
}) {
  const failed = milestone.exitCode !== null && milestone.exitCode !== 0

  return (
    <li className="flex flex-wrap items-baseline gap-2.5 py-1">
      <span className="font-mono text-[10.5px] uppercase tracking-[0.09em] text-ink-5">
        {milestoneKindLabels[milestone.kind]}
      </span>
      <span
        className={`min-w-0 font-mono text-[12px] ${failed ? 'text-amber-ink' : 'text-ink-2'}`}
      >
        {milestone.summary}
      </span>
      {milestone.exitCode === null ? null : (
        <span
          className={`font-mono text-[11px] ${failed ? 'text-amber-ink' : 'text-ink-5'}`}
        >
          exit {milestone.exitCode}
        </span>
      )}
      <span className="ml-auto font-mono text-[10.5px] text-ink-6">
        {formatClock(milestone.occurredAt)}
      </span>
    </li>
  )
})

type SpineBeat =
  | { at: string; attempt: Attempt; kind: 'attempt' }
  | { at: string; kind: 'transition'; transition: JobTransitionRecord }

/**
 * Where the job has been and what it did while it was there, on one spine.
 *
 * **Newest first**, which the revamp changed: the entry a Handler opening a
 * stuck job needs is the last thing that happened, and it used to be at the
 * bottom of a list that grows all day.
 *
 * Interleaved by time rather than nested under a transition, because a round of
 * repair turns happens without the job moving at all: three attempts sit
 * between `approved -> implementing` and `implementing -> prOpen`, and a spine
 * that hung them off the transition could not say that.
 *
 * The raw logs used to be folded into each turn here. They are their own tab
 * now: a megabyte of JSONL is not a beat on a timeline.
 */
export function JobTimeline({
  attempts,
  job,
  milestones,
  transitions,
}: {
  attempts: Attempt[]
  job: Job
  milestones: Milestone[]
  transitions: JobTransitionRecord[]
}) {
  // Grouped once rather than filtered per attempt: a running job invalidates
  // its milestones about once a second, and a filter per turn would walk the
  // whole list once for every turn on every beat.
  const byAttempt = useMemo(() => {
    const groups = new Map<string, Milestone[]>()
    for (const milestone of milestones) {
      const group = groups.get(milestone.attemptId)
      if (group === undefined) groups.set(milestone.attemptId, [milestone])
      else group.push(milestone)
    }
    return groups
  }, [milestones])

  const beats: SpineBeat[] = useMemo(
    () =>
      [
        ...transitions.map((transition): SpineBeat => ({
          at: transition.occurredAt,
          kind: 'transition',
          transition,
        })),
        ...attempts.map((attempt): SpineBeat => ({
          at: attempt.startedAt,
          attempt,
          kind: 'attempt',
        })),
      ].sort((left, right) => right.at.localeCompare(left.at)),
    [attempts, transitions],
  )

  /**
   * The synthetic newest node, for a job that is not moving. The handoff draws
   * it as "Waiting on you since 13:02", and it is the whole reason the spine is
   * newest-first: it is the sentence that says the job is stopped rather than
   * slow, and it sits above the move that stopped it.
   */
  const waiting = waitingSince(job)

  if (beats.length === 0 && waiting === null) {
    return (
      <p className="text-[13px] leading-[1.55] text-ink-3">
        This job has not moved yet. Its first entry appears here the moment
        Handella dispatches or plans it.
      </p>
    )
  }

  return (
    <ol className="flex flex-col">
      {waiting === null ? null : (
        <Beat last={beats.length === 0} node={nodes.current}>
          <BeatHead
            at={job.updatedAt}
            current
            title={`Waiting on you since ${formatClock(job.updatedAt)}`}
          />
          <p className={beatBodyClass}>{waiting}</p>
        </Beat>
      )}

      {beats.map((beat, index) => {
        const last = index === beats.length - 1

        if (beat.kind === 'attempt') {
          const { attempt } = beat
          const running = isAttemptRunning(attempt)
          const rows = byAttempt.get(attempt.id) ?? []

          return (
            <Beat
              key={attempt.id}
              last={last}
              node={
                running
                  ? nodes.current
                  : attempt.outcome === 'reportedDone'
                    ? nodes.passed
                    : nodes.ended
              }
            >
              <BeatHead
                at={attempt.startedAt}
                current={running}
                title={`${attemptLabel(attempt, 'Attempt')} · ${attemptOutcomeLabel(
                  attempt,
                )}`}
              />
              {rows.length === 0 ? (
                <p className={beatBodyClass}>
                  {formatDuration(attempt.startedAt, attempt.endedAt)}
                  {running
                    ? ' · waiting for the first milestone'
                    : ' · this turn said nothing'}
                </p>
              ) : (
                /* Folded away, and open only while the turn is running.

                   A ninety-minute turn writes forty milestones, and rendering
                   them inline put three thousand pixels of command output
                   between the newest entry and the transitions underneath it —
                   which is the spine the Handler came to read. The count is on
                   the summary, so what is hidden is still announced. */
                <details className="group" open={running}>
                  <summary
                    className={`cursor-pointer list-none ${beatBodyClass} hover:text-ink-2`}
                  >
                    {formatDuration(attempt.startedAt, attempt.endedAt)} ·{' '}
                    {rows.length} milestone{rows.length === 1 ? '' : 's'}
                    <span aria-hidden="true" className="text-ink-5">
                      {' '}
                      · <span className="group-open:hidden">show</span>
                      <span className="hidden group-open:inline">hide</span>
                    </span>
                  </summary>
                  <ol className="mt-2 border-l border-line pl-3">
                    {rows.map((milestone) => (
                      <MilestoneRow key={milestone.id} milestone={milestone} />
                    ))}
                  </ol>
                </details>
              )}
              {attempt.failureReason === null ? null : (
                <p className="mt-1.5 text-[13px] leading-[1.55] text-amber-ink">
                  {attempt.failureReason}
                </p>
              )}
            </Beat>
          )
        }

        const { transition } = beat
        return (
          <Beat
            key={transition.id}
            last={last}
            node={
              transition.toState === 'cancelled' ? nodes.ended : nodes.passed
            }
          >
            <BeatHead
              at={transition.occurredAt}
              title={`${stateLabels[transition.fromState]} → ${stateLabels[transition.toState]}`}
            />
            <p className={beatBodyClass}>
              {transition.actor === 'handler' ? 'You' : 'Handella'}
              {transition.reason === null ? '' : ` · ${transition.reason}`}
            </p>
          </Beat>
        )
      })}
    </ol>
  )
}
