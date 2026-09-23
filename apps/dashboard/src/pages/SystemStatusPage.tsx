import { useQuery } from '@tanstack/react-query'
import { useLocation } from 'react-router'

import { fetchSystemStatus, statusKeys } from '../api/status.ts'
import { Fact } from '../components/Fact.tsx'
import { RepositorySettings } from '../components/RepositorySettings.tsx'
import { RunbookSettings } from '../components/RunbookSettings.tsx'
import { ServiceUnreachable } from '../components/ServiceUnreachable.tsx'
import { Skeleton, SkeletonList } from '../components/Skeleton.tsx'
import { Dot, Tag } from '../components/Tag.tsx'
import { maxConcurrency } from '../jobViews.ts'
import {
  databaseStatusLabels,
  formatTimestamp,
  formatUptime,
} from '../labels.ts'
import {
  cardClass,
  cardTitleClass,
  helperClass,
  pageTitleClass,
  quietButtonClass,
  sectionTitleClass,
  sidebarGridClass,
} from '../styles.ts'

/**
 * The sections this screen holds, which are also the sidebar.
 *
 * Concurrency is not one of them. The handoff draws it as a settings section,
 * and `maxConcurrency` is a constant in the contracts for the reason ADR 0006
 * gives about the timeouts: the failure a bad value causes is a job that never
 * starts, which the Handler would read as Handella being broken rather than as
 * a number they chose. The number itself is under Diagnostics, where a fact
 * about the installation belongs.
 */
const sections = [
  { id: 'repositories', label: 'Repositories' },
  { id: 'runbook', label: 'Runbook' },
  { id: 'integrations', label: 'Integrations' },
  { id: 'diagnostics', label: 'Diagnostics' },
] as const

/**
 * Which integrations are set up, as three facts rather than three cards.
 *
 * An integration Handella can run without is reported rather than refused at
 * startup, so this is the one place that says which of them the installation
 * actually has — and, for each one that is missing, what stops working.
 */
const integrations = [
  {
    key: 'linear' as const,
    label: 'Linear',
    missing: 'Intake cannot offer issues or name canonical branches.',
  },
  {
    key: 'codex' as const,
    label: 'Codex',
    missing: 'Nothing can be planned or implemented.',
  },
  {
    key: 'github' as const,
    label: 'GitHub',
    missing: 'Pull requests cannot be opened or checked for merges.',
  },
]

/**
 * Settings, and not a status dashboard.
 *
 * What it replaces was three large cards of health telemetry above the two
 * things a Handler actually comes here to change. The health is now one strip,
 * the installation's identifiers are behind Diagnostics, and the screen opens
 * on the repositories.
 */
