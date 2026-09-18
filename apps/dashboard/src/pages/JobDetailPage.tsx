import type { Job } from '@handella/contracts'
import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { Link, useParams } from 'react-router'

import {
  fetchJob,
  fetchJobTransitions,
  fetchPlanVersions,
  jobKeys,
} from '../api/jobs.ts'
import { Chip } from '../components/Chip.tsx'
import { Fact } from '../components/Fact.tsx'
import { JobActions } from '../components/JobActions.tsx'
import { JobStateBadge } from '../components/JobStateBadge.tsx'
import { Skeleton } from '../components/Skeleton.tsx'
import { TransitionTimeline } from '../components/TransitionTimeline.tsx'
import { WorkClassChip } from '../components/WorkClassChip.tsx'
import {
  formatTimestamp,
  issueKeyLabel,
  planApprovalStateLabels,
  sourceLabels,
  workClassLabels,
} from '../labels.ts'
import {
  cardClass,
  cardTitleClass,
  greyButtonClass,
  narrowRailGridClass,
  screenClass,
  screenTitleClass,
  secondaryButtonClass,
} from '../styles.ts'

/** Every card on this screen, in both columns: a title, and what it is about. */
function Card({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className={`${cardClass} flex flex-col gap-3.5`}>
      <h2 className={cardTitleClass}>{title}</h2>
      {children}
    </section>
  )
}

function JobHeader({ job }: { job: Job }) {
  return (
    <div className="flex flex-wrap items-start gap-5 border-b border-line px-7 pb-[22px] pt-[26px]">
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-mono text-[12.5px] text-ink-5">
            {issueKeyLabel(job)}
          </span>
          <h1 className={screenTitleClass}>{job.title}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <WorkClassChip workClass={job.workClass} />
          <JobStateBadge job={job} />
          {job.canonicalBranch === null ? null : (
            <Chip mono tone="outline">
              {job.canonicalBranch}
            </Chip>
          )}
          <span className="font-mono text-[11.5px] text-ink-5">
            base {job.baseBranch} ·{' '}
            {job.worktreePath ?? 'no worktree until dispatch'}
          </span>
        </div>
      </div>

      <div className="ml-auto flex flex-wrap items-center gap-[9px]">
        {job.linearIssueUrl === null ? null : (
          <a
            className={secondaryButtonClass}
            href={job.linearIssueUrl}
            rel="noreferrer"
            target="_blank"
          >
            Open in Linear
          </a>
        )}
        {job.originalPrUrl === null ? null : (
          // The only PR action there will ever be: merging stays the Handler's.
          <a
            className={greyButtonClass}
            href={job.originalPrUrl}
            rel="noreferrer"
            target="_blank"
          >
            Open PR
          </a>
        )}
      </div>
    </div>
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
      <section
        aria-label="Loading the job"
        className={`flex flex-col gap-[18px] ${screenClass}`}
        role="status"
      >
        <Skeleton className="h-24 rounded-[22px]" />
        <Skeleton className="h-64 rounded-[22px]" />
      </section>
    )
  }

  if (job.data === undefined) {
    return (
      <section className={screenClass}>
        <p className="text-[13px] text-red-ink" role="alert">
          {job.error?.message ?? 'That job could not be loaded.'}
        </p>
        <Link
          className="mt-4 inline-flex text-[13px] text-mint-soft underline"
          to="/jobs"
        >
          Back to jobs
        </Link>
      </section>
    )
  }

  const plans = planVersions.data ?? []
  const history = transitions.data ?? []

  return (
    <article>
      <JobHeader job={job.data} />

      <div className={`${narrowRailGridClass} px-7 pb-8 pt-[26px]`}>
        <div className="flex flex-col gap-[18px]">
          <Card title="Actions">
            <JobActions job={job.data} />
          </Card>

          <section className={`${cardClass} flex flex-col gap-4`}>
            <div className="flex flex-wrap items-center gap-3.5">
              <h2 className="text-[16px] font-semibold">History</h2>
              <p className="font-mono text-[11.5px] text-ink-5">
                {history.length} transitions · runbook milestones land here in
                Phase 6
              </p>
            </div>
            <TransitionTimeline transitions={history} />
          </section>

          <Card title="Plan versions">
            {plans.length === 0 ? (
              <p className="text-[13px] text-ink-3">
                No plan has been captured for this job yet.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {plans.map((version) => (
                  <li
                    className="flex items-center justify-between rounded-2xl bg-surface px-4 py-3 text-[13px]"
                    key={version.id}
                  >
                    <span className="font-mono text-[12px] text-mint-soft">
                      v{version.revision}
                    </span>
                    <span className="text-ink-3">
                      {planApprovalStateLabels[version.approvalState]}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <aside className="flex flex-col gap-4">
          <Card title="Job">
            <dl className="flex flex-col gap-2.5">
              <Fact label="Source" value={sourceLabels[job.data.source]} />
              <Fact
                label="Work class"
                value={workClassLabels[job.data.workClass]}
              />
              <Fact label="Base" value={job.data.baseBranch} />
              <Fact
                label="Canonical branch"
                value={job.data.canonicalBranch ?? 'not claimed yet'}
              />
              <Fact
                label="Queue"
                value={
                  job.data.queuePriority === null
                    ? 'not queued'
                    : `position ${job.data.queuePriority}`
                }
              />
              <Fact
                label="Created"
                value={formatTimestamp(job.data.createdAt)}
              />
            </dl>
          </Card>

          <Card title="Codex session">
            <dl className="flex flex-col gap-2.5">
              <Fact
                label="Session"
                value={job.data.codexSessionId ?? 'not started'}
              />
              {/* Stated rather than configurable: the sandbox is a guardrail,
                  and no control in this dashboard may bypass it. */}
              <Fact label="Sandbox" value="workspace-write" />
              <Fact
                label="Worktree"
                value={job.data.worktreePath ?? 'created at dispatch'}
              />
            </dl>
          </Card>

          <Card title="Source">
            {job.data.linearIssueKey === null ? (
              <p className="text-[13px] leading-[1.6] text-ink-3">
                Written by you, with its Linear issue created at intake.
              </p>
            ) : (
              <p className="text-[13px] leading-[1.6] text-ink-3">
                Linked to{' '}
                <span className="text-mint-soft">
                  {job.data.linearIssueKey}
                </span>
                , which owns the canonical branch name.
              </p>
            )}
            <Link className={`${secondaryButtonClass} text-center`} to="/jobs">
              Back to jobs
            </Link>
          </Card>
        </aside>
      </div>
    </article>
  )
}
