import type {
  Attempt,
  JobTransitionRecord,
  Milestone,
} from '@handella/contracts'
import { isAttemptRunning } from '@handella/contracts'
import { useQuery } from '@tanstack/react-query'
import { memo, useMemo, useState } from 'react'

import { fetchAttemptLog, jobKeys } from '../api/jobs.ts'
import {
  attemptLabel,
  attemptOutcomeLabels,
  formatDuration,
  formatTimestamp,
  milestoneKindLabels,
  stateLabels,
} from '../labels.ts'

/**
 * Mint has finished or is healthy (`Chip`), and a job that was cancelled did
 * neither: the move happened, but it ended the job rather than advancing it,
 * so it is marked rather than ticked.
 */
const glyphs: Record<
  'ended' | 'passed' | 'running',
  { className: string; mark: string }
> = {
  ended: {
    className: 'border-line-strong bg-raised-alt text-ink-4',
    mark: '·',
  },
  passed: {
    className: 'border-mint/40 bg-mint/[0.18] text-mint',
    mark: '✓',
  },
  running: {
    className: 'border-mint/40 bg-mint/[0.08] text-mint',
    mark: '▸',
  },
}

/** A turn that ended with nothing to show for it is marked, not ticked. */
const attemptGlyph = (attempt: Attempt) => {
  if (isAttemptRunning(attempt)) return glyphs.running
  return attempt.outcome === 'reportedDone' ? glyphs.passed : glyphs.ended
}

/**
 * One row of the spine. The glyph and the connector live here rather than in
 * each kind of beat, so a transition and an attempt line up on the same rail.
 */
function Beat({
  children,
  glyph,
  last,
}: {
  children: React.ReactNode
  glyph: { className: string; mark: string }
  last: boolean
}) {
  return (
    <li className="grid grid-cols-[26px_1fr] gap-3.5">
      <div className="flex flex-col items-center">
        <span
          aria-hidden="true"
          className={`grid size-[22px] place-items-center rounded-full border font-mono text-[10.5px] ${glyph.className}`}
        >
          {glyph.mark}
        </span>
        {last ? null : (
          <span
            aria-hidden="true"
            className="min-h-[26px] w-px flex-1 bg-mint-soft/12"
          />
        )}
      </div>
      <div className="pb-4">{children}</div>
    </li>
  )
}

/**
 * The raw stream, fetched only when the Handler opens it. A tail by default:
 * a ninety-minute turn is megabytes of JSONL, and the end of it is the part
 * that says what happened.
 */
function RawLog({ attemptId, jobId }: { attemptId: string; jobId: string }) {
  const [full, setFull] = useState(false)
  const log = useQuery({
    queryKey: [...jobKeys.attemptLog(jobId, attemptId), full],
    queryFn: () => fetchAttemptLog(jobId, attemptId, { full }),
    // The key sits under the `jobs` prefix, so every `job.changed` would
    // otherwise re-download an open log — a quarter of a megabyte by default,
    // and the whole file once the Handler has asked for all of it. A finished
    // turn's log does not change, and a running one's tail is a deliberate ask.
    staleTime: Infinity,
  })

  if (log.isPending) {
    return (
      <p className="mt-2 text-[12.5px] text-ink-4" role="status">
        Reading the log…
      </p>
    )
  }

  if (log.data === undefined) {
    return (
      <p className="mt-2 text-[12.5px] text-amber" role="alert">
        {log.error?.message ?? 'That log could not be read.'}
      </p>
    )
  }

  return (
    <div className="mt-2">
      {log.data.truncated ? (
        <button
          className="mb-2 font-mono text-[11px] text-ink-4 underline"
          onClick={() => setFull(true)}
          type="button"
        >
          Showing the end of this log · load all of it
        </button>
      ) : null}
      <pre className="max-h-80 overflow-auto rounded-xl bg-surface p-3 font-mono text-[11px] leading-[1.5] text-ink-3">
        {log.data.text === '' ? 'This log is no longer kept.' : log.data.text}
      </pre>
    </div>
  )
}

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
    <li className="py-1">
      <div className="flex items-baseline gap-2.5">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.5px] text-ink-5">
          {milestoneKindLabels[milestone.kind]}
        </span>
        <span
          className={`font-mono text-[12px] ${failed ? 'text-amber' : 'text-ink-2'}`}
        >
          {milestone.summary}
        </span>
        {milestone.exitCode === null ? null : (
          <span
            className={`font-mono text-[11px] ${failed ? 'text-amber' : 'text-ink-5'}`}
          >
            exit {milestone.exitCode}
          </span>
        )}
        <span className="ml-auto font-mono text-[10.5px] text-ink-6">
          {formatTimestamp(milestone.occurredAt)}
        </span>
      </div>
      {milestone.detail === null ? null : (
        <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-surface px-2.5 py-2 font-mono text-[11px] leading-[1.5] text-ink-4">
          {milestone.detail}
        </pre>
      )}
    </li>
  )
})

