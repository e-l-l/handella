import { Navigate, Route, Routes } from 'react-router'

import { SystemStatusPage } from './pages/SystemStatusPage.tsx'

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
          <nav aria-label="Primary navigation">
            <a
              aria-current="page"
              className="rounded-full bg-brand-soft px-3 py-1.5 text-sm font-medium text-brand ring-1 ring-brand/10"
              href="/system"
            >
              System
            </a>
          </nav>
        </div>
      </header>
      <main>{children}</main>
    </div>
  )
}

function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Navigate replace to="/system" />} />
        <Route path="/system" element={<SystemStatusPage />} />
        <Route
          path="*"
          element={
            <section className="mx-auto max-w-3xl px-5 py-24 text-center sm:px-8">
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-brand">
                404
              </p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight">
                That room is not in the house yet.
              </h1>
              <a
                className="mt-7 inline-flex rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white"
                href="/system"
              >
                Back to system status
              </a>
            </section>
          }
        />
      </Routes>
    </AppShell>
  )
}

export default App
