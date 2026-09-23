import type { Job } from '@handella/contracts'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'

import { jobKeys, reorderQueue } from '../api/jobs.ts'
import { FilterPills } from '../components/FilterPills.tsx'
import { JobBeat } from '../components/JobBeat.tsx'
import { JobControls } from '../components/JobControls.tsx'
import { JobRow } from '../components/JobRow.tsx'
import type { OverflowItem } from '../components/OverflowMenu.tsx'
import { SearchField } from '../components/SearchField.tsx'
import { SkeletonList } from '../components/Skeleton.tsx'
import { useJobs } from '../hooks/useJobs.ts'
import {
  groupOrder,
  groupRules,
  jobGroup,
  jobLane,
  needsYouReason,
  type JobGroup,
  type JobLane,
} from '../jobPresentation.ts'
import { orderQueue } from '../jobViews.ts'
import { issueKeyLabel, workClassLabels } from '../labels.ts'
import {
  emptyPanelClass,
  groupLabelClass,
  pageTitleClass,
  screenClass,
} from '../styles.ts'

/**
 * The three filters the handoff draws. They are coarser than the groups on
 * purpose: the group answers "what does this need from me", and the filter
 * answers "am I looking at live work or at history".
 */
const lanes = [
  { id: 'active', label: 'Active' },
  { id: 'done', label: 'Done' },
  { id: 'cancelled', label: 'Cancelled' },
] as const satisfies readonly { id: JobLane; label: string }[]

const isToday = (iso: string, now = new Date()): boolean => {
  const at = new Date(iso)
  return (
    at.getFullYear() === now.getFullYear() &&
    at.getMonth() === now.getMonth() &&
    at.getDate() === now.getDate()
  )
}

/**
 * What the Handler types into the filter box, matched against everything they
 * might remember a job by. The branch is in here because it is often the only
 * thing they have — they came from a terminal that was standing in it.
 */
const matches = (job: Job, needle: string): boolean => {
  if (needle === '') return true
  const haystack = [
    job.title,
    issueKeyLabel(job),
    job.canonicalBranch ?? '',
    job.baseBranch,
    workClassLabels[job.workClass],
  ]
    .join(' ')
    .toLowerCase()
  return haystack.includes(needle.toLowerCase())
}

/** The mono rule a group of rows sits under: a label, a count and a hairline. */
function GroupRule({
  count,
  group,
  label,
}: {
  count: number
  group: JobGroup
  label: string
}) {
  const { rule, text } = groupRules[group]

  return (
    <div className="flex items-center gap-2.5">
      <h2 className={`${groupLabelClass} ${text}`}>
        {label} · {count}
      </h2>
      <span aria-hidden="true" className={`h-px flex-1 ${rule}`} />
    </div>
  )
}

