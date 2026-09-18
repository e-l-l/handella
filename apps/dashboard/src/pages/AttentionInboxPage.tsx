import { isSettledJobState, type AttentionItem } from '@handella/contracts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router'

import {
  attentionKeys,
  fetchAttentionItems,
  resolveAttentionItem,
} from '../api/attention.ts'
import { fetchJobs, jobKeys } from '../api/jobs.ts'
import { JobRow } from '../components/JobRow.tsx'
import { attentionKindLabels } from '../labels.ts'

function InboxRow({ item }: { item: AttentionItem }) {
  const queryClient = useQueryClient()
  const resolve = useMutation({
    mutationFn: () => resolveAttentionItem(item.id),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: attentionKeys.all }),
  })

  return (
    <li className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-line bg-surface p-4">
      <div className="flex flex-col gap-1">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">
          {attentionKindLabels[item.kind]}
        </p>
        <p className="text-sm font-medium">{item.title}</p>
        {item.body === null ? null : (
          <p className="text-sm text-muted">{item.body}</p>
        )}
        {item.jobId === null ? null : (
          <Link
            className="text-sm text-brand underline"
            to={`/jobs/${item.jobId}`}
          >
            Open the job
          </Link>
        )}
      </div>
      <button
        className="rounded-full bg-surface-raised px-3 py-1.5 text-sm font-medium ring-1 ring-line disabled:opacity-50"
        disabled={resolve.isPending}
        onClick={() => resolve.mutate()}
        type="button"
      >
        Resolve
      </button>
    </li>
  )
}

export function AttentionInboxPage() {
  const attention = useQuery({
    queryKey: attentionKeys.all,
    queryFn: fetchAttentionItems,
  })
  const jobs = useQuery({ queryKey: jobKeys.all, queryFn: fetchJobs })

  const inFlight = (jobs.data ?? []).filter(
    (job) => !isSettledJobState(job.state),
  )

  return (
    <section className="mx-auto flex max-w-4xl flex-col gap-10 px-5 py-10 sm:px-8">
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">
          What needs you
        </h1>

        {attention.isPending ? (
          <p
            aria-label="Loading the attention inbox"
            className="text-sm text-muted"
          >
            Loading…
          </p>
        ) : attention.data === undefined || attention.data.length === 0 ? (
          <p className="text-sm text-muted">Nothing is waiting on you.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {attention.data.map((item) => (
              <InboxRow item={item} key={item.id} />
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold tracking-tight">Jobs in flight</h2>
        {inFlight.length === 0 ? (
          <p className="text-sm text-muted">No jobs are in flight.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {inFlight.map((job) => (
              <JobRow job={job} key={job.id} />
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
