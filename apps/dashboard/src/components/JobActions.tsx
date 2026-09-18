import { legalTransitionsFrom, type Job } from '@handella/contracts'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { attentionKeys } from '../api/attention.ts'
import { jobKeys, resumeJob, suspendJob, transitionJob } from '../api/jobs.ts'
import { stateLabels } from '../labels.ts'

const buttonClass =
  'rounded-full bg-surface-raised px-3 py-1.5 text-sm font-medium text-ink ring-1 ring-line disabled:opacity-50'

/**
 * Every button here comes from the shared transition table, so the dashboard
 * cannot offer a move the service would refuse.
 */
export function JobActions({ job }: { job: Job }) {
  const queryClient = useQueryClient()
  // Moving or suspending a job also opens and resolves attention items, so both
  // caches go stale together.
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: jobKeys.all }),
      queryClient.invalidateQueries({ queryKey: attentionKeys.all }),
    ])
  }

  const move = useMutation({
    mutationFn: (to: Job['state']) => transitionJob(job.id, to),
    onSettled: refresh,
  })
  const suspend = useMutation({
    mutationFn: () => suspendJob(job.id, 'stoppedByHandler'),
    onSettled: refresh,
  })
  const resume = useMutation({
    mutationFn: () => resumeJob(job.id),
    onSettled: refresh,
  })

  const pending = move.isPending || suspend.isPending || resume.isPending
  const targets = legalTransitionsFrom(job.state)
  const failure = move.error ?? suspend.error ?? resume.error

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {targets.length === 0 ? (
          <p className="text-sm text-muted">
            This job has reached the end of its life.
          </p>
        ) : (
          targets.map((to) => (
            <button
              className={buttonClass}
              disabled={pending}
              key={to}
              onClick={() => move.mutate(to)}
              type="button"
            >
              Move to {stateLabels[to]}
            </button>
          ))
        )}

        {job.suspension === null ? (
          <button
            className={buttonClass}
            disabled={pending}
            onClick={() => suspend.mutate()}
            type="button"
          >
            Suspend
          </button>
        ) : (
          <button
            className={buttonClass}
            disabled={pending}
            onClick={() => resume.mutate()}
            type="button"
          >
            Resume
          </button>
        )}
      </div>

      {failure === null || failure === undefined ? null : (
        <p className="text-sm text-danger" role="alert">
          {failure.message}
        </p>
      )}
    </div>
  )
}
