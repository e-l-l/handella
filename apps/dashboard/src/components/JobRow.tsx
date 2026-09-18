import type { Job } from '@handella/contracts'
import type { ReactNode } from 'react'
import { Link } from 'react-router'

import { JobStateBadge } from './JobStateBadge.tsx'

/** The primary list row of the app: the same shape wherever a job is listed. */
export function JobRow({ job, meta }: { job: Job; meta?: ReactNode }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-4">
      <div className="flex flex-col gap-1">
        <Link className="text-sm font-medium underline" to={`/jobs/${job.id}`}>
          {job.title}
        </Link>
        {meta}
      </div>
      <JobStateBadge job={job} />
    </li>
  )
}
