import type { Job } from '@handella/contracts'
import type { ReactNode } from 'react'
import { Link } from 'react-router'

import { formatAge, issueKeyLabel } from '../labels.ts'
import {
  listRowClass,
  rowAgeClass,
  rowIdentifierClass,
  rowTitleClass,
} from '../styles.ts'
import { JobStateBadge } from './JobStateBadge.tsx'

/**
 * The primary list row of the app: the same shape wherever a job is listed.
 * The whole row is the link, because a row that only opens from its title is a
 * target the width of a sentence.
 *
 * It is the link by covering itself with one rather than by being one, which
 * is what lets `actions` hold buttons: an anchor may not contain a button, and
 * a click on a control nested inside one navigates as well as acting. The
 * overlay is a positioned element and so paints over the static text beside
 * it; the actions sit above the overlay in turn and take their own clicks.
 */
export function JobRow({
  actions,
  job,
  meta,
}: {
  /** Offered beside the row from 1024px up, where there is width to spare. */
  actions?: ReactNode
  job: Job
  meta?: ReactNode
}) {
  return (
    <li
      className={`relative ${listRowClass} border border-line bg-raised hover:bg-raised-hover`}
    >
      <Link
        // Named rather than labelled by its contents: the overlay holds no
        // text, and repeating the whole row inside it would put the same words
        // on the screen twice for anything reading the row rather than looking
        // at it. The identifier is named as well as the title, because a list
        // of these read on their own is how a Handler finds one issue again.
        aria-label={`Open ${issueKeyLabel(job)}: ${job.title}`}
        className="absolute inset-0 rounded-[inherit]"
        to={`/jobs/${job.id}`}
      />

      <span className={rowIdentifierClass}>{issueKeyLabel(job)}</span>
      <span className="min-w-0 flex-1">
        <span className={`block truncate ${rowTitleClass}`}>{job.title}</span>
        {meta}
      </span>
      <JobStateBadge job={job} />
      <span className={`flex-none ${rowAgeClass}`}>
        {formatAge(job.updatedAt)}
      </span>

      {/* Hidden rather than wrapped below the title on a narrow screen: these
          are a convenience for a Handler with the width for them, and the job
          page offers all of them and more. */}
      {actions === undefined ? null : (
        <span className="relative z-10 hidden lg:block">{actions}</span>
      )}
    </li>
  )
}
