import type { IntakeIssue } from '@handella/contracts'

import { linearPriorityLabels } from '../labels.ts'

/**
 * `heldByJobId` is the job that already owns this issue, if one does. A Linear
 * issue belongs to at most one live job, so an issue that is already spoken for
 * is shown rather than hidden: knowing why it cannot be taken is the point.
 *
 * Renders a `div` rather than a `li`: the page pairs each row with its own
 * outcome message, and both belong inside one list item.
 */
export function LinearIssueRow({
  offer,
  onToggle,
  selected,
}: {
  offer: IntakeIssue
  onToggle: () => void
  selected: boolean
}) {
  const { heldByJobId, issue, plannedBranch, round } = offer
  const unavailable = heldByJobId !== null

  return (
    <div className="flex items-start gap-3 rounded-2xl border border-line bg-surface p-4">
      <input
        aria-label={`Select ${issue.identifier}`}
        checked={selected}
        className="mt-1"
        disabled={unavailable}
        onChange={onToggle}
        type="checkbox"
      />
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-sm font-medium">
          {issue.identifier} · {issue.title}
        </p>
        <p className="text-xs text-muted">
          {issue.stateName} · {linearPriorityLabels[issue.priority]} ·{' '}
          <code>{plannedBranch}</code>
        </p>
        {unavailable ? (
          <p className="text-xs text-muted">
            Already the Linear issue for an active job.
          </p>
        ) : null}
        {round > 1 ? (
          <p className="text-xs text-muted">
            Worked before, so this job gets its own branch.
          </p>
        ) : null}
      </div>
    </div>
  )
}
