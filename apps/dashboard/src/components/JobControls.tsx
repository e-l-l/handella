import type { Job } from '@handella/contracts'
import { Link } from 'react-router'

import {
  cancelConsequence,
  useJobControls,
  type JobActionTarget,
  type JobControls as Controls,
} from '../hooks/useJobControls.ts'
import type { JobActionKind } from '../jobPresentation.ts'
import {
  primaryButtonClass,
  quietMutedButtonClass,
  secondaryButtonClass,
} from '../styles.ts'
import { ConfirmDialog } from './ConfirmDialog.tsx'
import { OverflowMenu, type OverflowItem } from './OverflowMenu.tsx'

/**
 * How loud the row's one action is, decided by what the action *is* rather than
 * by which group the row is in.
 *
 * It comes out the same either way — only a row that needs the Handler ever
 * produces a resume or a review — but stating it this way is what makes mint
 * mean one thing on this screen: every mint button is a thing waiting on you,
 * and nothing else is mint. A running job offers a filled secondary because
 * there is somewhere useful to go; a queued or finished one offers a quiet
 * button because there is nothing to do but look.
 */
const weights: Record<JobActionKind, string> = {
  dispatch: secondaryButtonClass,
  open: quietMutedButtonClass,
  openSession: secondaryButtonClass,
  resume: primaryButtonClass,
  reviewPlan: primaryButtonClass,
  reviewPr: primaryButtonClass,
  view: quietMutedButtonClass,
}

/**
 * Where a row has less width for a label than a card does, the row says it
 * shorter.
 *
 * Only the pull request needs it: Home's attention card is asking the Handler
 * to review one, and a row is listing where it is. Both go to the same place,
 * and neither is the word the other should use — a row of eight jobs cannot
 * spend a hundred and seventy pixels on one of them and stay a column.
 */
const rowLabels: Partial<Record<JobActionKind, string>> = {
  reviewPr: 'Open PR',
}

/**
 * A `JobActionTarget` drawn as the control it is: a pull request opens in a
 * new tab, a destination is a link, and a move is a button. `replace` is for a
 * link on the page it points at — the job page's banner switching its own tab
 * — where a history entry per click would make Back walk through tabs.
 */
export function JobActionButton({
  className,
  label,
  pending = false,
  replace = false,
  target,
}: {
  className: string
  label?: string
  pending?: boolean
  replace?: boolean
  target: JobActionTarget
}) {
  const text = label ?? target.label
  if ('href' in target)
    return (
      <a
        className={className}
        href={target.href}
        rel="noreferrer"
        target="_blank"
      >
        {text}
      </a>
    )
  if ('to' in target)
    return (
      <Link className={className} replace={replace} to={target.to}>
        {text}
      </Link>
    )
  return (
    <button
      className={className}
      disabled={pending || target.disabled === true}
      onClick={target.act}
      type="button"
    >
      {text}
    </button>
  )
}

/** The one confirmation a cancel goes through, however it was requested. */
export function CancelJobDialog({
  cancel,
  job,
}: {
  cancel: Controls['cancel']
  job: Job
}) {
  if (!cancel.requested) return null
  return (
    <ConfirmDialog
      confirmLabel="Cancel job"
      consequence={cancelConsequence}
      onCancel={cancel.close}
      onConfirm={cancel.confirm}
      pending={cancel.pending}
      title={`Cancel “${job.title}”?`}
    />
  )
}

/**
 * A job's one action and the `···` holding everything else, for a row in the
 * Jobs list.
 *
 * The reason the list has actions at all: dispatching a job, stopping one or
 * standing in its worktree used to mean opening it first, and the job page is
 * not where those decisions are made — the list is. What changed in the revamp
 * is that the list no longer shows all of them at once. Each row used to carry
 * two identical outline buttons, which is exactly the complaint the handoff
 * sets out to fix.
 */
export function JobControls({
  extraOverflow = [],
  job,
  muted = false,
}: {
  /**
   * Menu entries only the surrounding list can build — reordering the queue
   * needs the whole order, not one job.
   */
  extraOverflow?: OverflowItem[]
  job: Job
  /** Borderless `···`, for a row the list has already de-emphasised. */
  muted?: boolean
}) {
  const { action, cancel, failure, overflow, pending } = useJobControls(job)

  const weight = weights[action.kind]
  // The pending labels ("Resuming…", "Dispatching…") belong to the action and
  // are never overridden; only the settled wording is shortened for a row.
  const label = rowLabels[action.kind] ?? action.label
  const items =
    extraOverflow.length === 0
      ? overflow
      : [...extraOverflow, { kind: 'separator' as const }, ...overflow]

  return (
    <>
      <JobActionButton
        className={weight}
        label={label}
        pending={pending}
        target={action}
      />

      <OverflowMenu
        items={items}
        label={`More actions for ${job.title}`}
        muted={muted}
      />

      <CancelJobDialog cancel={cancel} job={job} />

      {/* On the row, because that is where the button that failed is. It
          replaces the action's own label rather than sitting under the list,
          where a Handler would have to work out which row it belonged to. */}
      {failure === null ? null : (
        <span
          className="max-w-[220px] truncate text-[12px] text-red-ink"
          role="alert"
          title={failure.message}
        >
          {failure.message}
        </span>
      )}
    </>
  )
}
