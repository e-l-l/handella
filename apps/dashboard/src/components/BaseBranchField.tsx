import { useQuery } from '@tanstack/react-query'
import { useId } from 'react'

import { fetchBaseBranches, intakeKeys } from '../api/intake.ts'
import { labelClass, monoFieldClass } from '../styles.ts'

/**
 * Free text with help rather than a closed list: Phase 4 owns Git, so the only
 * branches Handella can honestly offer today are the ones it has been pointed
 * at before. A datalist suggests without preventing.
 *
 * The hint sits outside the label so the field's accessible name stays the one
 * word the Handler was given, rather than the sentence beneath it.
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
    <div className="flex min-w-[220px] flex-1 flex-col gap-2">
      <label className="flex flex-col gap-2">
        <span className={labelClass}>{label}</span>
        <input
          className={monoFieldClass}
          list={listId}
          onChange={(event) => onChange(event.target.value)}
          required
          value={value}
        />
      </label>
      <datalist id={listId}>
        {options.map((branch) => (
          <option key={branch} value={branch} />
        ))}
      </datalist>
      <p className="text-[11.5px] text-ink-6">
        {suggestions.data === undefined
          ? 'The branch this job is cut from.'
          : `Cut from ${suggestions.data.defaultBranch} unless you say otherwise.`}
      </p>
    </div>
  )
}
