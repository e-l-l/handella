import type { WorkClass } from '@handella/contracts'

import { workClassLabels } from '../labels.ts'
import { Chip } from './Chip.tsx'

/**
 * A Job's work class wherever it is shown: the flat secondary fill for a
 * Routine that Handella can plan on its own, mint for a Feature that will cost
 * the Handler an interview. Both the tone and the name are decided here, so
 * two screens cannot disagree about either.
 */
const workClassTones = {
  feature: 'mint',
  routine: 'solid',
} as const

export function WorkClassChip({ workClass }: { workClass: WorkClass }) {
  return (
    <Chip tone={workClassTones[workClass]}>{workClassLabels[workClass]}</Chip>
  )
}
