import { NavLink, Route, Routes } from 'react-router'

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
      className="grid size-7 place-items-center rounded-[10px] bg-mint font-mono text-[13px] font-bold text-deep"
    >
      H
    </span>
  )
}

/**
 * How much is waiting, carried on the nav so it is visible from a screen that
 * is not the inbox. Nothing waiting draws nothing: a zero is a number the
 * Handler would have to read before ignoring.
 */
function AttentionBadge() {
  const attention = useAttentionItems()
  const waiting = attention.data?.length ?? 0
  if (waiting === 0) return null

  return (
    <span
      aria-label={`${waiting} waiting on you`}
      className="rounded-full bg-mint px-[7px] py-px font-mono text-[11px] font-semibold text-deep"
    >
      {waiting}
    </span>
  )
}

/**
 * The ambient read the handoff asks the nav to carry: how much of the machine
 * is busy, visible from every screen without opening one.
 */
function ConcurrencyChip() {
  const jobs = useJobs()
  // A shell that has not heard from the service yet says nothing rather than
  // claiming nothing is running.
  if (jobs.data === undefined) return null

  const running = jobs.data.filter(isRunning).length

  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-raised px-3.5 py-[7px]">
      <span aria-hidden="true" className="flex items-center gap-1">
        {Array.from({ length: maxConcurrency }, (_, slot) => (
          <span
            className={`size-[7px] rounded-full ${slot < running ? 'bg-mint' : 'bg-secondary'}`}
            key={slot}
          />
        ))}
      </span>
      <span className="font-mono text-[12.5px] text-ink-4">
        {running}/{maxConcurrency} running
      </span>
    </span>
  )
}

function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-svh bg-surface text-ink">
      {/* The handoff draws this band at a fixed 70px for 1440px. Below the
          1200px the rails collapse at, the same row wraps rather than pushing
          the concurrency chip off the edge: the nav is kept, not shortened.

          Pinned, and opaque so what scrolls under it does not show through: a
          rail that sticks below it (Intake's) needs the band's height to be
          the same 70px whether the page is scrolled or not. */}
      <header className="sticky top-0 z-20 flex min-h-[70px] flex-wrap items-center gap-x-[26px] gap-y-3 border-b border-line bg-surface px-7 py-3 min-[1200px]:h-[70px] min-[1200px]:flex-nowrap min-[1200px]:py-0">
        <div className="flex items-center gap-[11px]">
          <BrandMark />
          <p className="text-[15px] font-semibold tracking-[-0.2px]">
            handella
          </p>
        </div>

        <nav
          aria-label="Primary navigation"
          className="flex items-center gap-[3px] rounded-full bg-raised p-1"
        >
          {navigation.map((item) => (
            <NavLink
              className={({ isActive }) =>
                `flex items-center gap-1.5 rounded-full px-3 py-2 text-[13.5px] min-[1200px]:px-4 ${
                  isActive
                    ? 'bg-mint/16 font-medium text-mint-soft'
                    : 'text-ink-4 hover:text-ink-2'
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

        <div className="ml-auto flex items-center gap-3">
          <ConcurrencyChip />
        </div>
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
