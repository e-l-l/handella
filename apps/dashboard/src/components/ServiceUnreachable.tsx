import { primaryButtonClass } from '../styles.ts'

/**
 * The one screen a Handler sees when the local service is not answering.
 *
 * Shared rather than written per page, because what it says is the same
 * wherever it appears — the service is down, here is what it said, go look at
 * the terminal running it — and only the sentence naming what could not be
 * done changes. A page that owns its own copy of this is a page whose retry
 * copy and red tokens drift from everybody else's.
 */
export function ServiceUnreachable({
  heading,
  message,
  onRetry,
  retrying,
}: {
  /** What could not be done, in the Handler's terms rather than the API's. */
  heading: string
  /** The service's own text, which is the only diagnosable part of this. */
  message: string
  onRetry: () => void
  retrying: boolean
}) {
  return (
    <div
      aria-live="assertive"
      className="flex flex-col gap-3 rounded-2xl border border-red/30 bg-red/[0.09] p-6"
      role="alert"
    >
      <p className="font-mono text-[11px] uppercase tracking-[0.05em] text-red-ink">
        Service unavailable
      </p>
      <h2 className="text-[16px] font-semibold">{heading}</h2>
      <p className="max-w-[640px] text-[13px] leading-[1.6] text-ink-3">
        {message} Check the terminal running the service, then try again.
      </p>
      <button
        className={`self-start ${primaryButtonClass}`}
        disabled={retrying}
        onClick={onRetry}
        type="button"
      >
        {retrying ? 'Trying again…' : 'Try again'}
      </button>
    </div>
  )
}
