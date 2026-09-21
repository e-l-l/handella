import {
  isAwaitingMerge,
  isTerminalJobState,
  legalTransitionsFrom,
  type Job,
} from '@handella/contracts'
import { useMutation } from '@tanstack/react-query'

import {
  checkJobMerge,
  dispatchJob,
  openJobTerminal,
  resumeJob,
  suspendJob,
  transitionJob,
  useJobRefresh,
} from '../api/jobs.ts'
import { stateLabels } from '../labels.ts'
import { secondaryButtonClass } from '../styles.ts'

/**
 * Where these buttons are being drawn, which decides how many of them there
 * are rather than only how they look.
 *
 * `panel` is the job page's card and offers every legal move. `row` is a line
 * in the jobs list, where the moves are dropped and what is left is what the
 * Handler opened the list for: dispatch it, stop it, look inside it. A row is
 * one mis-click from `cancelled` and a cancelled job never comes back, and the
 * row is itself a link to the page that does offer the rest.
 */
type Variant = 'panel' | 'row'

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
export function JobActions({
  job,
  variant = 'panel',
}: {
  job: Job
  variant?: Variant
}) {
  const refresh = useJobRefresh()

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
  // Nothing to refresh: this puts a window on the Handler's screen and changes
  // no record, so the only thing it can report back is that it could not.
  const terminal = useMutation({ mutationFn: () => openJobTerminal(job.id) })
  const checkMerge = useMutation({
    mutationFn: () => checkJobMerge(job.id),
    onSettled: refresh,
  })

  const pending =
    move.isPending ||
    suspend.isPending ||
    resume.isPending ||
    dispatch.isPending ||
    checkMerge.isPending
  const isPanel = variant === 'panel'
  const canDispatch = job.state === 'intake'
  // `intake -> queued` is Dispatch's edge, not a plain move: it is offered as
  // the Dispatch button above rather than twice in the same row.
  const targets = legalTransitionsFrom(job.state).filter(
    (to) => !(canDispatch && to === 'queued'),
  )
  const overForGood = isTerminalJobState(job.state)
  const failure =
    move.error ??
    suspend.error ??
    resume.error ??
    dispatch.error ??
    checkMerge.error ??
    terminal.error

  return (
    <div className={`flex flex-col ${isPanel ? 'gap-3' : 'items-end gap-1.5'}`}>
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

        {/* Moves are the panel's alone. A row is one mis-click from
            `cancelled`, and the row is itself a link to the page that offers
            them. The sentence goes with them: a row that had reached the end
            of its life would be saying so on every line of a finished list. */}
        {isPanel
          ? targets.map((to) => (
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
          : null}

        {isPanel && overForGood ? (
          <p className="text-[13px] text-ink-3">
            This job has reached the end of its life.
          </p>
        ) : null}

        {/* A job that has reached the end of its life is not stopped, it is
            over, and the service refuses to suspend one — so it is not offered
            here either. The rule above holds for this button too: the
            dashboard does not offer what the service would refuse. */}
        {overForGood ? null : job.suspension === null ? (
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

        {/* Reconciliation asks every few minutes anyway; this is for the
            Handler who has just merged and does not want to wait for it. On
            the panel alone, because a row offers what the list was opened
            for and this is a question about one job rather than a move. */}
        {isPanel && isAwaitingMerge(job) ? (
          <button
            className={secondaryButtonClass}
            disabled={pending}
            onClick={() => checkMerge.mutate()}
            type="button"
          >
            {checkMerge.isPending ? 'Asking GitHub…' : 'Check merge'}
          </button>
        ) : null}

        {/* Only once there is a worktree to stand in, which Dispatch cuts. It
            is offered for every dispatched job rather than only a running one:
            what the Handler wants to see mid-pass is also what they want to
            see the moment it stops.

            Labelled by what it will actually do. A job that has not planned
            yet has no session to resume, and the window is then only a shell
            — calling both of them the same thing would make the session the
            Handler came for look like it had not opened. */}
        {job.worktreePath === null ? null : (
          <button
            className={secondaryButtonClass}
            disabled={terminal.isPending}
            onClick={() => terminal.mutate()}
            type="button"
          >
            {terminal.isPending
              ? 'Opening…'
              : job.codexSessionId === null
                ? 'Open terminal'
                : 'Open session'}
          </button>
        )}
      </div>

      {/* Said where the button is rather than in the docs, because the cost is
          paid by whoever clicks it: resuming puts a second voice into the
          session Handella's next pass resumes from. The panel says it; a row
          would be saying it on every line of the list. */}
      {isPanel && job.codexSessionId !== null ? (
        <p className="text-[13px] text-ink-3">
          Opening the session resumes it. Anything you send there is a turn
          Handella’s next pass will continue from, and a job that is planning or
          implementing is being written to right now.
        </p>
      ) : null}

      {failure === null || failure === undefined ? null : (
        <p className="text-[13px] text-red-ink" role="alert">
          {failure.message}
        </p>
      )}
    </div>
  )
}
