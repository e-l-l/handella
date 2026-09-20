import { type QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

import { IntakeStateProvider } from './state/IntakeStateProvider.tsx'

/**
 * Every provider the application needs, in the order it needs them. The
 * browser entry and the test shell both mount this, so a provider added here
 * is never one that has to be remembered in two places.
 *
 * The router stays with the caller: the application runs under a
 * BrowserRouter and the tests under a MemoryRouter, and neither provider here
 * reads from it.
 */
export function AppProviders({
  children,
  queryClient,
}: {
  children: ReactNode
  queryClient: QueryClient
}) {
  return (
    <QueryClientProvider client={queryClient}>
      <IntakeStateProvider>{children}</IntakeStateProvider>
    </QueryClientProvider>
  )
}