export function JobsPage() {
  const [lane, setLane] = useState<JobLane>('active')
  const [needle, setNeedle] = useState('')
  const jobs = useJobs()
  const queryClient = useQueryClient()

  const reorder = useMutation({
    mutationFn: (jobIds: string[]) => reorderQueue(jobIds),
    onSettled: () => queryClient.invalidateQueries({ queryKey: jobKeys.all }),
  })

  // Memoised because two passes below take it as a dependency: `?? []` is a
  // fresh array every render, and a fresh array is a changed dependency.
  const all = useMemo(() => jobs.data ?? [], [jobs.data])

  const laneOptions = useMemo(
    () =>
      lanes.map((one) => ({
        count: all.filter((job) => jobLane(job) === one.id).length,
        id: one.id,
        label: one.label,
      })),
    [all],
  )

  /**
   * The rows, already grouped and already in the order the groups are drawn in.
   *
   * The Active lane carries a tail of what finished today, which is what the
   * handoff draws: a Handler who has been away wants the thing that landed an
   * hour ago in the same glance as the thing that is stuck, and sending them to
   * another tab for it is how a merged job goes unnoticed for a day.
   */
  const { groups, queueOrder, shown } = useMemo(() => {
    const filtered = all.filter((job) => matches(job, needle))
    const inLane =
      lane === 'active'
        ? filtered.filter(
            (job) =>
              jobLane(job) === 'active' ||
              // Cancelled today is history the Handler may still be surprised
              // by, so it counts as "finished today" alongside merged.
              isToday(job.updatedAt),
          )
        : filtered.filter((job) => jobLane(job) === lane)

    const byGroup = new Map<JobGroup, Job[]>()
    for (const job of inLane) {
      const group = jobGroup(job)
      const bucket = byGroup.get(group)
      if (bucket === undefined) byGroup.set(group, [job])
      else bucket.push(job)
    }

    // Only the queued ones, and in the scheduler's own order, so the position
    // a row shows is the position it will actually be started from.
    const queued = orderQueue(
      (byGroup.get('waiting') ?? []).filter((job) => job.state === 'queued'),
    )
    // The waiting group lists what is queued in queue order first, then the
    // jobs that have not been dispatched at all. A suspended job is never in
    // it: `jobGroup` puts every one under needs-you.
    const waiting = byGroup.get('waiting')
    if (waiting !== undefined) {
      byGroup.set('waiting', [
        ...queued,
        ...waiting.filter((job) => job.state !== 'queued'),
      ])
    }

    return {
      groups: byGroup,
      queueOrder: queued.map((job) => job.id),
      shown: inLane.length,
    }
  }, [all, lane, needle])

  /**
   * Reordering the queue, which needs the whole order rather than one job: the
   * service rewrites positions 1..n from one list, so two jobs can never end up
   * holding the same position. Moving one job at a time rather than dragging
   * means a keyboard and a pointer take the same path, and there is no drag
   * library to teach about a list the event stream can reorder underneath it.
   */
  const queueMoves = (jobId: string): OverflowItem[] => {
    const from = queueOrder.indexOf(jobId)
    if (from === -1 || queueOrder.length < 2) return []

    const moveTo = (to: number): string[] => {
      const next = [...queueOrder]
      const [moved] = next.splice(from, 1)
      if (moved === undefined) return queueOrder
      next.splice(to, 0, moved)
      return next
    }

    return [
      {
        disabled: from === 0 || reorder.isPending,
        label: 'Move up the queue',
        onSelect: () => reorder.mutate(moveTo(from - 1)),
      },
      {
        disabled: from === queueOrder.length - 1 || reorder.isPending,
        label: 'Move down the queue',
        onSelect: () => reorder.mutate(moveTo(from + 1)),
      },
      {
        disabled: from === 0 || reorder.isPending,
        label: 'Move to the front',
        onSelect: () => reorder.mutate(moveTo(0)),
      },
    ]
  }

  const rowMeta = (job: Job, group: JobGroup) => {
    if (group === 'running')
      return (
        <JobBeat
          className="truncate font-mono text-[11.5px] text-ink-5"
          job={job}
        />
      )
    if (group === 'finished') return undefined
    return (
      <span className="truncate font-mono text-[11.5px] text-ink-5">
        {workClassLabels[job.workClass]} · base {job.baseBranch}
        {job.canonicalBranch === null ? '' : ` · ${job.canonicalBranch}`}
      </span>
    )
  }

  /** `FINISHED TODAY` on the Active tab, plain `FINISHED` in the history tabs. */
  const groupLabel = (group: JobGroup): string =>
    group === 'finished' && lane === 'active'
      ? 'FINISHED TODAY'
      : groupRules[group].label

  return (
    <section className={`flex flex-col gap-[18px] ${screenClass}`}>
      <div className="flex flex-wrap items-center gap-3.5">
        <h1 className={pageTitleClass}>Jobs</h1>
        <FilterPills
          label="Filter jobs by lane"
          onChoose={setLane}
          options={laneOptions}
          value={lane}
        />
        <div className="ml-auto w-[280px]">
          <SearchField
            label="Filter jobs"
            onChange={setNeedle}
            placeholder="Filter by issue, branch…"
            value={needle}
          />
        </div>
      </div>

      {reorder.error === null || reorder.error === undefined ? null : (
        <p className="text-[13px] text-red-ink" role="alert">
          {reorder.error.message}
        </p>
      )}

      {jobs.isPending ? (
        <SkeletonList
          className="h-[68px] rounded-[14px]"
          count={4}
          label="Loading jobs"
          wrapperClassName="flex flex-col gap-2.5"
        />
      ) : shown === 0 ? (
        <p className={emptyPanelClass}>
          {all.length === 0
            ? 'No jobs yet. Pick an issue in Intake and Handella cuts a worktree for it.'
            : needle === ''
              ? 'Nothing in this lane. Switch to Active to see live work.'
              : `Nothing matches “${needle}”. Clear the filter to see all ${all.length} jobs.`}
        </p>
      ) : (
        <div className="flex flex-col gap-[18px]">
          {groupOrder.map((group) => {
            const rows = groups.get(group) ?? []
            if (rows.length === 0) return null

            return (
              <div className="flex flex-col gap-2.5" key={group}>
                <GroupRule
                  count={rows.length}
                  group={group}
                  label={groupLabel(group)}
                />
                <ul className="flex flex-col gap-2.5">
                  {rows.map((job) => {
                    const position =
                      queueOrder.indexOf(job.id) === -1
                        ? undefined
                        : queueOrder.indexOf(job.id) + 1

                    return (
                      <JobRow
                        actions={
                          <JobControls
                            extraOverflow={queueMoves(job.id)}
                            job={job}
                            muted={group === 'finished'}
                          />
                        }
                        job={job}
                        key={job.id}
                        meta={rowMeta(job, group)}
                        // Only under the group that needs the Handler. Every
                        // state has something true to say about itself, and a
                        // list where every row carries a sentence has gone back
                        // to saying nothing about which row to read.
                        note={
                          group === 'needsYou'
                            ? (needsYouReason(job) ?? undefined)
                            : undefined
                        }
                        position={position}
                      />
                    )
                  })}
                </ul>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
