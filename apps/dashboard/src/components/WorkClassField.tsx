import { workClasses, type WorkClass } from '@handella/contracts'
import { useId } from 'react'

import { workClassLabels } from '../labels.ts'
import { segmentClass, segmentTrackClass } from '../styles.ts'

/**
 * The closed list of work classes, offered the same way wherever the Handler
 * picks one. Companion to `BaseBranchField`: both intake paths take exactly
 * these two decisions, so both take them through the same two controls.
 *
 * A segmented control rather than a select, because there are two options and
 * the choice decides how the job is planned — it should be readable without
 * opening anything. Radios keep it keyboard reachable and screen-reader
 * legible; the segment is what the Handler sees.
 *
 * The chosen half is the flat `--secondary` fill rather than mint. A segmented
 * control is one of the two shapes the revamp still allows to look pressable,
 * and filling half of it with the colour reserved for "this is the action" put
 * a second mint surface on a screen that already has its primary in the footer.
 */
/**
 * `labelHidden` keeps the name and drops the heading. Intake wraps this in a
 * numbered step whose heading is already the word, so showing both put the
 * same label on the screen twice — but the accessible name still has to name
 * the issue it belongs to, because the panel renders one of these per selected
 * issue and "Work class" three times over is three fields a reader cannot tell
 * apart.
 */
export function WorkClassField({
  label = 'Work class',
  labelHidden = false,
  onChange,
  value,
}: {
  label?: string
  labelHidden?: boolean
  onChange: (value: WorkClass) => void
  value: WorkClass
}) {
  // One name per rendered group: intake renders one of these per selected
  // issue, and shared names would make them one radio group.
  const name = useId()

  return (
    <fieldset className="flex min-w-[220px] flex-col gap-2 border-0 p-0">
      <legend
        className={
          labelHidden ? 'sr-only' : 'mb-2 text-[13px] font-medium text-ink-2'
        }
      >
        {label}
      </legend>
      <div className={segmentTrackClass}>
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
              className={`${segmentClass} peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-mint/55 ${
                value === workClass
                  ? 'bg-secondary font-[550] text-ink'
                  : 'text-ink-3 hover:text-ink'
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
        Routine plans on its own in the worktree. Feature opens a terminal
        interview with{' '}
        <code className="font-mono text-mint-soft">/grill-with-docs</code>.
      </p>
    </fieldset>
  )
}
