import type { AttentionItem, AttentionItemKind, Job } from '@handella/contracts'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router'

import { attentionKeys, resolveAttentionItem } from '../api/attention.ts'
import { Chip, Dot, type Tone } from '../components/Chip.tsx'
import { SkeletonList } from '../components/Skeleton.tsx'
import { WorkClassChip } from '../components/WorkClassChip.tsx'
import { useAttempts, useMilestones } from '../hooks/useAttempts.ts'
import { useAttentionItems } from '../hooks/useAttentionItems.ts'
import { useJobs } from '../hooks/useJobs.ts'
import { isQueued, isRunning, maxConcurrency, orderQueue } from '../jobViews.ts'
import {
  attemptLabel,
  attentionKindLabels,
  formatAge,
  formatDuration,
  issueKeyLabel,
  stateLabels,
  workClassLabels,
} from '../labels.ts'
import {
  cardClass,
  emptyPanelClass,
  greyButtonClass,
  insetClass,
  primaryButtonClass,
  railGridClass,
  screenClass,
  secondaryButtonClass,
  sectionTitleClass,
  slotPanelClass,
  softCardClass,
} from '../styles.ts'

/** What each kind of attention costs the Handler, in the handoff's palette. */
const kindTones: Record<AttentionItemKind, Tone> = {
  planApproval: 'amber',
  blocker: 'red',
  disputedReview: 'amber',
  conflictProposal: 'red',
  readyPr: 'mint',
  failure: 'red',
  // Neither is a Job that has stopped: one is residue on disk and the other
  // is two Jobs that are both fine. Amber says look, not act.
  orphanWorktree: 'amber',
  overlapWarning: 'amber',
}

/**
 * What the Handler goes to the job to do, and the constraint that holds while
 * they have not: the meta note is the promise Handella is keeping in the
 * meantime, so each one states a guardrail this system actually enforces
 * rather than reassuring in general.
 */
const kindActions: Record<AttentionItemKind, { action: string; meta: string }> =
  {
    planApproval: {
      action: 'Review the plan',
      meta: 'the same Codex session resumes on approval',
    },
    blocker: {
      action: 'Open the job',
      meta: 'nothing moves until you answer',
    },
    disputedReview: {
      action: 'Open the job',
      meta: 'no reply is sent until you send it',
    },
    conflictProposal: {
      action: 'Open the job',
      meta: 'the original branch is not changed without your approval',
    },
    readyPr: {
      action: 'Open the job',
      meta: 'merging stays yours',
    },
    failure: {
      action: 'Inspect the job',
      meta: 'branch, worktree, session and logs are kept',
    },
    orphanWorktree: {
      action: 'Look at the paths',
      meta: 'Handella reports these and never deletes them',
    },
    overlapWarning: {
      action: 'Open the job',
      meta: 'both jobs still run; nothing is serialised',
    },
  }

/**
 * The filters the handoff draws, spelled as the kinds behind them: a Handler
 * triaging failures wants conflicts in the same pass, and one that is only
 * waiting on a signature wants approvals alone.
 *
 * Each carries an `id` that the label is free to change without: the chosen
 * filter outlives a reload, and display copy is not a storage key.
 */
