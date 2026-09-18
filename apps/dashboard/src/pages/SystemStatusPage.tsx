import { useQuery } from '@tanstack/react-query'

import { fetchSystemStatus, statusKeys } from '../api/status.ts'
import { Dot } from '../components/Chip.tsx'
import { Fact } from '../components/Fact.tsx'
import { SkeletonList } from '../components/Skeleton.tsx'
import { databaseStatusLabels, formatTimestamp } from '../labels.ts'
import {
  cardClass,
  primaryButtonClass,
  screenClass,
  sectionTitleClass,
} from '../styles.ts'

function formatUptime(value: number): string {
  const seconds = Math.max(0, Math.floor(value))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

/** Card-shaped skeletons at the same radii, so nothing moves when data lands. */
function LoadingState() {
  return (
    <SkeletonList
      className="h-44 rounded-[22px]"
      count={3}
      label="Checking service status"
      wrapperClassName="grid gap-4 md:grid-cols-3"
    />
  )
}

export function SystemStatusPage() {
  const statusQuery = useQuery({
    queryKey: statusKeys.current,
    queryFn: fetchSystemStatus,
    refetchInterval: 30_000,
  })

  return (
    <section className={`flex flex-col ${screenClass}`}>
      <div className="mb-[18px] flex flex-wrap items-center gap-3.5">
        <h1 className={sectionTitleClass}>System</h1>
        <p className="max-w-[560px] text-[13px] leading-[1.6] text-ink-3">
          A quiet check on the local service, its database, and this Handella
          installation.
        </p>
        {statusQuery.data ? (
          <span
            aria-live="polite"
            className="ml-auto inline-flex items-center gap-2 rounded-full bg-mint/16 px-3.5 py-[7px] text-[12.5px] text-mint-soft"
          >
            <Dot tone="mint" />
            {statusQuery.isFetching ? 'Refreshing' : 'All systems local'}
          </span>
        ) : null}
      </div>

      {statusQuery.isPending ? <LoadingState /> : null}

      {statusQuery.isError ? (
        <div
          aria-live="assertive"
          className="flex flex-col gap-3 rounded-[22px] border border-red/30 bg-red/[0.09] p-6"
          role="alert"
        >
          <p className="font-mono text-[11px] uppercase tracking-[0.05em] text-red-ink">
            Service unavailable
          </p>
          <h2 className="text-[16px] font-semibold">
            Handella could not complete its local health check.
          </h2>
          <p className="max-w-[640px] text-[13px] leading-[1.6] text-ink-3">
            {statusQuery.error.message} Check the terminal running the service,
            then try again.
          </p>
          <button
            className={`self-start ${primaryButtonClass}`}
            disabled={statusQuery.isFetching}
            onClick={() => void statusQuery.refetch()}
            type="button"
          >
            {statusQuery.isFetching ? 'Trying again…' : 'Try again'}
          </button>
        </div>
      ) : null}

      {statusQuery.data ? (
        <div className="grid gap-4 md:grid-cols-3">
          <article className={`${cardClass} flex flex-col gap-4`}>
            <p className="font-mono text-[11px] uppercase tracking-[0.05em] text-ink-5">
              Local service
            </p>
            <div className="flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-2xl bg-mint/16">
                <Dot tone="mint" />
              </span>
              <div>
                <h2 className="text-[14.5px] font-semibold">Connected</h2>
                <p className="text-[12.5px] text-ink-4">
                  Version {statusQuery.data.version}
                </p>
              </div>
            </div>
            <dl className="flex flex-col gap-2.5 border-t border-line pt-4">
              <Fact
                label="Uptime"
                value={formatUptime(statusQuery.data.uptimeSeconds)}
              />
              <Fact label="Bound to" value="127.0.0.1" />
            </dl>
          </article>

          <article className={`${cardClass} flex flex-col gap-4`}>
            <p className="font-mono text-[11px] uppercase tracking-[0.05em] text-ink-5">
              Database
            </p>
            <div className="flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-2xl bg-secondary font-mono text-[11px] font-bold text-mint-soft">
                DB
              </span>
              <div>
                <h2 className="text-[14.5px] font-semibold">SQLite ready</h2>
                <p className="text-[12.5px] text-ink-4">Write-ahead logging</p>
              </div>
            </div>
            <dl className="flex flex-col gap-2.5 border-t border-line pt-4">
              <Fact
                label="Journal mode"
                value={statusQuery.data.database.journalMode.toUpperCase()}
              />
              <Fact
                label="Status"
                value={databaseStatusLabels[statusQuery.data.database.status]}
              />
            </dl>
          </article>

          <article className={`${cardClass} flex flex-col gap-4`}>
            <p className="font-mono text-[11px] uppercase tracking-[0.05em] text-ink-5">
              Installation
            </p>
            <p className="break-all font-mono text-[12.5px] leading-[1.5] text-mint-soft">
              {statusQuery.data.installation.id}
            </p>
            <dl className="flex flex-col gap-2.5 border-t border-line pt-4">
              <Fact
                label="Created"
                value={formatTimestamp(statusQuery.data.installation.createdAt)}
              />
              <Fact
                label="Last started"
                value={formatTimestamp(
                  statusQuery.data.installation.lastStartedAt,
                )}
              />
            </dl>
          </article>
        </div>
      ) : null}

      <footer className="mt-8 flex flex-col justify-between gap-3 border-t border-line pt-5 text-[12px] text-ink-5 sm:flex-row">
        <p>
          The Handler keeps the final say. Handella keeps the machinery tidy.
        </p>
        <p className="font-mono">Refreshes every 30 seconds</p>
      </footer>
    </section>
  )
}
