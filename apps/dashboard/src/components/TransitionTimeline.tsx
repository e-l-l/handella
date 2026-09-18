import type { JobTransitionRecord } from '@handella/contracts'

import { formatTimestamp, stateLabels } from '../labels.ts'

export function TransitionTimeline({
  transitions,
}: {
  transitions: JobTransitionRecord[]
}) {
  if (transitions.length === 0) {
    return <p className="text-sm text-muted">This job has not moved yet.</p>
  }

  return (
    <ol className="flex flex-col gap-3">
      {transitions.map((transition) => (
        <li className="flex flex-col gap-1" key={transition.id}>
          <p className="text-sm font-medium">
            {stateLabels[transition.fromState]} →{' '}
            {stateLabels[transition.toState]}
          </p>
          <p className="text-xs text-muted">
            {formatTimestamp(transition.occurredAt)} ·{' '}
            {transition.actor === 'handler' ? 'You' : 'Handella'}
            {transition.reason === null ? '' : ` · ${transition.reason}`}
          </p>
        </li>
      ))}
    </ol>
  )
}
