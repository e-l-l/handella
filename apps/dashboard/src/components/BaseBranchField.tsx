import { useQuery } from '@tanstack/react-query'
import { useId } from 'react'

import { baseBranchesOptions } from '../api/intake.ts'
import { labelClass, monoFieldClass } from '../styles.ts'

/**
 * Free text with help rather than a closed list. Once a repository is chosen the
 * help is that remote's branches; before then it is what this installation has
 * been pointed at before. A datalist suggests without preventing, which keeps a
 * branch that exists only on the remote's next fetch typeable.
 *
 * The hint sits outside the label so the field's accessible name stays the one
 * word the Handler was given, rather than the sentence beneath it.
 */
/**
 * `labelHidden` keeps the name and drops the heading. Intake wraps this in a
 * numbered step whose heading is already the word, so showing both put the
 * same label on the screen twice — but the accessible name still has to name
 * the issue it belongs to, because the panel renders one of these per selected
 * issue and "Base branch" three times over is three fields a reader cannot tell
 * apart.
 */
export function BaseBranchField({
  label = 'Base branch',
  labelHidden = false,
  onChange,
  repositoryId,
  value,
}: {
  label?: string
  labelHidden?: boolean
  onChange: (value: string) => void
  repositoryId?: string
  value: string
}) {
  const listId = useId()
  const suggestions = useQuery(baseBranchesOptions(repositoryId))

  const options =
    suggestions.data === undefined
      ? []
      : [suggestions.data.defaultBranch, ...suggestions.data.recent]

  return (
    <div className="flex min-w-[220px] flex-1 flex-col gap-2">
      <label className="flex flex-col gap-2">
        <span className={labelHidden ? 'sr-only' : labelClass}>{label}</span>
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