const filters = [
  { id: 'all', kinds: null, label: 'All' },
  { id: 'approvals', kinds: ['planApproval'], label: 'Approvals' },
  {
    id: 'failures',
    kinds: ['failure', 'blocker', 'conflictProposal'],
    label: 'Failures',
  },
  {
    id: 'housekeeping',
    kinds: ['orphanWorktree', 'overlapWarning'],
    label: 'Housekeeping',
  },
  {
    id: 'pull-requests',
    kinds: ['disputedReview', 'readyPr'],
    label: 'Pull requests',
  },
] as const satisfies readonly {
  id: string
  kinds: readonly AttentionItemKind[] | null
  label: string
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

function AttentionCard({
  item,
  job,
}: {
  item: AttentionItem
  job: Job | undefined
}) {
  const queryClient = useQueryClient()
  const resolve = useMutation({
    mutationFn: () => resolveAttentionItem(item.id),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: attentionKeys.all }),
  })
  const { action, meta } = kindActions[item.kind]
  const prUrl = job?.originalPrUrl ?? null

  return (
    <li className={`flex flex-col gap-3 ${softCardClass}`}>
      <div className="flex flex-wrap items-center gap-3">
        <Chip
          className="uppercase tracking-[0.05em]"
          mono
          tone={kindTones[item.kind]}
        >
          {attentionKindLabels[item.kind]}
        </Chip>
        <p className="text-[15.5px] font-[550] tracking-[-0.2px]">
          {item.title}
        </p>
        <p className="ml-auto font-mono text-[12px] text-ink-5">
          {issueKeyLabel(job)} <span className="text-ink-7">·</span>{' '}
          {formatAge(item.createdAt)}
        </p>
      </div>

      {item.body === null ? null : (
        <p className="max-w-[700px] text-[13.5px] leading-[1.6] text-pretty text-ink-3">
          {item.body}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-[9px]">
        {item.jobId === null ? null : (
          <Link className={primaryButtonClass} to={`/jobs/${item.jobId}`}>
            {action}
          </Link>
        )}
        {/* The only pull request action there will ever be: merging is the
            Handler's, so the card links to it rather than offering it. */}
        {prUrl === null ? null : (
          <a
            className={greyButtonClass}
            href={prUrl}
            rel="noreferrer"
            target="_blank"
          >
            Open PR
          </a>
        )}
        <button
          className={secondaryButtonClass}
          disabled={resolve.isPending}
          onClick={() => resolve.mutate()}
          type="button"
        >
          Resolve
        </button>
        <p className="ml-auto font-mono text-[12.5px] text-ink-5">{meta}</p>
      </div>
    </li>
  )
}

/**
 * What a running job is doing, read from its own milestones.
 *
 * Only an implementing job has any: planning produces no spine, and a job that
 * has just been given a slot has not written its first line yet.
 */
function LatestBeat({ job }: { job: Job }) {
  const implementing = job.state === 'implementing'
  const attempts = useAttempts(job.id, implementing)
  const milestones = useMilestones(job.id, implementing)

  if (!implementing) return null

  const attempt = attempts.data?.at(-1)
  const latest = milestones.data?.at(-1)
  if (attempt === undefined) return null

  return (
    <>
      <span className="font-mono text-[11px] text-ink-5">
        {attemptLabel(attempt)} ·{' '}
        {formatDuration(attempt.startedAt, attempt.endedAt)}
      </span>
      {/* The line the agent just wrote, which is what actually tells the
          Handler whether to step in. Still no bar: milestones have no total,
          so a bar would be inventing the denominator. */}
      {latest === undefined ? null : (
        <span className="truncate font-mono text-[11.5px] text-ink-3">
          {latest.summary}
          {latest.exitCode === null ? '' : ` · exit ${latest.exitCode}`}
        </span>
      )}
    </>
  )
}

/** One running job: what it is doing now, and for how long it has been doing it. */
function RunningSlot({ job }: { job: Job }) {
  return (
    <li>
      {/* The whole slot opens the job, because a slot that only opens from its
          title is a target the width of a sentence. */}
      <Link
        className={`flex flex-col gap-[9px] hover:bg-surface-hover ${insetClass}`}
        to={`/jobs/${job.id}`}
      >
        <span className="flex items-center gap-2.5">
          <Dot tone="mint" />
          <span className="min-w-0 flex-1 truncate text-[13.5px] font-[550]">
            {job.title}
          </span>
          <span className="flex-none whitespace-nowrap font-mono text-[11.5px] text-ink-5">
            {issueKeyLabel(job)}
          </span>
        </span>
        <span className="text-[12.5px] text-ink-3">
          {stateLabels[job.state]} · base {job.baseBranch}
        </span>
        <LatestBeat job={job} />
        <span className="flex justify-between font-mono text-[11px] text-ink-5">
          <span>{workClassLabels[job.workClass]}</span>
          <span>{formatAge(job.updatedAt)}</span>
        </span>
      </Link>
    </li>
  )
}

function QueueRow({ job, position }: { job: Job; position: number }) {
  return (
    <li>
      <Link
        className="flex items-center gap-3 rounded-[14px] bg-surface px-3.5 py-3 hover:bg-surface-hover"
        to={`/jobs/${job.id}`}
      >
        <span className="w-3.5 flex-none font-mono text-[11.5px] text-ink-5">
          {position}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium">
            {job.title}
          </span>
          <span className="mt-0.5 block font-mono text-[11px] text-ink-5">
            {issueKeyLabel(job)} · {stateLabels[job.state]}
          </span>
        </span>
        <WorkClassChip workClass={job.workClass} />
      </Link>
    </li>
  )
}

/** A rail panel: what it lists, and one line saying how much of it there is. */
function RailPanel({
  children,
  note,
  title,
}: {
  children: ReactNode
  note: string
  title: string
}) {
  return (
    <section className={cardClass}>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        <p className="font-mono text-[11.5px] text-ink-5">{note}</p>
      </div>
      {children}
    </section>
  )
}

export function AttentionInboxPage() {
  const [filterId, setFilterId] = useState(storedFilterId)
  const attention = useAttentionItems()
  const jobs = useJobs()

  const items = attention.data ?? []
  // Widened back from the `as const` tuples, which have no element type in
  // common and would narrow `includes` to `never`.
  const kinds: readonly AttentionItemKind[] | null =
    filters.find((one) => one.id === filterId)?.kinds ?? null
  const shown =
    kinds === null ? items : items.filter((item) => kinds.includes(item.kind))

  const choose = (id: FilterId) => {
    setFilterId(id)
    rememberFilterId(id)
  }

  // The rail is five passes and a sort over every job, and the event stream
  // invalidates jobs and attention separately: without this it is redone on
  // every attention change and on every filter click, neither of which moves a
  // job.
  const { byId, freeSlots, queued, running } = useMemo(() => {
    const allJobs = jobs.data ?? []
    const active = allJobs.filter(isRunning)
    return {
      byId: new Map(allJobs.map((job) => [job.id, job])),
      freeSlots: Math.max(0, maxConcurrency - active.length),
      queued: orderQueue(allJobs.filter(isQueued)),
      running: active,
    }
  }, [jobs.data])

  return (
    <div className={`${railGridClass} ${screenClass}`}>
      <section className="flex flex-col">
        <div className="mb-4 flex flex-wrap items-center gap-3.5">
          <h1 className={sectionTitleClass}>Needs you</h1>
          <span className="rounded-full bg-mint px-2.5 py-[3px] font-mono text-[12px] font-semibold text-deep">
            {items.length}
          </span>
          <div className="ml-auto flex flex-wrap gap-[7px]">
            {filters.map((one) => (
              <button
                className={`rounded-full px-3.5 py-[7px] text-[12.5px] ${
                  one.id === filterId
                    ? 'bg-raised-alt text-ink'
                    : 'border border-line-strong text-ink-4 hover:text-ink-2'
                }`}
                key={one.id}
                onClick={() => choose(one.id)}
                type="button"
              >
                {one.label}
              </button>
            ))}
          </div>
        </div>

        {attention.isPending ? (
          <SkeletonList
            className="h-[118px] rounded-[20px]"
            count={3}
            label="Loading the attention inbox"
            wrapperClassName="flex flex-col gap-3"
          />
        ) : items.length === 0 ? (
          <p className={emptyPanelClass}>Nothing is waiting on you.</p>
        ) : shown.length === 0 ? (
          <p className={emptyPanelClass}>
            Nothing under this filter. {items.length} item
            {items.length === 1 ? '' : 's'} waiting elsewhere.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {shown.map((item) => (
              <AttentionCard
                item={item}
                job={item.jobId === null ? undefined : byId.get(item.jobId)}
                key={item.id}
              />
            ))}
          </ul>
        )}
      </section>

      <aside className="flex flex-col gap-[18px]">
        <RailPanel
          note={`${running.length} of ${maxConcurrency} slots`}
          title="Running"
        >
          <ul className="flex flex-col gap-2.5">
            {running.map((job) => (
              <RunningSlot job={job} key={job.id} />
            ))}
            {Array.from({ length: freeSlots }, (_, offset) => (
              <li className={slotPanelClass} key={`free-${offset}`}>
                Slot {running.length + offset + 1} free
              </li>
            ))}
          </ul>
        </RailPanel>

        <RailPanel note={`${queued.length} waiting for a slot`} title="Queue">
          {queued.length === 0 ? (
            <p className={slotPanelClass}>Nothing is queued.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {queued.map((job, index) => (
                <QueueRow job={job} key={job.id} position={index + 1} />
              ))}
            </ul>
          )}
        </RailPanel>
      </aside>
    </div>
  )
}
