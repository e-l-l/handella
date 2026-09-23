import { isTerminalJobState, type Job } from '@handella/contracts'
import { useQuery } from '@tanstack/react-query'
import { useId, type ReactNode } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'

import { fetchJob, fetchJobTransitions, jobKeys } from '../api/jobs.ts'
import { fetchRepositories, repositoryKeys } from '../api/repositories.ts'
import { CopyButton } from '../components/CopyButton.tsx'
import { Fact } from '../components/Fact.tsx'
import { CancelJobDialog, JobActionButton } from '../components/JobControls.tsx'
import { JobLogs } from '../components/JobLogs.tsx'
import { JobTimeline } from '../components/JobTimeline.tsx'
import { OverflowMenu } from '../components/OverflowMenu.tsx'
import { Skeleton } from '../components/Skeleton.tsx'
import { Tabs } from '../components/Tabs.tsx'
import { Tag } from '../components/Tag.tsx'
import { useAttempts, useMilestones } from '../hooks/useAttempts.ts'
import {
  useJobControls,
  type JobActionTarget,
  type JobControls,
} from '../hooks/useJobControls.ts'
import { jobTag, needsYouHeading, needsYouReason } from '../jobPresentation.ts'
import {
  elidePath,
  issueKeyLabel,
  sourceLabels,
  workClassLabels,
} from '../labels.ts'
import {
  cardClass,
  cardTitleClass,
  destructiveOutlineButtonClass,
  helperClass,
  narrowRailGridClass,
  primaryButtonClass,
  quietButtonClass,
  screenTitleClass,
  secondaryButtonClass,
} from '../styles.ts'

/**
 * What Handella changes about the Handler's own Codex configuration for the
 * passes it runs unattended, and nothing else: the sandbox is theirs, because
 * the session Handella opens is the one they go on to drive from a terminal
 * (ADR 0016). Network is on so a fresh worktree can install and push (ADR 0010).
 */
const sessionOverrides =
  'approvals off · network on · otherwise your Codex config'

/**
 * Why a Job has no worktree, which is three different facts rather than one.
 *
 * A Job at intake has not been dispatched yet. A merged one had its worktree
 * removed once Handella confirmed the merge, which is the ordinary end of a
 * Job's life and not an absence at all. Anything else claimed a branch and
 * then lost the cut — the fetch failed, or a restart landed in the middle of
 * it — and that one is worth reading as the fault it is.
 */
const worktreeAbsence = (state: Job['state']): string => {
  if (state === 'intake') return 'created at dispatch'
  if (state === 'merged' || state === 'archived') return 'removed after merge'
  return 'not cut'
}

/** What the session holds, and what opening or approving it does. */
const sessionConsequence = (job: Job): string => {
  if (job.codexSessionId === null)
    return 'No session has been started. Dispatching starts one in the worktree, and the plan is proposed there.'
  if (job.state === 'implementing')
    return 'Opening the session resumes it. It is being written to right now, and anything you send becomes a turn in the same conversation.'
  return 'The plan is proposed in this session. Open the session to read it; approving freezes the runbook and continues the same session into implementation, which you can finish there.'
}

/** A rail card: a title, an optional tag beside it, and what it is about. */
function Card({
  children,
  tag,
  title,
}: {
  children: ReactNode
  tag?: ReactNode
  title: string
}) {
  return (
    <section className={`${cardClass} flex flex-col gap-3`}>
      <div className="flex flex-wrap items-center gap-2.5">
        <h2 className={cardTitleClass}>{title}</h2>
        {tag}
      </div>
      {children}
    </section>
  )
}

