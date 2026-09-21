import { Link } from 'react-router'

import { JobActions } from '../components/JobActions.tsx'
import { JobRow } from '../components/JobRow.tsx'
import { QueuePanel } from '../components/QueuePanel.tsx'
import { SkeletonList } from '../components/Skeleton.tsx'
import { useJobs } from '../hooks/useJobs.ts'
import { workClassLabels } from '../labels.ts'
import {
  emptyPanelClass,
  primaryButtonClass,
  screenClass,
  sectionTitleClass,
} from '../styles.ts'

export function JobsPage() {
  const jobs = useJobs()
  const all = jobs.data ?? []

  return (
    <section className={`flex flex-col ${screenClass}`}>
      <div className="mb-4 flex flex-wrap items-center gap-3.5">
        <h1 className={sectionTitleClass}>Jobs</h1>
        <p className="font-mono text-[11.5px] text-ink-5">
          {all.length} job{all.length === 1 ? '' : 's'}
        </p>
        {/* Jobs are born at intake now: only Linear can name a canonical
            branch, and a job without one can never be queued. */}
        <Link className={`ml-auto ${primaryButtonClass}`} to="/intake">
          New job
        </Link>
      </div>

      {/* Only the queued jobs, and only when there are some: the list below is
          every job, and the queue is the part the Handler can reorder. */}
      <QueuePanel jobs={all} />

      {jobs.isPending ? (
        <SkeletonList
          className="h-[74px] rounded-[18px]"
          count={3}
          label="Loading jobs"
          wrapperClassName="flex flex-col gap-[9px]"
        />
      ) : all.length === 0 ? (
        <p className={emptyPanelClass}>No jobs yet.</p>
      ) : (
        <ul className="flex flex-col gap-[9px]">
          {all.map((job) => (
            <JobRow
              // The reason the list has actions at all: dispatching a job, or
              // stopping one, or standing in its worktree used to mean opening
              // it first, and the job page is not where those decisions are
              // made — the list is.
              actions={<JobActions job={job} variant="row" />}
              job={job}
              key={job.id}
              meta={
                <span className="mt-1 block font-mono text-[11px] text-ink-5">
                  {workClassLabels[job.workClass]} · base {job.baseBranch}
                  {job.canonicalBranch === null
                    ? ''
                    : ` · ${job.canonicalBranch}`}
                </span>
              }
            />
          ))}
        </ul>
      )}
    </section>
  )
}
