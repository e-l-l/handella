import { useQuery } from '@tanstack/react-query'
import { useId } from 'react'

import { fetchBaseBranches, intakeKeys } from '../api/intake.ts'
import { fieldClass } from '../styles.ts'

/**
 * Free text with help rather than a closed list: Phase 4 owns Git, so the only
 * branches Handella can honestly offer today are the ones it has been pointed
 * at before. A datalist suggests without preventing.
 */
export function BaseBranchField({
  label = 'Base branch',
  onChange,
  value,
}: {
  label?: string
  onChange: (value: string) => void
  value: string
}) {
  const listId = useId()
  const suggestions = useQuery({
    queryKey: intakeKeys.baseBranches,
    queryFn: fetchBaseBranches,
  })

  const options =
    suggestions.data === undefined
      ? []
      : [suggestions.data.defaultBranch, ...suggestions.data.recent]

  return (
    <label className="flex flex-col gap-1 text-sm">
      {label}
      <input
        className={fieldClass}
        list={listId}
        onChange={(event) => onChange(event.target.value)}
        required
        value={value}
      />
      <datalist id={listId}>
        {options.map((branch) => (
          <option key={branch} value={branch} />
        ))}
      </datalist>
    </label>
  )
}
