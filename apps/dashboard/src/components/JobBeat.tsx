import type { Job } from '@handella/contracts'

import { useAttempts, useMilestones } from '../hooks/useAttempts.ts'
import { attemptLabel, formatAge, formatDuration } from '../labels.ts'

/**
 * What a running job is doing, read from its own milestones.
 *
 * **No progress bar, deliberately.** The handoff draws one here at "step 4 of
 * 6", and nothing in Handella can name that denominator: a Milestone is a
 * command and how it ended, not a step out of a total, so a bar would be
 * inventing the six and then moving it about as the agent worked. What takes
 * its place is the same line of mono metadata filled with facts that exist —
 * which turn this is out of the three a Handler resume grants, what the agent
 * last did, whether it exited cleanly, and how long it has been going.
 *
 * Shared by Home's in-flight list and the Jobs list so the two cannot describe
 * the same running job differently. At most `maxConcurrency` rows mount this,
 * so the two queries per row are three pairs at worst.
 */
export function JobBeat({
  className = 'truncate font-mono text-[11.5px] text-ink-3',
  job,
}: {
  className?: string
  job: Job
}) {
  const implementing = job.state === 'implementing'
  const attempts = useAttempts(job.id, implementing)
  const milestones = useMilestones(job.id, implementing)

  const attempt = attempts.data?.at(-1)
  const latest = milestones.data?.at(-1)

  // A planning pass produces no spine at all — planning writes no milestones —
  // so the honest line is what it is doing and how long it has been doing it.
  if (!implementing || attempt === undefined) {
    return (
      <span className={className}>
        {job.state === 'planning' ? 'Planning' : 'Starting'} ·{' '}
        {formatAge(job.updatedAt)} in this state
      </span>
    )
  }

  return (
    <span className={className}>
      {attemptLabel(attempt)}
      {latest === undefined ? '' : ` · ${latest.summary}`}
      {latest === undefined || latest.exitCode === null
        ? ''
        : ` · exit ${latest.exitCode}`}
      {' · '}
      {formatDuration(attempt.startedAt, attempt.endedAt)}
    </span>
  )
}
