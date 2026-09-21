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

/** The service's own sentence where there is one, and a plain one where not. */
export const messageOf = (error: unknown, fallback: string): string =>
  error instanceof ApiRequestError ? error.message : fallback

interface RequestOptions {
  body?: unknown
  /** What to say when the service fails without a readable body. */
  fallbackMessage?: string
  method?: 'DELETE' | 'GET' | 'PATCH' | 'POST'
}

const defaultFallback = 'The local service rejected that request.'

/**
 * A failed response, read as the service's own error where it is one. Never
 * returns; the signature says so, so a caller does not have to pretend the
 * lines after it are reachable.
 */
async function throwApiError(
  response: Response,
  fallbackMessage?: string,
): Promise<never> {
  let message = fallbackMessage ?? defaultFallback
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

  if (!response.ok) await throwApiError(response, options.fallbackMessage)

  // A 204 carries no body, and parsing one as JSON throws. Deleting a
  // repository and opening a terminal both answer this way.
  if (response.status === 204) {
    return undefined as Result
  }

  return (await response.json()) as Result
}

/**
 * The one endpoint that answers with text rather than a record: an attempt's
 * raw Codex stream. It is served as a tail by default, and the header says
 * whether what arrived is the whole of it.
 */
export async function requestText(
  path: string,
): Promise<{ text: string; truncated: boolean }> {
  const response = await fetch(path, { headers: { accept: 'text/plain' } })

  if (!response.ok) await throwApiError(response, 'That log could not be read.')

  return {
    text: await response.text(),
    truncated: response.headers.get('x-handella-truncated') === 'true',
  }
}
