import {
  pillActiveClass,
  pillClass,
  pillGroupClass,
  pillIdleClass,
} from '../styles.ts'

/**
 * A filter group: one of the two shapes the handoff still allows to be pills,
 * because it reads as a group of controls rather than as a button competing
 * with the screen's primary action.
 *
 * The count lives on the pill rather than beside the list, since the thing the
 * Handler is deciding is which of these numbers to look at.
 *
 * `aria-pressed` rather than a tablist: these narrow one list in place, and a
 * tab implies a panel of its own that appears when it is chosen.
 */
export function FilterPills<Id extends string>({
  label,
  onChoose,
  options,
  value,
}: {
  /** What is being filtered, since the pills only name their own values. */
  label: string
  onChoose: (id: Id) => void
  options: readonly { count: number; id: Id; label: string }[]
  value: Id
}) {
  return (
    <div aria-label={label} className={pillGroupClass} role="group">
      {options.map((option) => (
        <button
          aria-pressed={option.id === value}
          className={`${pillClass} ${option.id === value ? pillActiveClass : pillIdleClass}`}
          key={option.id}
          onClick={() => onChoose(option.id)}
          type="button"
        >
          {option.label} {option.count}
        </button>
      ))}
    </div>
  )
}
