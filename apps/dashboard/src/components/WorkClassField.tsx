import { workClasses, type WorkClass } from '@handella/contracts'

import { workClassLabels } from '../labels.ts'
import { fieldClass } from '../styles.ts'

/**
 * The closed list of work classes, offered the same way wherever the Handler
 * picks one. Companion to `BaseBranchField`: both intake paths take exactly
 * these two decisions, so both take them through the same two controls.
 *
 * The cast is what a `<select>` costs — the DOM only speaks strings — and it
 * is safe because the options are built from the tuple itself.
 */
export function WorkClassField({
  label = 'Work class',
  onChange,
  value,
}: {
  label?: string
  onChange: (value: WorkClass) => void
  value: WorkClass
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      {label}
      <select
        className={fieldClass}
        onChange={(event) => onChange(event.target.value as WorkClass)}
        value={value}
      >
        {workClasses.map((workClass) => (
          <option key={workClass} value={workClass}>
            {workClassLabels[workClass]}
          </option>
        ))}
      </select>
    </label>
  )
}
