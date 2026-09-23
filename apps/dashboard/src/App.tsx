import { Link, NavLink, Route, Routes } from 'react-router'

import { Slots } from './components/Slots.tsx'
import { useAttentionItems } from './hooks/useAttentionItems.ts'
import { useEventStream } from './hooks/useEventStream.ts'
import { useJobs } from './hooks/useJobs.ts'
import { isRunning, maxConcurrency } from './jobViews.ts'
import { AttentionInboxPage } from './pages/AttentionInboxPage.tsx'
import { IntakePage } from './pages/IntakePage.tsx'
import { JobDetailPage } from './pages/JobDetailPage.tsx'
import { JobsPage } from './pages/JobsPage.tsx'
import { NotFoundPage } from './pages/NotFoundPage.tsx'
import { SystemStatusPage } from './pages/SystemStatusPage.tsx'
import { navPillClass, pillGroupClass, primaryButtonClass } from './styles.ts'

/**
 * `attention` marks the one entry that carries the count of what is waiting:
 * the badge belongs to the screen the Attention Items live on, and only that
 * screen.
 */
const navigation: { attention?: true; label: string; to: string }[] = [
  { attention: true, label: 'Home', to: '/' },
  { label: 'Jobs', to: '/jobs' },
  { label: 'Intake', to: '/intake' },
  { label: 'System', to: '/system' },
]

function BrandMark() {
  return (
    <span
      aria-hidden="true"
      className="grid size-[26px] place-items-center rounded-lg bg-mint font-mono text-[12.5px] font-bold text-on-mint"
    >
      H
    </span>
  )
}

/**
 * How much is waiting, carried on the nav so it is visible from a screen that
 * is not Home. Nothing waiting draws nothing: a zero is a number the Handler
 * would have to read before ignoring.
 *
 * Kept from before the revamp, which does not draw it. The handoff's own Home
 * screen puts this count next to the page title in a mint rectangle, and a
 * count that only exists on the screen it describes cannot do the job of
 * bringing the Handler back to it.
 */
function AttentionBadge() {
  const attention = useAttentionItems()
  const waiting = attention.data?.length ?? 0
  if (waiting === 0) return null

  return (
    <span
      aria-label={`${waiting} waiting on you`}
      className="rounded-[5px] bg-mint px-[6px] py-px font-mono text-[10.5px] font-semibold text-on-mint"
    >
      {waiting}
    </span>
  )
}

/**
 * The handoff's capacity readout, which replaces a bare `0/3 running` pill that
 * looked pressable. Labelled, squared off at 8px and sitting on the card value
 * rather than in a pill: an ambient number is a fact, and facts in this design
 * are not pill-shaped.
 */
function CapacityReadout() {
  const jobs = useJobs()
  // A shell that has not heard from the service yet says nothing rather than
  // claiming nothing is running.
  if (jobs.data === undefined) return null

  const running = jobs.data.filter(isRunning).length

  return (
    <span className="inline-flex items-center gap-2 rounded-lg bg-raised px-3 py-1.5">
      <Slots used={running} variant="nav" />
      <span className="whitespace-nowrap font-mono text-[11.5px] text-ink-3">
        {running} of {maxConcurrency} slots busy
      </span>
    </span>
  )
}

function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-svh bg-surface text-ink">
      {/* The handoff draws this band at a fixed 64px for 1440px. Below the
          1200px the rails collapse at, the same row wraps rather than pushing
          the capacity readout off the edge: the nav is kept, not shortened.

          Pinned, and opaque so what scrolls under it does not show through: a
          rail that sticks below it (Intake's) needs the band's height to be
          the same 64px whether the page is scrolled or not. */}
      <header className="sticky top-0 z-20 flex min-h-16 flex-wrap items-center gap-x-6 gap-y-3 border-b border-line-nav bg-chrome px-6 py-3 min-[1200px]:h-16 min-[1200px]:flex-nowrap min-[1200px]:py-0">
        <div className="flex items-center gap-2.5">
          <BrandMark />
          <p className="text-[15px] font-semibold tracking-[-0.2px]">
            handella
          </p>
        </div>

        <nav aria-label="Primary navigation" className={pillGroupClass}>
          {navigation.map((item) => (
            <NavLink
              className={({ isActive }) =>
                `${navPillClass} ${
                  isActive
                    ? 'bg-mint/[0.18] font-medium text-mint-soft'
                    : 'text-ink-3 hover:text-ink'
                }`
              }
              end={item.to === '/'}
              key={item.to}
              to={item.to}
            >
              {item.label}
              {item.attention === true ? <AttentionBadge /> : null}
            </NavLink>
          ))}
        </nav>

        <CapacityReadout />

        {/* The global primary, so starting work is reachable from every screen.
            It is the one mint button a screen is allowed on top of its own:
            every other screen's primary is about the thing already in front of
            the Handler, and this one is about the next thing. */}
        <Link className={`ml-auto ${primaryButtonClass}`} to="/intake">
          New job
        </Link>
      </header>
      <main>{children}</main>
    </div>
  )
}

function App() {
  // One stream for the whole shell; every page reads through the query cache.
  useEventStream()

  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<AttentionInboxPage />} />
        <Route path="/intake" element={<IntakePage />} />
        <Route path="/jobs" element={<JobsPage />} />
        <Route path="/jobs/:jobId" element={<JobDetailPage />} />
        <Route path="/system" element={<SystemStatusPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </AppShell>
  )
}

export default App
