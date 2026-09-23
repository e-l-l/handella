import type { IntakeIssue, LinearPriority } from '@handella/contracts'

import { formatAge } from '../labels.ts'
import { issueRowClass, rowIdentifierClass } from '../styles.ts'
import { Tag, type Tone } from './Tag.tsx'

/**
 * Linear's scale runs the opposite way to most — 0 is no priority — and the
 * tag says so in one word rather than in "No priority". Only the top two are
 * coloured: a list where every row carries a tinted rectangle has told the
 * Handler nothing about which row to read.
 */
const priorityTags: Record<LinearPriority, { label: string; tone: Tone }> = {
  0: { label: 'none', tone: 'neutral' },
  1: { label: 'urgent', tone: 'red' },
  2: { label: 'high', tone: 'amber' },
  3: { label: 'medium', tone: 'neutral' },
  4: { label: 'low', tone: 'neutral' },
}

/**
 * One offered issue, and whether the Handler has picked it.
 *
 * `heldByJobId` is the job that already owns this issue, if one does. A Linear
 * issue belongs to at most one live job, so an issue that is already spoken for
 * is shown rather than hidden: knowing why it cannot be taken is the point, and
 * the row now says what to do about it instead of only that it is unavailable.
 *
 * The whole row toggles the selection — the checkbox is the visible affordance,
 * not the only target — and shift-clicking extends from the last row touched.
 * The click is handled on the row rather than the box so both paths go through
 * one handler: a keyboard activation of the box fires a click that bubbles here
 * too, which is why the input itself needs no change handler of its own.
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
  /** `extend` is true when the Handler was holding shift. */
  onToggle: (extend: boolean) => void
  selected: boolean
}) {
  const { heldByJobId, issue, plannedBranch, round } = offer
  const unavailable = heldByJobId !== null
  const priority = priorityTags[issue.priority]

  return (
    <div
      className={`${issueRowClass} ${
        unavailable
          ? 'border border-mint-soft/[0.06] bg-raised-muted opacity-[0.72]'
          : selected
            ? 'border border-mint/30 bg-mint/[0.07]'
            : 'border border-line bg-raised hover:bg-raised-hover'
      }`}
      onClick={(event) => {
        if (unavailable) return
        onToggle(event.shiftKey)
      }}
    >
      <span className="relative inline-flex flex-none">
        <input
          aria-label={`Select ${issue.identifier}`}
          checked={selected}
          className={`size-[17px] appearance-none rounded-[5px] border-[1.5px] ${
            unavailable
              ? 'cursor-not-allowed border-mint-soft/[0.16]'
              : 'border-line-check checked:border-mint checked:bg-mint'
          }`}
          disabled={unavailable}
          // The row above owns the click, including the one a keyboard sends
          // through this box; React only wants a handler here so the checked
          // prop is not read as uncontrolled.
          onChange={() => undefined}
          type="checkbox"
        />
        {selected ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 grid place-items-center font-mono text-[11px] font-bold text-on-mint"
          >
            ✓
          </span>
        ) : null}
      </span>

      <span className={rowIdentifierClass}>{issue.identifier}</span>

      <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <span
          className={`text-[14px] ${
            unavailable ? 'text-ink-2' : 'font-medium'
          }`}
        >
          {issue.title}
        </span>
        {/* The Workflow State the issue actually sits in and the branch this
            job would claim, on one mono line.

            The handoff draws these rows as a title alone, which works for its
            sample data and not for Handella's: a Workflow State only means
            something alongside the team that defined it and is what the Handler
            reads (CONTEXT.md), and ADR 0004 has Intake show the real canonical
            branch *before* the Handler commits to it. Neither survives being
            moved into the panel, which only ever describes what is selected. */}
        <span className="truncate font-mono text-[11.5px] text-ink-5">
          {issue.stateName} · {plannedBranch}
        </span>

        {/* What to do next, never only what is missing: the old row said
            "Already the Linear issue for an active job" and left the Handler
            to work out where that job was. */}
        {unavailable ? (
          <span className="text-[12px] text-ink-4">
            Already has an active job — open it from Jobs instead.
          </span>
        ) : null}
        {round > 1 && !unavailable ? (
          <span className="text-[12px] text-ink-4">
            Worked before, so this job takes its own numbered branch.
          </span>
        ) : null}
      </span>

      {/* Both slots fixed, so the tags line up down the column and the ages
          line up beside them: a list of twenty issues is read by scanning one
          column at a time, and a tag that moves with the length of its own word
          is a column the eye has to re-find on every row. */}
      <span className="flex flex-none items-center gap-2.5">
        <span className="flex w-[82px] flex-none">
          <Tag tone={unavailable ? 'neutral' : priority.tone}>
            {unavailable ? 'in a job' : priority.label}
          </Tag>
        </span>
        <span className="w-[30px] flex-none text-right font-mono text-[11.5px] text-ink-6">
          {formatAge(issue.updatedAt)}
        </span>
      </span>
    </div>
  )
}
