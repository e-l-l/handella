import { NavLink, Route, Routes } from 'react-router'

import { useEventStream } from './hooks/useEventStream.ts'
import { AttentionInboxPage } from './pages/AttentionInboxPage.tsx'
import { JobDetailPage } from './pages/JobDetailPage.tsx'
import { JobsPage } from './pages/JobsPage.tsx'
import { NotFoundPage } from './pages/NotFoundPage.tsx'
import { SystemStatusPage } from './pages/SystemStatusPage.tsx'

const navigation = [
  { label: 'Inbox', to: '/' },
  { label: 'Jobs', to: '/jobs' },
  { label: 'System', to: '/system' },
]

function BrandMark() {
  return (
    <span
      aria-hidden="true"
      className="grid size-9 place-items-center rounded-xl bg-brand text-sm font-bold text-white shadow-sm"
    >
      H
    </span>
  )
}

function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-svh bg-canvas text-ink">
      <header className="border-b border-line/80 bg-surface/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
          <div className="flex items-center gap-3">
            <BrandMark />
            <div>
              <p className="text-sm font-semibold tracking-tight">Handella</p>
              <p className="text-xs text-muted">Local orchestrator</p>
            </div>
          </div>
          <nav
            aria-label="Primary navigation"
            className="flex items-center gap-1"
          >
            {navigation.map((item) => (
              <NavLink
                className={({ isActive }) =>
                  isActive
                    ? 'rounded-full bg-brand-soft px-3 py-1.5 text-sm font-medium text-brand ring-1 ring-brand/10'
                    : 'rounded-full px-3 py-1.5 text-sm font-medium text-muted'
                }
                end={item.to === '/'}
                key={item.to}
                to={item.to}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
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
        <Route path="/jobs" element={<JobsPage />} />
        <Route path="/jobs/:jobId" element={<JobDetailPage />} />
        <Route path="/system" element={<SystemStatusPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </AppShell>
  )
}

export default App
