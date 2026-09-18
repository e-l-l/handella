import { isApiErrorCode, type ApiError } from '@handella/contracts'

/** Carries the typed code the service sends, so callers can branch on it. */
export class ApiRequestError extends Error {
  readonly code: ApiError['code'] | 'unknown'

  constructor(message: string, code: ApiError['code'] | 'unknown') {
    super(message)
    this.name = 'ApiRequestError'
    this.code = code
  }
}

interface RequestOptions {
  body?: unknown
  /** What to say when the service fails without a readable body. */
  fallbackMessage?: string
  method?: 'DELETE' | 'GET' | 'PATCH' | 'POST'
}

const defaultFallback = 'The local service rejected that request.'

export async function request<Result>(
  path: string,
  options: RequestOptions = {},
): Promise<Result> {
  const sendsBody = options.body !== undefined
  const response = await fetch(path, {
    method: options.method ?? 'GET',
    headers: {
      accept: 'application/json',
      ...(sendsBody ? { 'content-type': 'application/json' } : {}),
    },
    ...(sendsBody ? { body: JSON.stringify(options.body) } : {}),
  })

  if (!response.ok) {
    let message = options.fallbackMessage ?? defaultFallback
    let code: ApiError['code'] | 'unknown' = 'unknown'
    try {
      const error = (await response.json()) as Partial<ApiError>
      if (typeof error.message === 'string') message = error.message
      // Endpoints outside the job API carry their own codes, so an unrecognised
      // one stays 'unknown' rather than being asserted into the union.
      if (typeof error.code === 'string' && isApiErrorCode(error.code)) {
        code = error.code
      }
    } catch {
      // Keep the safe fallback when the response is not JSON.
    }
    throw new ApiRequestError(message, code)
  }

  // A 204 carries no body, and parsing one as JSON throws. Deleting a
  // repository is the only such response today.
  if (response.status === 204) {
    return undefined as Result
  }

  return (await response.json()) as Result
}
