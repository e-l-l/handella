import {
  availableSlots,
  isQueued,
  maxConcurrency,
  orderQueue,
  type Job,
} from '@handella/contracts'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jobKeys, reorderQueue } from '../api/jobs.ts'
import { cardClass, secondaryButtonClass } from '../styles.ts'

const move = (jobIds: string[], from: number, to: number): string[] => {
  const next = [...jobIds]
  const [moved] = next.splice(from, 1)
  if (moved === undefined) return jobIds
  next.splice(to, 0, moved)
  return next
}

/**
 * The queue, in the order the scheduler will read it. Reordered by moving one
 * job at a time rather than by dragging: the whole order is sent on every
 * change, so a keyboard and a pointer take the same path, and there is no drag
 * library to teach about a list that the event stream can reorder underneath it.
 */
export function QueuePanel({ jobs }: { jobs: Job[] }) {
  const queryClient = useQueryClient()
  const queue = orderQueue(jobs.filter(isQueued))

  const reorder = useMutation({
    mutationFn: (jobIds: string[]) => reorderQueue(jobIds),
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: jobKeys.all })
    },
  })

  if (queue.length === 0) return null

  const ids = queue.map((job) => job.id)
  const running = maxConcurrency - availableSlots(jobs)

  return (
    <article className={`mb-5 flex flex-col gap-3 ${cardClass}`}>
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className="text-[15px] font-semibold">Queue</h2>
        <p className="font-mono text-[11.5px] text-ink-5">
          {running}/{maxConcurrency} slots in use · {queue.length} waiting
        </p>
      </div>

      <ol className="flex flex-col gap-2">
        {queue.map((job, index) => (
          <li
            className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-2.5"
            key={job.id}
          >
            <span className="font-mono text-[11.5px] text-ink-5">
              {index + 1}
            </span>
            <span className="min-w-0 truncate text-[13.5px]">{job.title}</span>
            <span className="truncate font-mono text-[11.5px] text-ink-5">
              {job.canonicalBranch ?? 'no branch'}
            </span>
            <div className="ml-auto flex gap-2">
              <button
                aria-label={`Move ${job.title} up the queue`}
                className={secondaryButtonClass}
                disabled={index === 0 || reorder.isPending}
                onClick={() => reorder.mutate(move(ids, index, index - 1))}
                type="button"
              >
                Up
              </button>
              <button
                aria-label={`Move ${job.title} down the queue`}
                className={secondaryButtonClass}
                disabled={index === queue.length - 1 || reorder.isPending}
                onClick={() => reorder.mutate(move(ids, index, index + 1))}
                type="button"
              >
                Down
              </button>
            </div>
          </li>
        ))}
      </ol>

      {reorder.error === null || reorder.error === undefined ? null : (
        <p className="text-[13px] text-red-ink" role="alert">
          {reorder.error.message}
        </p>
      )}
    </article>
  )
}
