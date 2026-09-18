import type { JobTransitionRecord } from '@handella/contracts'

import { formatTimestamp, stateLabels } from '../labels.ts'

/**
 * Mint has finished or is healthy (`Chip`), and a job that was cancelled did
 * neither: the move happened, but it ended the job rather than advancing it,
 * so it is marked rather than ticked.
 */
const glyphs: Record<'ended' | 'passed', { className: string; mark: string }> =
  {
    ended: {
      className: 'border-line-strong bg-raised-alt text-ink-4',
      mark: '·',
    },
    passed: {
      className: 'border-mint/40 bg-mint/[0.18] text-mint',
      mark: '✓',
    },
  }

/**
 * The handoff's milestone spine, carrying what Handella can actually say
 * today: where the job has been. Runbook milestones land on the same spine in
 * Phase 6, which is why the glyph and the connector live here rather than in
 * the page.
 */
export function TransitionTimeline({
  transitions,
}: {
  transitions: JobTransitionRecord[]
}) {
  if (transitions.length === 0) {
    return <p className="text-[13px] text-ink-3">This job has not moved yet.</p>
  }

  return (
    <ol className="flex flex-col">
      {transitions.map((transition, index) => {
        const glyph =
          transition.toState === 'cancelled' ? glyphs.ended : glyphs.passed
        return (
          <li className="grid grid-cols-[26px_1fr] gap-3.5" key={transition.id}>
            <div className="flex flex-col items-center">
              <span
                aria-hidden="true"
                className={`grid size-[22px] place-items-center rounded-full border font-mono text-[10.5px] ${glyph.className}`}
              >
                {glyph.mark}
              </span>
              {index === transitions.length - 1 ? null : (
                <span
                  aria-hidden="true"
                  className="min-h-[26px] w-px flex-1 bg-mint-soft/12"
                />
              )}
            </div>

            <div className="pb-4">
              <p className="flex items-center gap-3 text-[14.5px] font-medium text-ink-2">
                {stateLabels[transition.fromState]} →{' '}
                {stateLabels[transition.toState]}
                <span className="ml-auto font-mono text-[11px] text-ink-6">
                  {formatTimestamp(transition.occurredAt)}
                </span>
              </p>
              <p className="mt-1.5 text-[13px] leading-[1.55] text-ink-3">
                {transition.actor === 'handler' ? 'You' : 'Handella'}
                {transition.reason === null ? '' : ` · ${transition.reason}`}
              </p>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
