import { useQuery } from '@tanstack/react-query'

import { fetchSystemStatus } from '../api/status.ts'

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(new Date(value))
}

function formatUptime(value: number): string {
  const seconds = Math.max(0, Math.floor(value))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

function LoadingState() {
  return (
    <div
      aria-label="Checking service status"
      className="grid gap-4 md:grid-cols-3"
    >
      {[0, 1, 2].map((item) => (
        <div
          className="h-44 animate-pulse rounded-3xl border border-line bg-surface"
          key={item}
        />
      ))}
    </div>
  )
}

export function SystemStatusPage() {
  const statusQuery = useQuery({
    queryKey: ['system-status'],
    queryFn: fetchSystemStatus,
    refetchInterval: 30_000,
  })

  return (
    <section className="mx-auto max-w-6xl px-5 py-12 sm:px-8 sm:py-16">
      <div className="mb-9 flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-brand">
            Foundation
          </p>
          <h1 className="text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">
            System status
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted sm:text-base">
            A quiet check on the local service, its database, and this Handella
            installation.
          </p>
        </div>
        {statusQuery.data ? (
          <div
            aria-live="polite"
            className="inline-flex w-fit items-center gap-2 rounded-full bg-positive-soft px-3 py-2 text-sm font-semibold text-positive"
          >
            <span className="size-2 rounded-full bg-positive" />
            {statusQuery.isFetching ? 'Refreshing' : 'All systems local'}
          </div>
        ) : null}
      </div>

      {statusQuery.isPending ? <LoadingState /> : null}

      {statusQuery.isError ? (
        <div
          aria-live="assertive"
          className="rounded-3xl border border-danger/20 bg-danger-soft p-7 sm:p-9"
          role="alert"
        >
          <p className="text-sm font-semibold text-danger">
            Service unavailable
          </p>
          <h2 className="mt-2 text-xl font-semibold tracking-tight">
            Handella could not complete its local health check.
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">
            {statusQuery.error.message} Check the terminal running the service,
            then try again.
          </p>
          <button
            className="mt-6 rounded-full bg-danger px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
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
          <article className="rounded-3xl border border-line bg-surface-raised p-6 shadow-[0_18px_55px_rgba(20,35,25,0.06)]">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">
              Local service
            </p>
            <div className="mt-6 flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-2xl bg-positive-soft text-positive">
                <span className="size-2.5 rounded-full bg-positive" />
              </span>
              <div>
                <h2 className="font-semibold">Connected</h2>
                <p className="text-sm text-muted">
                  Version {statusQuery.data.version}
                </p>
              </div>
            </div>
            <dl className="mt-7 border-t border-line pt-4 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Uptime</dt>
                <dd className="font-mono text-xs font-medium">
                  {formatUptime(statusQuery.data.uptimeSeconds)}
                </dd>
              </div>
            </dl>
          </article>

          <article className="rounded-3xl border border-line bg-surface-raised p-6 shadow-[0_18px_55px_rgba(20,35,25,0.06)]">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">
              Database
            </p>
            <div className="mt-6 flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-2xl bg-brand-soft font-mono text-xs font-bold text-brand">
                DB
              </span>
              <div>
                <h2 className="font-semibold">SQLite ready</h2>
                <p className="text-sm text-muted">Write-ahead logging</p>
              </div>
            </div>
            <dl className="mt-7 border-t border-line pt-4 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Journal mode</dt>
                <dd className="font-mono text-xs font-semibold uppercase">
                  {statusQuery.data.database.journalMode}
                </dd>
              </div>
            </dl>
          </article>

          <article className="rounded-3xl border border-line bg-surface-raised p-6 shadow-[0_18px_55px_rgba(20,35,25,0.06)]">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">
              Installation
            </p>
            <p className="mt-6 break-all font-mono text-sm font-semibold leading-6">
              {statusQuery.data.installation.id}
            </p>
            <dl className="mt-5 space-y-3 border-t border-line pt-4 text-xs">
              <div>
                <dt className="text-muted">Created</dt>
                <dd className="mt-1 font-medium">
                  {formatDate(statusQuery.data.installation.createdAt)}
                </dd>
              </div>
              <div>
                <dt className="text-muted">Last started</dt>
                <dd className="mt-1 font-medium">
                  {formatDate(statusQuery.data.installation.lastStartedAt)}
                </dd>
              </div>
            </dl>
          </article>
        </div>
      ) : null}

      <footer className="mt-8 flex flex-col justify-between gap-3 border-t border-line pt-5 text-xs text-muted sm:flex-row">
        <p>
          The Handler keeps the final say. Handella keeps the machinery tidy.
        </p>
        <p>Refreshes every 30 seconds</p>
      </footer>
    </section>
  )
}
