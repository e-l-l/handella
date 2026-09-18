import type { Job, JobState, JobSuspension } from '@handella/contracts'

import { isRunning } from '../jobViews.ts'
import { stateLabels, suspensionLabels } from '../labels.ts'
import { Chip, type Tone } from './Chip.tsx'

/**
 * The palette carries the state, so the mapping is stated once: mint is
 * healthy or finished, amber waits on the Handler, red failed, and a flat
 * secondary chip is a job that is merely holding its place.
 */
const stateTones: Record<JobState, Tone> = {
  intake: 'outline',
  queued: 'solid',
  planning: 'mint',
  planReview: 'amber',
  approved: 'mint',
  implementing: 'mint',
  prOpen: 'mint',
  reviewing: 'amber',
  merged: 'mint',
  archived: 'quiet',
  cancelled: 'quiet',
}

/** A restart is not a failure, and neither is the Handler stopping a job. */
const suspensionTones: Record<JobSuspension, Tone> = {
  stoppedByHandler: 'amber',
  stoppedBySystem: 'red',
  interrupted: 'amber',
}

export function JobStateBadge({ job }: { job: Job }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {/* The dot marks a job holding a Codex slot, which is the scheduler's
          question rather than the badge's: `jobViews` answers it. */}
      <Chip dot={isRunning(job)} tone={stateTones[job.state]}>
        {stateLabels[job.state]}
      </Chip>
      {job.suspension === null ? null : (
        <Chip dot tone={suspensionTones[job.suspension]}>
          {suspensionLabels[job.suspension]}
        </Chip>
      )}
    </span>
  )
}
