import type { StatusError, StatusResponse } from '@handella/contracts'

export class StatusRequestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StatusRequestError'
  }
}

export async function fetchSystemStatus(): Promise<StatusResponse> {
  const response = await fetch('/api/status', {
    headers: { accept: 'application/json' },
  })

  if (!response.ok) {
    let message = 'The local service did not return a healthy status.'
    try {
      const error = (await response.json()) as Partial<StatusError>
      if (typeof error.message === 'string') message = error.message
    } catch {
      // Keep the safe fallback when the response is not JSON.
    }
    throw new StatusRequestError(message)
  }

  return (await response.json()) as StatusResponse
}
