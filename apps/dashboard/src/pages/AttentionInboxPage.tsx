import type { AttentionItem, AttentionItemKind, Job } from '@handella/contracts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'

import { attentionKeys, resolveAttentionItem } from '../api/attention.ts'
import { openJobTerminal, resumeJob, useJobRefresh } from '../api/jobs.ts'
import { fetchSystemStatus, statusKeys } from '../api/status.ts'
import { Fact } from '../components/Fact.tsx'
import { FilterPills } from '../components/FilterPills.tsx'
import { JobActionButton } from '../components/JobControls.tsx'
import { JobBeat } from '../components/JobBeat.tsx'
import { SkeletonList } from '../components/Skeleton.tsx'
import { Slots } from '../components/Slots.tsx'
import { Dot, Tag, type Tone } from '../components/Tag.tsx'
import { useAttentionItems } from '../hooks/useAttentionItems.ts'
import type { JobActionTarget } from '../hooks/useJobControls.ts'
import { useJobs } from '../hooks/useJobs.ts'
import {
  availableSlots,
  isQueued,
  isRunning,
  maxConcurrency,
} from '../jobViews.ts'
import { capacityConsequence, formatAge, issueKeyLabel } from '../labels.ts'
import {
  cardClass,
  cardTitleClass,
  emptyPanelClass,
  countTagClass,
  helperClass,
  metaClass,
  pageTitleClass,
  primaryButtonClass,
  quietButtonClass,
  railGridClass,
  screenClass,
  secondaryButtonClass,
} from '../styles.ts'

/**
 * How loud an Attention Item is allowed to be, which the handoff draws as the
 * colour of a 4px rail down the left edge of its card.
 *
 * The handoff names two severities; Handella raises a third kind of thing.
 * `orphanWorktree` and `overlapWarning` are neither a Job that has stopped nor
 * a decision waiting on a signature — one is residue on disk that Handella
 * will never delete, the other is two Jobs that are both fine — so they get
 * amber, which in this palette means look rather than act.
 */
type Severity = 'blocker' | 'housekeeping' | 'review'

const severities: Record<AttentionItemKind, Severity> = {
  planApproval: 'review',
  blocker: 'blocker',
  disputedReview: 'review',
  conflictProposal: 'blocker',
  readyPr: 'review',
  failure: 'blocker',
  orphanWorktree: 'housekeeping',
  overlapWarning: 'housekeeping',
}

/** The rail, the card's border tint, and the tone its status tag wears. */
const severityStyles: Record<
  Severity,
  { border: string; rail: string; tone: Tone }
> = {
  blocker: { border: 'border-red/[0.26]', rail: 'bg-red', tone: 'red' },
  housekeeping: {
    border: 'border-amber/[0.24]',
    rail: 'bg-amber',
    tone: 'amber',
  },
  review: { border: 'border-mint/[0.22]', rail: 'bg-mint', tone: 'mint' },
}

/**
 * What each kind says in its status tag. Short rather than written to sit
 * in a sentence: a tag is eight mono characters in a
 * 5px rectangle, and "Ready pull request" does not fit in one.
 */
const kindTags: Record<AttentionItemKind, string> = {
  planApproval: 'plan review',
  blocker: 'blocked',
  disputedReview: 'review disputed',
  conflictProposal: 'conflict',
  readyPr: 'pr ready',
  failure: 'failed',
  orphanWorktree: 'orphans',
  overlapWarning: 'overlap',
}

/**
 * The guardrail that holds while the Handler has not answered — the promise
 * Handella is keeping in the meantime. Each one states something this system
 * actually enforces rather than reassuring in general.
 *
 * Used as the card's explanation when the service did not write one, which is
 * where the handoff puts "one sentence of plain-language explanation".
 */
const kindConsequences: Record<AttentionItemKind, string> = {
  planApproval:
    'Nothing is written to the branch until you approve the plan, and approving resumes the same Codex session.',
  blocker: 'Nothing on this job moves until you answer it.',
  disputedReview: 'No reply is sent to the pull request until you send it.',
  conflictProposal: 'The original branch is not changed without your approval.',
  readyPr: 'Handella never merges. Reviewing and merging stay with you.',
  failure: 'The branch, worktree, session and logs are all kept.',
  orphanWorktree:
    'Handella reports these directories and never deletes them. Removing one is yours to do.',
  overlapWarning:
    'Both jobs still run: nothing is serialised and neither is delayed.',
}

