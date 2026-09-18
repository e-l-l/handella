import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'

import {
  fetchJob,
  fetchJobTransitions,
  fetchPlanVersions,
  jobKeys,
} from '../api/jobs.ts'
import { JobActions } from '../components/JobActions.tsx'
import { JobStateBadge } from '../components/JobStateBadge.tsx'
import { TransitionTimeline } from '../components/TransitionTimeline.tsx'

function Panel({
  children,
  title,
}: {
  children: React.ReactNode
  title: string
}) {
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5">
      <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
      {children}
    </section>
  )
}

export function JobDetailPage() {
  const { jobId = '' } = useParams()
  const job = useQuery({
    queryKey: jobKeys.detail(jobId),
    queryFn: () => fetchJob(jobId),
  })
  const transitions = useQuery({
    queryKey: jobKeys.transitions(jobId),
    queryFn: () => fetchJobTransitions(jobId),
    enabled: job.isSuccess,
  })
  const planVersions = useQuery({
    queryKey: jobKeys.planVersions(jobId),
    queryFn: () => fetchPlanVersions(jobId),
    enabled: job.isSuccess,
  })

  if (job.isPending) {
    return (
      <section className="mx-auto max-w-4xl px-5 py-10 sm:px-8">
        <p aria-label="Loading the job" className="text-sm text-muted">
          Loading…
        </p>
      </section>
    )
  }

  if (job.data === undefined) {
    return (
      <section className="mx-auto max-w-4xl px-5 py-10 sm:px-8">
        <p className="text-sm text-danger" role="alert">
          {job.error?.message ?? 'That job could not be loaded.'}
        </p>
        <Link
          className="mt-4 inline-flex text-sm text-brand underline"
          to="/jobs"
        >
          Back to jobs
        </Link>
      </section>
    )
  }

  return (
    <section className="mx-auto flex max-w-4xl flex-col gap-6 px-5 py-10 sm:px-8">
      <div className="flex flex-col gap-3">
        <Link className="text-sm text-brand underline" to="/jobs">
          Back to jobs
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">
          {job.data.title}
        </h1>
        <JobStateBadge job={job.data} />
        <p className="text-sm text-muted">
          {job.data.workClass} · {job.data.source} · base {job.data.baseBranch}
          {job.data.canonicalBranch === null
            ? ' · no canonical branch yet'
            : ` · ${job.data.canonicalBranch}`}
        </p>
      </div>

      <Panel title="Actions">
        <JobActions job={job.data} />
      </Panel>

      <Panel title="History">
        <TransitionTimeline transitions={transitions.data ?? []} />
      </Panel>

      <Panel title="Plan versions">
        {(planVersions.data ?? []).length === 0 ? (
          <p className="text-sm text-muted">
            No plan has been captured for this job yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {(planVersions.data ?? []).map((version) => (
              <li className="text-sm" key={version.id}>
                Revision {version.revision} · {version.approvalState}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </section>
  )
}