/**
 * The most important change on this screen.
 *
 * What it replaces was a card headed "Actions" holding five identical "Move
 * to…" buttons, which told the Handler everything that was legal and nothing
 * about what was wanted. This says what is wrong in a sentence, says what it
 * costs, and offers the one thing that fixes it — with at most one filled
 * control beside it. Every state transition moved into the `···` in the header.
 *
 * Amber, for all four cases it covers. The palette's rule is that mint acts
 * and amber waits, and a suspended job, a plan needing an answer and an open
 * pull request are all the same kind of fact: Handella has stopped and is
 * waiting on the Handler. The button inside is mint, because the button acts.
 */
function StateBanner({
  action,
  approve,
  job,
  pending,
  secondary,
}: {
  action: JobActionTarget
  approve: JobControls['approve']
  job: Job
  pending: boolean
  secondary: JobActionTarget | null
}) {
  const heading = needsYouHeading(job)
  const reason = needsYouReason(job)

  // A job that is over says so where the banner would be, and offers nothing:
  // there is no next action, and an empty space where the recovery action sits
  // on every other job would leave the Handler looking for one.
  if (heading === null || reason === null) {
    if (!isTerminalJobState(job.state)) return null
    return (
      <section className="flex overflow-hidden rounded-2xl border border-line bg-raised-muted">
        <span aria-hidden="true" className="w-1 flex-none bg-line-strong" />
        <p className="flex-1 px-5 py-4 text-[13px] leading-[1.55] text-ink-4">
          This job has reached the end of its life. Its timeline and logs are
          kept; nothing else about it can change.
        </p>
      </section>
    )
  }

  return (
    <section className="flex overflow-hidden rounded-2xl border border-amber/[0.28] bg-amber/[0.04]">
      <span aria-hidden="true" className="w-1 flex-none bg-amber" />
      <div className="flex flex-1 flex-wrap items-center gap-5 px-5 py-[18px]">
        <div className="flex min-w-0 flex-col gap-1.5">
          <h2 className="text-[15.5px] font-semibold text-amber-heading">
            {heading}
          </h2>
          <p className="max-w-[560px] text-[13px] leading-[1.55] text-amber-body">
            {reason}
          </p>
        </div>
        <div className="ml-auto flex flex-none flex-wrap items-center gap-2">
          {/* The plan is in the Codex session, not on this page, so a job
              waiting on it offers the approval here and the session beside it:
              read there, approve here. */}
          {approve.offered ? (
            <button
              className={primaryButtonClass}
              disabled={pending}
              onClick={approve.act}
              type="button"
            >
              {approve.pending ? 'Approving…' : 'Approve plan'}
            </button>
          ) : (
            <JobActionButton
              className={primaryButtonClass}
              pending={pending}
              replace
              target={action}
            />
          )}
          {secondary === null ? null : (
            <JobActionButton
              className={secondaryButtonClass}
              pending={pending}
              replace
              target={secondary}
            />
          )}
        </div>
      </div>
    </section>
  )
}

const tabs = [
  { id: 'timeline', label: 'Timeline' },
  { id: 'logs', label: 'Logs' },
] as const

type TabId = (typeof tabs)[number]['id']

const isTabId = (value: string | null): value is TabId =>
  tabs.some((tab) => tab.id === value)

