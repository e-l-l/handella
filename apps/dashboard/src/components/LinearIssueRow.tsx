import type { IntakeIssue } from '@handella/contracts'

import { formatAge, linearPriorityLabels } from '../labels.ts'
import {
  listRowClass,
  rowAgeClass,
  rowIdentifierClass,
  rowTitleClass,
} from '../styles.ts'
import { Chip } from './Chip.tsx'

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
    <div
      className={`${listRowClass} ${
        selected
          ? 'border border-mint/30 bg-mint/[0.07]'
          : 'border border-line bg-raised'
      } ${unavailable ? 'opacity-60' : ''}`}
    >
      <span className="relative inline-flex flex-none">
        <input
          aria-label={`Select ${issue.identifier}`}
          checked={selected}
          className="size-[19px] appearance-none rounded-[7px] border-[1.5px] border-line-input checked:border-mint checked:bg-mint disabled:cursor-not-allowed"
          disabled={unavailable}
          onChange={onToggle}
          type="checkbox"
        />
        {selected ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 grid place-items-center font-mono text-[11px] font-bold text-deep"
          >
            ✓
          </span>
        ) : null}
      </span>

      <span className={rowIdentifierClass}>{issue.identifier}</span>

      <span className="min-w-0 flex-1">
        <span className={`block ${rowTitleClass}`}>{issue.title}</span>
        <span className="mt-1 block font-mono text-[11px] text-ink-5">
          {plannedBranch}
        </span>
        {unavailable ? (
          <span className="mt-1 block text-[12px] text-amber-ink">
            Already the Linear issue for an active job.
          </span>
        ) : null}
        {round > 1 ? (
          <span className="mt-1 block text-[12px] text-ink-4">
            Worked before, so this job gets its own branch.
          </span>
        ) : null}
      </span>

      <span className="flex items-center gap-2.5">
        <Chip tone="outline">{issue.stateName}</Chip>
        <Chip tone="quiet">{linearPriorityLabels[issue.priority]}</Chip>
        <span className={rowAgeClass}>{formatAge(issue.updatedAt)}</span>
      </span>
    </div>
  )
}
