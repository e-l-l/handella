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
 */
export function JobRow({ job, meta }: { job: Job; meta?: ReactNode }) {
  return (
    <li>
      <Link
        className={`${listRowClass} border border-line bg-raised hover:bg-raised-hover`}
        to={`/jobs/${job.id}`}
      >
        <span className={rowIdentifierClass}>{issueKeyLabel(job)}</span>
        <span className="min-w-0 flex-1">
          <span className={`block truncate ${rowTitleClass}`}>{job.title}</span>
          {meta}
        </span>
        <JobStateBadge job={job} />
        <span className={`flex-none ${rowAgeClass}`}>
          {formatAge(job.updatedAt)}
        </span>
      </Link>
    </li>
  )
}