export function SystemStatusPage() {
  const { hash } = useLocation()
  const statusQuery = useQuery({
    queryKey: statusKeys.current,
    queryFn: fetchSystemStatus,
    refetchInterval: 30_000,
  })

  // The sidebar highlights whatever the Handler last navigated to, which the
  // hash already records — so there is no scroll observer here and no state
  // that can disagree with where the browser actually took them.
  const active = hash.replace('#', '') || sections[0].id
  const status = statusQuery.data

  return (
    <section className={`${sidebarGridClass} px-6 pb-[34px] pt-[26px]`}>
      <div className="flex flex-col gap-4">
        <h1 className={`${pageTitleClass} min-[1000px]:sr-only`}>System</h1>
        <nav aria-label="Settings sections" className="flex flex-col gap-1">
          {sections.map((section) => (
            <a
              aria-current={section.id === active ? 'true' : undefined}
              className={`rounded-[9px] px-3 py-2.5 text-[13.5px] ${
                section.id === active
                  ? 'bg-raised-hover font-medium text-ink'
                  : 'text-ink-3 hover:text-ink'
              }`}
              href={`#${section.id}`}
              key={section.id}
            >
              {section.label}
            </a>
          ))}
        </nav>
      </div>

      <div className="flex min-w-0 max-w-[900px] flex-col gap-[22px]">
        {/* One strip. The installation UUID, the uptime and the journal mode
            used to be three cards above everything else on the screen, which
            made settings look like telemetry. */}
        {statusQuery.isPending ? (
          <SkeletonList
            className="h-[46px] rounded-xl"
            count={1}
            label="Checking service status"
            wrapperClassName="flex flex-col"
          />
        ) : statusQuery.isError ? (
          <ServiceUnreachable
            heading="Handella could not complete its local health check."
            message={statusQuery.error.message}
            onRetry={() => void statusQuery.refetch()}
            retrying={statusQuery.isFetching}
          />
        ) : status === undefined ? null : (
          <div
            aria-live="polite"
            className="flex flex-wrap items-center gap-4 rounded-xl border border-line bg-raised px-4 py-3"
          >
            <span className="flex items-center gap-2.5">
              <Dot tone="mint" />
              <span className="text-[13px] text-ink-2">
                {statusQuery.isFetching
                  ? 'Service refreshing'
                  : 'Service connected'}
              </span>
            </span>
            <span className="font-mono text-[11.5px] text-ink-5">
              v{status.version} · 127.0.0.1 · SQLite{' '}
              {status.database.journalMode.toUpperCase()} · up{' '}
              {formatUptime(status.uptimeSeconds)}
            </span>
            <a className={`ml-auto ${quietButtonClass}`} href="#diagnostics">
              Diagnostics
            </a>
          </div>
        )}

        <RepositorySettings />

        <span aria-hidden="true" className="h-px bg-line" />

        <RunbookSettings />

        <span aria-hidden="true" className="h-px bg-line" />

        <section className="flex flex-col gap-3.5" id="integrations">
          <div className="flex flex-col gap-1.5">
            <h2 className={sectionTitleClass}>Integrations</h2>
            <p className={`max-w-[560px] ${helperClass}`}>
              Configured from <code className="font-mono">.env</code> and read
              at startup, so a change here means restarting Handella. Nothing on
              this screen can set a key — Handella holds no credentials it was
              not given.
            </p>
          </div>
          <ul className="flex flex-col gap-2">
            {integrations.map((integration) => {
              const configured =
                status?.integrations[integration.key].configured ?? false
              return (
                <li
                  className="flex flex-wrap items-center gap-3.5 rounded-xl border border-line bg-raised px-[18px] py-3.5"
                  key={integration.key}
                >
                  <p className="text-[14px] font-[550]">{integration.label}</p>
                  <Tag small tone={configured ? 'mint' : 'amber'}>
                    {configured ? 'configured' : 'not configured'}
                  </Tag>
                  {configured ? null : (
                    <p className="text-[12.5px] text-ink-4">
                      {integration.missing}
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
        </section>

        <span aria-hidden="true" className="h-px bg-line" />

        <section className="flex flex-col gap-3.5" id="diagnostics">
          <div className="flex flex-col gap-1.5">
            <h2 className={sectionTitleClass}>Diagnostics</h2>
            <p className={`max-w-[560px] ${helperClass}`}>
              What this installation is, for a bug report. None of it is a
              setting.
            </p>
          </div>
          {status === undefined ? (
            <Skeleton className="h-40 rounded-[18px]" />
          ) : (
            <div className={`${cardClass} flex flex-col gap-3`}>
              <h3 className={cardTitleClass}>Installation</h3>
              <p className="break-all font-mono text-[12px] leading-[1.5] text-mint-soft">
                {status.installation.id}
              </p>
              <dl className="flex flex-col gap-3 border-t border-line pt-3">
                <Fact label="Version" mono value={status.version} />
                <Fact label="Bound to" mono value="127.0.0.1" />
                <Fact
                  label="Uptime"
                  mono
                  value={formatUptime(status.uptimeSeconds)}
                />
                <Fact
                  label="Journal mode"
                  mono
                  value={status.database.journalMode.toUpperCase()}
                />
                <Fact
                  label="Database"
                  value={databaseStatusLabels[status.database.status]}
                />
                {/* Stated rather than offered: a slot ceiling the Handler could
                    lower is a job that never starts and reads as a fault. */}
                <Fact
                  label="Concurrent slots"
                  mono
                  value={String(maxConcurrency)}
                />
                <Fact
                  label="Created"
                  value={formatTimestamp(status.installation.createdAt)}
                />
                <Fact
                  label="Last started"
                  value={formatTimestamp(status.installation.lastStartedAt)}
                />
              </dl>
            </div>
          )}
        </section>

        <footer className="mt-2 flex flex-col justify-between gap-3 border-t border-line pt-4 text-[12px] text-ink-5 sm:flex-row">
          <p>
            The Handler keeps the final say. Handella keeps the machinery tidy.
          </p>
          <p className="font-mono">Health refreshes every 30 seconds</p>
        </footer>
      </div>
    </section>
  )
}
