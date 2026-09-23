import type { Attempt } from '@handella/contracts'
import { isAttemptRunning } from '@handella/contracts'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { fetchAttemptLog, jobKeys } from '../api/jobs.ts'
import {
  attemptLabel,
  attemptOutcomeLabel,
  formatDuration,
  formatTimestamp,
} from '../labels.ts'
import { emptyPanelClass, quietButtonClass } from '../styles.ts'

/**
 * The raw stream, fetched only when the Handler opens it. A tail by default: a
 * ninety-minute turn is megabytes of JSONL, and the end of it is the part that
 * says what happened.
 */
function RawLog({
  attemptId,
  jobId,
  running,
}: {
  attemptId: string
  jobId: string
  running: boolean
}) {
  const [full, setFull] = useState(false)
  const log = useQuery({
    queryKey: jobKeys.attemptLog(jobId, attemptId, full),
    queryFn: () => fetchAttemptLog(jobId, attemptId, { full }),
    // A finished turn's log does not change, and a running one's tail is a
    // deliberate ask. Opening it again is that ask, so a running turn's log is
    // read afresh each time it is shown rather than frozen at the first one.
    refetchOnMount: running ? 'always' : false,
    staleTime: Infinity,
  })

  if (log.isPending) {
    return (
      <p className="text-[12.5px] text-ink-4" role="status">
        Reading the log…
      </p>
    )
  }

  if (log.data === undefined) {
    return (
      <p className="text-[12.5px] text-amber-ink" role="alert">
        {log.error?.message ?? 'That log could not be read.'}
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {log.data.truncated ? (
        <button
          className={`self-start ${quietButtonClass}`}
          onClick={() => setFull(true)}
          type="button"
        >
          Showing the end of this log · load all of it
        </button>
      ) : null}
      <pre className="max-h-80 overflow-auto rounded-xl bg-deep p-3.5 font-mono text-[11px] leading-[1.5] text-ink-3">
        {log.data.text === '' ? 'This log is no longer kept.' : log.data.text}
      </pre>
    </div>
  )
}

/**
 * One turn's log, opened on demand.
 *
 * Its own tab rather than folded into the timeline, which is where these used
 * to live. The spine is meant to be read at a glance and a raw log is the
 * opposite of that — so the timeline says which turns there were, and this
 * says what they wrote.
 *
 * Newest first, and every one closed. Opening the tab is not the same ask as
 * opening a log: the default tail is a quarter of a megabyte and a running
 * turn's is still being written, so nothing is read until a turn is asked for
 * by name.
 */
export function JobLogs({
  attempts,
  jobId,
}: {
  attempts: Attempt[]
  jobId: string
}) {
  const newestFirst = [...attempts].reverse()
  const [openId, setOpenId] = useState<string | null>(null)

  if (attempts.length === 0) {
    return (
      <p className={emptyPanelClass}>
        No implementation turn has run yet. A log appears here for each turn
        Codex takes once the plan is approved.
      </p>
    )
  }

  return (
    <ul className="flex flex-col gap-2.5">
      {newestFirst.map((attempt) => {
        const open = attempt.id === openId
        const running = isAttemptRunning(attempt)

        return (
          <li
            className="flex flex-col gap-3 rounded-xl border border-line bg-raised px-4 py-3.5"
            key={attempt.id}
          >
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-[14px] font-medium">
                {attemptLabel(attempt, 'Attempt')}
              </p>
              <p className="font-mono text-[11px] text-ink-4">
                {attemptOutcomeLabel(attempt)}
              </p>
              <p className="font-mono text-[11px] text-ink-6">
                {formatTimestamp(attempt.startedAt)} ·{' '}
                {formatDuration(attempt.startedAt, attempt.endedAt)}
              </p>
              <button
                className={`ml-auto ${quietButtonClass}`}
                onClick={() => setOpenId(open ? null : attempt.id)}
                type="button"
              >
                {open ? 'Hide log' : 'Show log'}
              </button>
            </div>

            {attempt.failureReason === null ? null : (
              <p className="text-[13px] leading-[1.55] text-amber-ink">
                {attempt.failureReason}
              </p>
            )}

            {open ? (
              <RawLog attemptId={attempt.id} jobId={jobId} running={running} />
            ) : running ? (
              <p className="text-[12.5px] text-ink-4">
                This turn is still running, so its log is still being written.
              </p>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}
