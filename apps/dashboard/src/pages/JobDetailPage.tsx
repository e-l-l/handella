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
import { fetchRepositories, repositoryKeys } from '../api/repositories.ts'
import { Chip } from '../components/Chip.tsx'
import { Fact } from '../components/Fact.tsx'
import { JobActions } from '../components/JobActions.tsx'
import { JobStateBadge } from '../components/JobStateBadge.tsx'
import { useAttempts, useMilestones } from '../hooks/useAttempts.ts'
import { PlanReview } from '../components/PlanReview.tsx'
import { Skeleton } from '../components/Skeleton.tsx'
import { JobTimeline } from '../components/JobTimeline.tsx'
import { WorkClassChip } from '../components/WorkClassChip.tsx'
import {
  formatTimestamp,
  issueKeyLabel,
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

/**
 * Which sandbox Codex is under for this job right now. Planning reads and can
 * write nothing; implementation writes inside the worktree and reaches the
 * network, which is what lets it install dependencies, run the tests and open
 * the pull request (ADR 0010).
 */
const sandboxOf = (job: Job): string => {
  if (job.state === 'planning') return 'read-only'
  if (job.state === 'implementing') return 'workspace-write · network'
  return 'read-only until implementation'
}

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
  const attempts = useAttempts(jobId, job.isSuccess)
  const milestones = useMilestones(jobId, job.isSuccess)
  // Named rather than identified: the id is the link, but the name is what the
  // Handler called the checkout.
  const repositories = useQuery({
    queryKey: repositoryKeys.all,
    queryFn: fetchRepositories,
  })
  const repositoryName = repositories.data?.find(
    (repository) => repository.id === job.data?.repositoryId,
  )?.name

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
  const attemptRows = attempts.data ?? []
  const milestoneRows = milestones.data ?? []

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
                {history.length} transitions
                {attemptRows.length === 0
                  ? ''
                  : ` · ${attemptRows.length} implementation ${attemptRows.length === 1 ? 'turn' : 'turns'}`}
              </p>
            </div>
            <JobTimeline
              attempts={attemptRows}
              jobId={jobId}
              milestones={milestoneRows}
              transitions={history}
            />
          </section>

          <Card title="Plan">
            <PlanReview job={job.data} versions={plans} />
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
              <Fact label="Repository" value={repositoryName ?? 'not chosen'} />
              <Fact
                label="Queue"
                value={
                  job.data.state !== 'queued'
                    ? 'not queued'
                    : job.data.queuePriority === null
                      ? // In the queue but never reordered, so it waits behind
                        // everything the Handler has put in an order.
                        'waiting, unordered'
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
                  and no control in this dashboard may bypass it. Which one is
                  in force depends on what the job is doing — planning reads,
                  and only implementation may write and reach the network. */}
              <Fact label="Sandbox" value={sandboxOf(job.data)} />
              <Fact
                label="Worktree"
                value={
                  job.data.worktreePath ??
                  (job.data.state === 'intake'
                    ? 'created at dispatch'
                    : // Claimed, but the fetch and the cut have not finished or
                      // did not survive a restart. Phase 7 reaps this.
                      'not cut')
                }
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