export function JobDetailPage() {
  const { jobId = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const panelId = useId()

  // The tab lives in the URL so a Handler can send someone the logs rather
  // than the page.
  const fromUrl = params.get('tab')
  const tab: TabId = isTabId(fromUrl) ? fromUrl : 'timeline'
  const chooseTab = (next: TabId) => {
    setParams(
      (current) => {
        const copy = new URLSearchParams(current)
        if (next === 'timeline') copy.delete('tab')
        else copy.set('tab', next)
        return copy
      },
      { replace: true },
    )
  }

  const job = useQuery({
    queryKey: jobKeys.detail(jobId),
    queryFn: () => fetchJob(jobId),
  })
  const transitions = useQuery({
    queryKey: jobKeys.transitions(jobId),
    queryFn: () => fetchJobTransitions(jobId),
    enabled: job.isSuccess,
  })
  const attempts = useAttempts(jobId, job.isSuccess)
  // Only the timeline draws milestones, and they are invalidated about once a
  // second while a turn runs, so they are not kept fresh behind another tab.
  // What was cached still shows the moment the timeline comes back.
  const milestones = useMilestones(jobId, job.isSuccess && tab === 'timeline')
  // Named rather than identified: the id is the link, but the name is what the
  // Handler called the checkout.
  const repositories = useQuery({
    queryKey: repositoryKeys.all,
    queryFn: fetchRepositories,
  })

  if (job.isPending) {
    return (
      <section
        aria-label="Loading the job"
        className="flex flex-col gap-[18px] px-6 pb-8 pt-[26px]"
        role="status"
      >
        <Skeleton className="h-24 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </section>
    )
  }

  if (job.data === undefined) {
    return (
      <section className="px-6 pb-8 pt-[26px]">
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

  return (
    <JobDetail
      attempts={attempts.data ?? []}
      job={job.data}
      milestones={milestones.data ?? []}
      onChooseTab={chooseTab}
      panelId={panelId}
      repositoryName={
        repositories.data?.find(
          (repository) => repository.id === job.data.repositoryId,
        )?.name
      }
      tab={tab}
      transitions={transitions.data ?? []}
    />
  )
}

/**
 * The loaded screen, split out so the controls hook is only mounted against a
 * Job that exists: a hook cannot be called after an early return, and the page
 * above has three of them.
 */
function JobDetail({
  attempts,
  job,
  milestones,
  onChooseTab,
  panelId,
  repositoryName,
  tab,
  transitions,
}: {
  attempts: Parameters<typeof JobTimeline>[0]['attempts']
  job: Job
  milestones: Parameters<typeof JobTimeline>[0]['milestones']
  onChooseTab: (tab: TabId) => void
  panelId: string
  repositoryName: string | undefined
  tab: TabId
  transitions: Parameters<typeof JobTimeline>[0]['transitions']
}) {
  // One call for the whole screen: the banner, the header's `···` and the
  // danger zone are three views of the same set of moves, and three calls
  // would be three cancel flags and three copies of every mutation.
  const { action, approve, cancel, failure, overflow, pending, secondary } =
    useJobControls(job)
  const tag = jobTag(job)

  return (
    <article>
      <nav
        aria-label="Breadcrumb"
        className="flex items-center gap-2 px-6 pt-5 text-[12.5px] text-ink-5"
      >
        <Link className="text-ink-3 hover:text-ink" to="/jobs">
          Jobs
        </Link>
        <span aria-hidden="true">/</span>
        <span className="font-mono">{issueKeyLabel(job)}</span>
      </nav>

      <header className="flex flex-wrap items-start gap-5 border-b border-line-nav px-6 pb-[22px] pt-3">
        <div className="flex min-w-0 flex-col gap-[11px]">
          <h1 className={`max-w-[820px] ${screenTitleClass}`}>{job.title}</h1>
          <div className="flex flex-wrap items-center gap-2.5">
            {/* One tag for where the job is, one for what kind of work it is,
                and no third: the old header drew the state, the suspension and
                the branch as three chips of equal weight. */}
            <Tag tone={tag.tone}>{tag.label}</Tag>
            <Tag>{workClassLabels[job.workClass]}</Tag>
            <p className="font-mono text-[12px] text-ink-5">
              base {job.baseBranch}
              {job.worktreePath === null
                ? ` · ${worktreeAbsence(job.state)}`
                : ` · worktree ${elidePath(job.worktreePath)}`}
            </p>
            {/* Elided above, so there has to be a way to get the whole path
                back. It used to be printed in full, a hundred and forty mono
                characters that pushed everything else off the line. */}
            {job.worktreePath === null ? null : (
              <CopyButton label="Copy path" value={job.worktreePath} />
            )}
          </div>
        </div>

        <div className="ml-auto flex flex-none flex-wrap items-center gap-2">
          {job.linearIssueUrl === null ? null : (
            <a
              className={quietButtonClass}
              href={job.linearIssueUrl}
              rel="noreferrer"
              target="_blank"
            >
              Open in Linear
            </a>
          )}
          <OverflowMenu items={overflow} label="More actions for this job" />
        </div>
      </header>

      <div className={`${narrowRailGridClass} px-6 pb-8 pt-6`}>
        <div className="flex min-w-0 flex-col gap-[18px]">
          <StateBanner
            action={action}
            approve={approve}
            job={job}
            pending={pending}
            secondary={secondary}
          />

          {failure === null ? null : (
            <p className="text-[13px] text-red-ink" role="alert">
              {failure.message}
            </p>
          )}

          <Tabs
            label="Job views"
            onChoose={onChooseTab}
            options={tabs}
            panelId={panelId}
            value={tab}
          >
            {tab === 'timeline' ? (
              <JobTimeline
                attempts={attempts}
                job={job}
                milestones={milestones}
                transitions={transitions}
              />
            ) : (
              <JobLogs attempts={attempts} jobId={job.id} />
            )}
          </Tabs>
        </div>

        <aside className="flex flex-col gap-3.5">
          <Card title="Job">
            <dl className="flex flex-col gap-3">
              <Fact label="Source" value={sourceLabels[job.source]} />
              <Fact label="Work class" value={workClassLabels[job.workClass]} />
              <Fact label="Base" mono value={job.baseBranch} />
              <Fact label="Repository" value={repositoryName ?? 'not chosen'} />
              <Fact
                label="Queue"
                value={
                  job.state !== 'queued'
                    ? 'not queued'
                    : job.queuePriority === null
                      ? // In the queue but never reordered, so it waits behind
                        // everything the Handler has put in an order.
                        'waiting, unordered'
                      : `position ${job.queuePriority}`
                }
              />
            </dl>
            {/* On its own line and allowed to wrap: Linear's branch names run
                to eighty characters, and a key/value row would either truncate
                the part that identifies it or push the label off the card. */}
            <div className="flex flex-col gap-1.5 border-t border-line pt-3 text-[13px]">
              <span className="text-ink-4">Branch</span>
              <span className="break-all font-mono text-[11.5px] leading-[1.5] text-mint-soft">
                {job.canonicalBranch ?? 'not claimed until dispatch'}
              </span>
            </div>
          </Card>

          <Card
            tag={
              <Tag
                small
                tone={job.codexSessionId === null ? 'neutral' : 'mint'}
              >
                {job.codexSessionId === null ? 'not started' : 'started'}
              </Tag>
            }
            title="Codex session"
          >
            <dl className="flex flex-col gap-3">
              {/* Stated rather than configurable: no control in this dashboard
                  may change what a pass runs under. The sandbox itself is not
                  named because it is not Handella's — it is whatever the
                  Handler's own Codex config says. */}
              <Fact label="Overrides" value={sessionOverrides} />
            </dl>
            <p className={helperClass}>{sessionConsequence(job)}</p>
          </Card>

          {/* Its own card, with its own border, holding one control and the
              sentence that says what that control costs. Cancelling used to sit
              in a row of five identical buttons, one mis-click from a state a
              job never comes back from. */}
          {cancel.offered ? (
            <section
              className={`flex flex-col gap-3 rounded-[18px] border border-red/[0.18] bg-raised p-[18px]`}
            >
              <h2 className={cardTitleClass}>Danger zone</h2>
              <p className={helperClass}>
                Cancelling removes the worktree. The branch and the Linear issue
                are left alone.
              </p>
              <button
                className={`self-start ${destructiveOutlineButtonClass}`}
                disabled={cancel.pending}
                onClick={cancel.request}
                type="button"
              >
                Cancel job
              </button>
            </section>
          ) : null}
        </aside>
      </div>

      <CancelJobDialog cancel={cancel} job={job} />
    </article>
  )
}