/**
 * One turn, with its beats inside it. Open while it is running and closed once
 * it is over: the turn the Handler is watching is the one they have not read,
 * and a finished job should not unroll three hundred rows on arrival.
 */
function AttemptGroup({
  attempt,
  jobId,
  milestones,
}: {
  attempt: Attempt
  jobId: string
  milestones: Milestone[]
}) {
  const running = isAttemptRunning(attempt)
  const [showLog, setShowLog] = useState(false)

  const outcome =
    attempt.outcome === null ? 'running' : attemptOutcomeLabels[attempt.outcome]

  return (
    <details open={running}>
      <summary className="flex cursor-pointer items-center gap-3 text-[14.5px] font-medium text-ink-2">
        {attemptLabel(attempt, 'Attempt')}
        <span className="font-mono text-[11px] text-ink-4">{outcome}</span>
        <span className="ml-auto font-mono text-[11px] text-ink-6">
          {formatDuration(attempt.startedAt, attempt.endedAt)}
        </span>
      </summary>

      {milestones.length === 0 ? (
        <p className="mt-2 text-[13px] text-ink-4">
          {running
            ? 'Waiting for the first milestone…'
            : 'This turn said nothing.'}
        </p>
      ) : (
        <ol className="mt-2">
          {milestones.map((milestone) => (
            <MilestoneRow key={milestone.id} milestone={milestone} />
          ))}
        </ol>
      )}

      {attempt.failureReason === null ? null : (
        <p className="mt-2 text-[13px] leading-[1.55] text-amber">
          {attempt.failureReason}
        </p>
      )}

      <button
        className="mt-2 font-mono text-[11px] text-ink-4 underline"
        onClick={() => setShowLog((open) => !open)}
        type="button"
      >
        {showLog ? 'Hide raw log' : 'Raw log'}
      </button>
      {showLog ? <RawLog attemptId={attempt.id} jobId={jobId} /> : null}
    </details>
  )
}

type SpineBeat =
  | { at: string; attempt: Attempt; kind: 'attempt' }
  | { at: string; kind: 'transition'; transition: JobTransitionRecord }

/**
 * Where the job has been and what it did while it was there, on one spine.
 *
 * Interleaved by time rather than nested under a transition, because a round of
 * repair turns happens without the job moving at all: three attempts sit
 * between `approved -> implementing` and `implementing -> prOpen`, and a spine
 * that hung them off the transition could not say that.
 */
export function JobTimeline({
  attempts,
  jobId,
  milestones,
  transitions,
}: {
  attempts: Attempt[]
  jobId: string
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
      if (group === undefined) {
        groups.set(milestone.attemptId, [milestone])
      } else {
        group.push(milestone)
      }
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
      ].sort((left, right) => left.at.localeCompare(right.at)),
    [attempts, transitions],
  )

  if (beats.length === 0) {
    return <p className="text-[13px] text-ink-3">This job has not moved yet.</p>
  }

  return (
    <ol className="flex flex-col">
      {beats.map((beat, index) => {
        const last = index === beats.length - 1

        if (beat.kind === 'attempt') {
          return (
            <Beat
              glyph={attemptGlyph(beat.attempt)}
              key={beat.attempt.id}
              last={last}
            >
              <AttemptGroup
                attempt={beat.attempt}
                jobId={jobId}
                milestones={byAttempt.get(beat.attempt.id) ?? []}
              />
            </Beat>
          )
        }

        const { transition } = beat
        return (
          <Beat
            glyph={
              transition.toState === 'cancelled' ? glyphs.ended : glyphs.passed
            }
            key={transition.id}
            last={last}
          >
            <p className="flex items-center gap-3 text-[14.5px] font-medium text-ink-2">
              {stateLabels[transition.fromState]} →{' '}
              {stateLabels[transition.toState]}
              <span className="ml-auto font-mono text-[11px] text-ink-6">
                {formatTimestamp(transition.occurredAt)}
              </span>
            </p>
            <p className="mt-1.5 text-[13px] leading-[1.55] text-ink-3">
              {transition.actor === 'handler' ? 'You' : 'Handella'}
              {transition.reason === null ? '' : ` · ${transition.reason}`}
            </p>
          </Beat>
        )
      })}
    </ol>
  )
}
