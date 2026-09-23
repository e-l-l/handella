import type { Job } from '@handella/contracts'
import type { ReactNode } from 'react'
import { Link } from 'react-router'

import {
  groupRowClasses,
  jobGroup,
  jobTag,
  type JobGroup,
} from '../jobPresentation.ts'
import { formatAge, issueKeyLabel } from '../labels.ts'
import {
  listRowClass,
  rowAgeClass,
  rowIdentifierClass,
  rowTitleClass,
} from '../styles.ts'
import { Tag } from './Tag.tsx'

/**
 * The primary list row of the app: the same shape wherever a job is listed.
 *
 * The handoff's anatomy, left to right: a fixed 72px mono issue key, a
 * flexible title block, then a fixed-width right cluster of status tag, age,
 * **one** action and the `···`. Fixed widths on both ends are what make a
 * column of these scannable — the tags line up, the ages line up, and the one
 * button per row lines up under the button above it.
 *
 * The whole row is the link, because a row that only opens from its title is a
 * target the width of a sentence. It is the link by covering itself with one
 * rather than by being one, which is what lets `actions` hold buttons: an
 * anchor may not contain a button, and a click on a control nested inside one
 * navigates as well as acting. The overlay is a positioned element and so
 * paints over the static text beside it; the actions sit above the overlay in
 * turn and take their own clicks.
 */
export function JobRow({
  actions,
  job,
  meta,
  note,
  position,
}: {
  /** The row's one action and its overflow menu. */
  actions?: ReactNode | undefined
  job: Job
  /** The second line of the title block — a branch, a step, a work class. */
  meta?: ReactNode | undefined
  /**
   * Why this row needs the Handler, printed beneath the card rather than
   * inside it. The handoff puts it outside so the row's own grid stays the
   * same height as every other row in the list.
   */
  note?: string | undefined
  /** Its place in the queue, for a row that is holding one. */
  position?: number | undefined
}) {
  const group: JobGroup = jobGroup(job)
  const tag = jobTag(job)
  const finished = group === 'finished'

  return (
    <li className="flex flex-col gap-1.5">
      <div className={`relative ${listRowClass} ${groupRowClasses[group]}`}>
        <Link
          // Named rather than labelled by its contents: the overlay holds no
          // text, and repeating the whole row inside it would put the same
          // words on the screen twice for anything reading the row rather than
          // looking at it. The identifier is named as well as the title,
          // because a list of these read on their own is how a Handler finds
          // one issue again.
          aria-label={`Open ${issueKeyLabel(job)}: ${job.title}`}
          className="absolute inset-0 rounded-[inherit]"
          to={`/jobs/${job.id}`}
        />

        <span className={rowIdentifierClass}>
          {position === undefined ? null : (
            <span className="mr-2 text-ink-6">{position}</span>
          )}
          {issueKeyLabel(job)}
        </span>

        <span className="flex min-w-0 flex-1 flex-col gap-[5px]">
          <span
            className={`truncate ${rowTitleClass} ${finished ? 'font-normal text-ink-2' : ''}`}
          >
            {job.title}
          </span>
          {meta}
        </span>

        {/* Every slot in here is a fixed width, which is what makes a column
            of these scannable: the tags line up under each other, the ages line
            up, and the one button per row lines up under the button above it.
            Sized to the widest label each slot can hold, so no row's action
            pushes the row above it out of alignment. */}
        <span className="flex flex-none items-center gap-2.5">
          <span className="flex w-[124px] flex-none">
            <Tag tone={tag.tone}>{tag.label}</Tag>
          </span>
          <span className={rowAgeClass}>{formatAge(job.updatedAt)}</span>
          {/* Above the overlay, so a click on the action acts rather than
              navigating. Hidden below 1024px rather than wrapped under the
              title: these are a convenience for a Handler with the width for
              them, and the job page offers all of them and more.

              `relative` and deliberately no `z-index`: it only has to paint
              over the overlay link, which it does by being positioned and
              later in the DOM. Giving it a layer of its own would make it a
              stacking context, and the `···` menu inside it could then be
              painted over by the next row's own layer — which is exactly what
              a dropdown must never be. */}
          {actions === undefined ? null : (
            <span className="relative hidden w-[176px] items-center justify-end gap-2 lg:flex">
              {actions}
            </span>
          )}
        </span>
      </div>

      {note === undefined ? null : (
        <p className="px-[18px] pb-1 text-[12.5px] leading-[1.5] text-ink-4">
          {note}
        </p>
      )}
    </li>
  )
}
