import { legalTransitionsFrom, type Job } from '@handella/contracts'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { attentionKeys } from '../api/attention.ts'
import {
  dispatchJob,
  jobKeys,
  resumeJob,
  suspendJob,
  transitionJob,
} from '../api/jobs.ts'
import { stateLabels } from '../labels.ts'
import { secondaryButtonClass } from '../styles.ts'

/**
 * Every move here comes from the shared transition table, so the dashboard
 * cannot offer one the service would refuse.
 *
 * Dispatch is the exception, and rendered on its own: CONTEXT.md defines it as
 * three actions rather than a state change, and the service gives it its own
 * endpoint. `intake -> queued` is therefore dropped from the derived buttons,
 * because that edge is Dispatch's and moving along it by hand would claim no
 * branch and cut no worktree.
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
  const dispatch = useMutation({
    mutationFn: () => dispatchJob(job.id),
    onSettled: refresh,
  })

  const pending =
    move.isPending ||
    suspend.isPending ||
    resume.isPending ||
    dispatch.isPending
  const canDispatch = job.state === 'intake'
  // `intake -> queued` is Dispatch's edge, not a plain move: it is offered as
  // the Dispatch button above rather than twice in the same row.
  const targets = legalTransitionsFrom(job.state).filter(
    (to) => !(canDispatch && to === 'queued'),
  )
  const failure = move.error ?? suspend.error ?? resume.error ?? dispatch.error

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-[9px]">
        {canDispatch ? (
          <button
            className={secondaryButtonClass}
            disabled={pending || job.canonicalBranch === null}
            onClick={() => dispatch.mutate()}
            type="button"
          >
            Dispatch
          </button>
        ) : null}

        {targets.length === 0 ? (
          <p className="text-[13px] text-ink-3">
            This job has reached the end of its life.
          </p>
        ) : (
          targets.map((to) => (
            <button
              className={secondaryButtonClass}
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
            className={secondaryButtonClass}
            disabled={pending}
            onClick={() => suspend.mutate()}
            type="button"
          >
            Suspend
          </button>
        ) : (
          <button
            className={secondaryButtonClass}
            disabled={pending}
            onClick={() => resume.mutate()}
            type="button"
          >
            Resume
          </button>
        )}
      </div>

      {failure === null || failure === undefined ? null : (
        <p className="text-[13px] text-red-ink" role="alert">
          {failure.message}
        </p>
      )}
    </div>
  )
}
