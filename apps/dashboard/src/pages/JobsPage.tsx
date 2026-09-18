import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'

import { primaryButtonClass } from '../styles.ts'

import { fetchJobs, jobKeys } from '../api/jobs.ts'
import { JobRow } from '../components/JobRow.tsx'

export function JobsPage() {
  const jobs = useQuery({ queryKey: jobKeys.all, queryFn: fetchJobs })

  return (
    <section className="mx-auto flex max-w-4xl flex-col gap-6 px-5 py-10 sm:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Jobs</h1>
        {/* Jobs are born at intake now: only Linear can name a canonical
            branch, and a job without one can never be queued. */}
        <Link className={primaryButtonClass} to="/intake">
          New job
        </Link>
      </div>

      {jobs.isPending ? (
        <p aria-label="Loading jobs" className="text-sm text-muted">
          Loading…
        </p>
      ) : jobs.data === undefined || jobs.data.length === 0 ? (
        <p className="text-sm text-muted">No jobs yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {jobs.data.map((job) => (
            <JobRow
              job={job}
              key={job.id}
              meta={
                <p className="text-xs text-muted">
                  {job.workClass} · base {job.baseBranch}
                  {job.linearIssueKey === null
                    ? ''
                    : ` · ${job.linearIssueKey}`}
                </p>
              }
            />
          ))}
        </ul>
      )}
    </section>
  )
}