/**
 * The filters the handoff draws, spelled as the kinds behind them.
 *
 * Three in the drawing — All, Blockers, Reviews — and a fourth here for the
 * two kinds Reconciliation raises, which are neither: a Handler triaging
 * failures should not have orphaned directories in the same pass.
 *
 * Each carries an `id` that the label is free to change without: the chosen
 * filter outlives a reload, and display copy is not a storage key.
 */
const filters = [
  { id: 'all', label: 'All', severity: null },
  { id: 'blockers', label: 'Blockers', severity: 'blocker' },
  { id: 'reviews', label: 'Reviews', severity: 'review' },
  { id: 'housekeeping', label: 'Housekeeping', severity: 'housekeeping' },
] as const satisfies readonly {
  id: string
  label: string
  severity: Severity | null
}[]

type FilterId = (typeof filters)[number]['id']

const filterStorageKey = 'handella.inbox.filter'

/**
 * Where the Handler left the inbox, kept locally so a reload does not lose
 * their place. Storage can be unavailable or hold a filter this build no
 * longer has, and neither is worth failing a render over.
 */
const storedFilterId = (): FilterId => {
  try {
    const stored = localStorage.getItem(filterStorageKey)
    return filters.find((one) => one.id === stored)?.id ?? 'all'
  } catch {
    return 'all'
  }
}

const rememberFilterId = (id: FilterId): void => {
  try {
    localStorage.setItem(filterStorageKey, id)
  } catch {
    // A Handler browsing with storage blocked keeps the filter for this visit.
  }
}

/** "waiting 3m", except in the first minute, where there is no number yet. */
const waitedFor = (createdAt: string): string => {
  const age = formatAge(createdAt)
  return age === 'now' ? 'just now' : `waiting ${age}`
}

/**
 * One card, with exactly one primary on it.
 *
 * This is the central fix on this screen: every card used to carry a mint
 * "Open the job" and a bordered "Resolve" of near-equal weight, so nothing
 * said which of the two the Handler was being asked to do. Now the primary is
 * the thing that unsticks the job — and where that is a state change rather
 * than a destination, it performs it here rather than sending the Handler to
 * another screen to press the same button.
 */
