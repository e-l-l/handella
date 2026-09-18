import { terminalJobStates, type Job, type JobState } from '@handella/contracts'

import { stateLabels, suspensionLabels } from '../labels.ts'

const waitingStates: readonly JobState[] = ['intake', 'planReview', 'prOpen']

const toneFor = (state: JobState): string => {
  if (terminalJobStates.includes(state)) return 'bg-surface-raised text-muted'
  if (state === 'merged') return 'bg-positive-soft text-positive'
  if (waitingStates.includes(state)) return 'bg-brand-soft text-brand'
  return 'bg-surface-raised text-ink'
}

export function JobStateBadge({ job }: { job: Job }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span
        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${toneFor(job.state)}`}
      >
        {stateLabels[job.state]}
      </span>
      {job.suspension === null ? null : (
        <span className="inline-flex rounded-full bg-danger-soft px-2.5 py-1 text-xs font-semibold text-danger">
          {suspensionLabels[job.suspension]}
        </span>
      )}
    </span>
  )
}
