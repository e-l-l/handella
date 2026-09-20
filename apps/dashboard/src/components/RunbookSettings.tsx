import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import {
  createRunbookVersion,
  fetchRunbookVersions,
  runbookKeys,
} from '../api/runbooks.ts'
import { formatTimestamp } from '../labels.ts'
import {
  cardClass,
  cardTitleClass,
  fieldClass,
  insetClass,
  primaryButtonClass,
} from '../styles.ts'

/**
 * The procedure every job's implementation follows. Append-only, so this saves
 * a new version rather than editing the one in force: jobs have already
 * approved against what it said, and their snapshots have to keep meaning
 * something.
 */
export function RunbookSettings() {
  const [draft, setDraft] = useState<string | null>(null)
  const queryClient = useQueryClient()

  const versions = useQuery({
    queryKey: runbookKeys.all,
    queryFn: fetchRunbookVersions,
  })

  const save = useMutation({
    mutationFn: (content: string) => createRunbookVersion(content),
    onSuccess: async () => {
      setDraft(null)
      await queryClient.invalidateQueries({ queryKey: runbookKeys.all })
    },
  })

  const active = versions.data?.[0]
  // Null draft means "showing what is saved"; typing takes a copy to edit.
  const value = draft ?? active?.content ?? ''
  const nextVersion = (active?.version ?? 0) + 1
  const changed =
    draft !== null && draft.trim() !== '' && draft !== active?.content

  return (
    <section className={`${cardClass} flex flex-col gap-4`}>
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className={cardTitleClass}>Runbook</h2>
        <p className="font-mono text-[11.5px] text-ink-5">
          {active === undefined
            ? 'not loaded'
            : `v${active.version} in force · saved ${formatTimestamp(active.createdAt)}`}
        </p>
      </div>

      <p className="text-[13px] leading-[1.5] text-ink-3">
        Followed by every job's implementation. A job freezes this at the moment
        its plan is approved, so editing here never changes what an approved job
        will run.
      </p>

      <form
        aria-label="Runbook settings"
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          if (draft !== null) save.mutate(draft)
        }}
      >
        <textarea
          aria-label="Runbook"
          // Empty until the saved runbook arrives, and an empty box invites
          // typing into it — which would save over what is in force.
          disabled={versions.isPending}
          className={`${fieldClass} min-h-[260px] resize-y font-mono text-[12.5px] leading-[1.55]`}
          onChange={(event) => setDraft(event.target.value)}
          spellCheck={false}
          value={value}
        />

        <div className="flex flex-wrap items-center gap-[9px]">
          <button
            className={primaryButtonClass}
            disabled={!changed || save.isPending}
            type="submit"
          >
            Save as v{nextVersion}
          </button>
          {draft === null ? null : (
            <button
              className="text-[13px] text-ink-4 hover:text-ink-2"
              onClick={() => setDraft(null)}
              type="button"
            >
              Discard
            </button>
          )}
        </div>
      </form>

      {save.error === null ? null : (
        <p className="text-[13px] text-red-ink" role="alert">
          {save.error.message}
        </p>
      )}

      {versions.data === undefined || versions.data.length < 2 ? null : (
        <details>
          <summary className="cursor-pointer text-[13px] text-ink-3">
            {versions.data.length - 1} earlier version
            {versions.data.length === 2 ? '' : 's'}
          </summary>
          <ul className="mt-3 flex flex-col gap-2">
            {versions.data.slice(1).map((version) => (
              <li className={insetClass} key={version.id}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-mono text-[12px] text-ink-4">
                    v{version.version}
                  </span>
                  <span className="text-[12.5px] text-ink-5">
                    {formatTimestamp(version.createdAt)}
                  </span>
                </div>
                <pre className="mt-2 overflow-x-auto whitespace-pre-wrap font-mono text-[11.5px] leading-[1.5] text-ink-3">
                  {version.content}
                </pre>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}