function AttentionCard({
  item,
  job,
}: {
  item: AttentionItem
  job: Job | undefined
}) {
  const queryClient = useQueryClient()
  const refreshJob = useJobRefresh()

  const resolve = useMutation({
    mutationFn: () => resolveAttentionItem(item.id),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: attentionKeys.all }),
  })
  // `useJobRefresh` covers both halves: resuming changes the job, and the item
  // that reported it stopped is no longer true either.
  const resume = useMutation({
    mutationFn: (jobId: string) => resumeJob(jobId),
    onSettled: refreshJob,
  })

  const severity = severities[item.kind]
  const { border, rail, tone } = severityStyles[severity]
  const jobPath = item.jobId === null ? null : `/jobs/${item.jobId}`
  const prUrl = job?.originalPrUrl ?? null
  const failure = resume.error ?? resolve.error

  /**
   * The one primary. `null` for an item that has nowhere to go and nothing to
   * change — the two Reconciliation raises against no Job at all — where the
   * card is a report and the only control it needs is the quiet one.
   */
  const primary = ((): JobActionTarget | null => {
    if (job !== undefined && job.suspension !== null)
      return {
        act: () => resume.mutate(job.id),
        kind: 'resume',
        label: resume.isPending ? 'Resuming…' : 'Resume job',
      }
    if (item.kind === 'readyPr' && prUrl !== null)
      return { href: prUrl, kind: 'reviewPr', label: 'Review pull request' }
    if (item.kind === 'planApproval' && jobPath !== null)
      return {
        kind: 'reviewPlan',
        label: 'Review the plan',
        to: `${jobPath}?tab=plan`,
      }
    if (jobPath !== null)
      return { kind: 'open', label: 'Open the job', to: jobPath }
    return null
  })()

  // Never offered twice: a primary that already opens the job makes the quiet
  // duplicate of itself noise rather than a second way in.
  const showOpenJob = jobPath !== null && primary !== null && !('to' in primary)

  return (
    <li
      className={`flex overflow-hidden rounded-2xl border bg-raised ${border}`}
    >
      <span aria-hidden="true" className={`w-1 flex-none ${rail}`} />

      <div className="flex min-w-0 flex-1 flex-col gap-3.5 px-5 py-[18px]">
        <div className="flex flex-wrap items-center gap-[11px]">
          <Tag tone={tone}>{kindTags[item.kind]}</Tag>
          <h2 className="text-[16px] font-semibold tracking-[-0.2px] text-pretty">
            {item.title}
          </h2>
          <p className="ml-auto whitespace-nowrap font-mono text-[11.5px] text-ink-5">
            {issueKeyLabel(job)} <span className="text-ink-7">·</span>{' '}
            {waitedFor(item.createdAt)}
          </p>
        </div>

        {/* The service's own sentence where it wrote one, and the guardrail
            this kind keeps underneath it — ranked by size rather than set side
            by side, so there is one sentence to read first and one to read if
            the first one worried you. A card with no body of its own promotes
            the guardrail rather than printing it twice. */}
        <p className="max-w-[720px] text-[13.5px] leading-[1.6] text-pretty text-ink-3">
          {item.body ?? kindConsequences[item.kind]}
        </p>
        {item.body === null ? null : (
          <p className="max-w-[720px] text-[12.5px] leading-[1.55] text-ink-4">
            {kindConsequences[item.kind]}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {primary === null ? null : (
            <JobActionButton
              className={primaryButtonClass}
              pending={resume.isPending}
              target={primary}
            />
          )}

          {showOpenJob && jobPath !== null ? (
            <Link className={quietButtonClass} to={jobPath}>
              Open job
            </Link>
          ) : null}

          {/* Always quiet, on every card. CONTEXT.md has an Attention Item
              resolved rather than deleted, so this is the word rather than the
              handoff's "Dismiss" — and resolving one is reversible in the
              sense the Quiet class is for: whatever raised it raises it again. */}
          <button
            className={quietButtonClass}
            disabled={resolve.isPending}
            onClick={() => resolve.mutate()}
            type="button"
          >
            {resolve.isPending ? 'Resolving…' : 'Resolve'}
          </button>
        </div>

        {failure === null || failure === undefined ? null : (
          <p className="text-[12.5px] text-red-ink" role="alert">
            {failure.message}
          </p>
        )}
      </div>
    </li>
  )
}

/**
 * One in-flight job: the live dot, what it is, and the one secondary that puts
 * the Handler inside it. The whole row opens the job — a row that only opens
 * from its title is a target the width of a sentence — so the link is an
 * overlay rather than a wrapper, which is what lets the button beside it take
 * its own clicks.
 */
function RunningRow({ job }: { job: Job }) {
  const terminal = useMutation({ mutationFn: () => openJobTerminal(job.id) })

  return (
    <li className="relative flex flex-col gap-3 rounded-2xl border border-line bg-raised px-[18px] py-4 hover:bg-raised-hover">
      <Link
        aria-label={`Open ${issueKeyLabel(job)}: ${job.title}`}
        className="absolute inset-0 rounded-[inherit]"
        to={`/jobs/${job.id}`}
      />

      <div className="flex flex-wrap items-center gap-[11px]">
        <Dot tone="mint" />
        <p className="min-w-0 flex-1 truncate text-[14.5px] font-[550]">
          {job.title}
        </p>
        <p className="whitespace-nowrap font-mono text-[11.5px] text-ink-5">
          {issueKeyLabel(job)}
        </p>
        {/* Labelled by what it will actually do: a job that has not planned
            yet has no session to resume, and the window is then only a shell. */}
        <button
          className={`relative z-10 ${quietButtonClass}`}
          disabled={terminal.isPending || job.worktreePath === null}
          onClick={() => terminal.mutate()}
          type="button"
        >
          {terminal.isPending
            ? 'Opening…'
            : job.codexSessionId === null
              ? 'Open terminal'
              : 'Open session'}
        </button>
      </div>

      <JobBeat job={job} />

      {terminal.error === null ? null : (
        <p className="text-[12px] text-red-ink" role="alert">
          {terminal.error.message}
        </p>
      )}
    </li>
  )
}

export function AttentionInboxPage() {
  const [filterId, setFilterId] = useState(storedFilterId)
  const attention = useAttentionItems()
  const jobs = useJobs()
  const status = useQuery({
    queryKey: statusKeys.current,
    queryFn: fetchSystemStatus,
  })

  // Memoised because the filter pills count over it: `?? []` is a fresh array
  // every render, and a fresh array is a changed dependency.
  const items = useMemo(() => attention.data ?? [], [attention.data])
  const severity = filters.find((one) => one.id === filterId)?.severity ?? null
  const shown =
    severity === null
      ? items
      : items.filter((item) => severities[item.kind] === severity)

  const choose = (id: FilterId) => {
    setFilterId(id)
    rememberFilterId(id)
  }

  const options = useMemo(
    () =>
      filters.map((one) => ({
        count:
          one.severity === null
            ? items.length
            : items.filter((item) => severities[item.kind] === one.severity)
                .length,
        id: one.id,
        label: one.label,
      })),
    [items],
  )

  // The rail and the in-flight list are four passes over every job, and the
  // event stream invalidates jobs and attention separately: without this they
  // are redone on every attention change and on every filter click, neither of
  // which moves a job.
  const { byId, freeSlots, queued, running, suspended } = useMemo(() => {
    const allJobs = jobs.data ?? []
    return {
      byId: new Map(allJobs.map((job) => [job.id, job])),
      freeSlots: availableSlots(allJobs),
      queued: allJobs.filter(isQueued).length,
      running: allJobs.filter(isRunning),
      suspended: allJobs.filter((job) => job.suspension !== null).length,
    }
  }, [jobs.data])

  return (
    <div className={`${railGridClass} ${screenClass}`}>
      <section className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className={pageTitleClass}>Needs you</h1>
          <span className={countTagClass}>{items.length}</span>
          <p className="text-[13px] text-ink-4">
            Nothing else moves until these are answered.
          </p>
          <div className="ml-auto">
            <FilterPills
              label="Filter what needs you"
              onChoose={choose}
              options={options}
              value={filterId}
            />
          </div>
        </div>

        {attention.isPending ? (
          <SkeletonList
            className="h-[132px] rounded-2xl"
            count={2}
            label="Loading what needs you"
            wrapperClassName="flex flex-col gap-4"
          />
        ) : items.length === 0 ? (
          <p className={emptyPanelClass}>
            Nothing is waiting on you. Dispatched jobs appear under In flight as
            they start.
          </p>
        ) : shown.length === 0 ? (
          <p className={emptyPanelClass}>
            Nothing under this filter. {items.length} item
            {items.length === 1 ? '' : 's'} waiting elsewhere — switch to All to
            see them.
          </p>
        ) : (
          <ul className="flex flex-col gap-4">
            {shown.map((item) => (
              <AttentionCard
                item={item}
                job={item.jobId === null ? undefined : byId.get(item.jobId)}
                key={item.id}
              />
            ))}
          </ul>
        )}

        <div className="mt-1.5 flex flex-wrap items-center gap-3">
          <h2 className="text-[15px] font-semibold">In flight</h2>
          <p className={metaClass}>
            {running.length} running <span className="text-ink-7">·</span>{' '}
            {queued} queued
          </p>
          <Link className={`ml-auto ${quietButtonClass}`} to="/jobs">
            All jobs →
          </Link>
        </div>

        {running.length === 0 ? (
          <p className={emptyPanelClass}>
            Nothing is running. {freeSlots === maxConcurrency ? 'Every' : 'A'}{' '}
            slot is free, so the next job you dispatch starts planning straight
            away.
          </p>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {running.map((job) => (
              <RunningRow job={job} key={job.id} />
            ))}
          </ul>
        )}
      </section>

      <aside className="flex flex-col gap-4">
        <section className={`${cardClass} flex flex-col gap-3.5`}>
          <div className="flex items-center justify-between">
            <h2 className={cardTitleClass}>Capacity</h2>
            <p className={metaClass}>
              {running.length} / {maxConcurrency}
            </p>
          </div>
          <Slots used={running.length} variant="card" />
          {/* The consequence rather than the count, which the numbers above
              have already given: what a free slot means is whether the next
              dispatch starts or waits. */}
          <p className={helperClass}>{capacityConsequence(freeSlots)}</p>
          <Link className={`w-full ${secondaryButtonClass}`} to="/intake">
            Pick issues to dispatch
          </Link>
        </section>

        <section className={`${cardClass} flex flex-col gap-3`}>
          <h2 className={cardTitleClass}>Right now</h2>
          {/* Counts this screen can actually answer from `/api/jobs`. The
              handoff asks for "Dispatched today" and "Pull requests opened
              today", and neither is derivable: a Job carries no dispatch
              timestamp, and how many opened today is in the transition history,
              which is one request per job. */}
          <dl aria-label="Right now" className="flex flex-col gap-3">
            <Fact label="Running" mono value={String(running.length)} />
            <Fact label="Queued" mono value={String(queued)} />
            <Fact
              label="Suspended"
              mono
              tone={suspended === 0 ? 'text-ink-2' : 'text-amber-ink'}
              value={String(suspended)}
            />
            <span aria-hidden="true" className="h-px bg-line" />
            <Fact
              label="Service"
              mono
              tone={status.isError ? 'text-red-ink' : 'text-mint-soft'}
              value={
                status.isError
                  ? 'unreachable'
                  : status.data === undefined
                    ? 'checking…'
                    : 'connected · 127.0.0.1'
              }
            />
          </dl>
        </section>
      </aside>
    </div>
  )
}
