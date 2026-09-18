import { workClasses, type WorkClass } from '@handella/contracts'
import { useId } from 'react'

import { workClassLabels } from '../labels.ts'

/**
 * The closed list of work classes, offered the same way wherever the Handler
 * picks one. Companion to `BaseBranchField`: both intake paths take exactly
 * these two decisions, so both take them through the same two controls.
 *
 * A segmented control rather than a select, because there are two options and
 * the choice decides how the job is planned — it should be readable without
 * opening anything. Radios keep it keyboard reachable and screen-reader
 * legible; the pill is what the Handler sees.
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
  // One name per rendered group: intake renders one of these per selected
  // issue, and shared names would make them one radio group.
  const name = useId()

  return (
    <fieldset className="flex min-w-[220px] flex-col gap-2 border-0 p-0">
      <legend className="mb-2 text-[13px] font-medium text-ink-2">
        {label}
      </legend>
      <div className="flex gap-1 rounded-full bg-raised p-1">
        {workClasses.map((workClass) => (
          <label className="relative flex-1" key={workClass}>
            <input
              checked={value === workClass}
              className="peer sr-only"
              name={name}
              onChange={() => onChange(workClass)}
              type="radio"
              value={workClass}
            />
            <span
              className={`block cursor-pointer rounded-full py-2.5 text-center text-[13px] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-mint/55 ${
                value === workClass
                  ? 'bg-mint font-semibold text-deep'
                  : 'text-ink-4 hover:text-ink-2'
              }`}
            >
              {workClassLabels[workClass]}
            </span>
          </label>
        ))}
      </div>
      {/* What the choice costs, stated where it is made: a Routine is planned
          without the Handler, a Feature is not. */}
      <p className="text-[12px] text-ink-5">
        Routine plans read-only in the worktree. Feature opens a terminal
        interview with{' '}
        <code className="font-mono text-mint-soft">/grill-with-docs</code>.
      </p>
    </fieldset>
  )
}
