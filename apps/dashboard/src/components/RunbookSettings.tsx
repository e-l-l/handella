import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import {
  createRunbookVersion,
  fetchRunbookVersions,
  runbookKeys,
} from '../api/runbooks.ts'
import { formatTimestamp } from '../labels.ts'
import {
  emptyPanelClass,
  fieldClass,
  helperClass,
  insetClass,
  primaryButtonClass,
  quietButtonClass,
  secondaryButtonClass,
  sectionTitleClass,
} from '../styles.ts'
import { Tag } from './Tag.tsx'

/** How much of the runbook the read-only preview shows before eliding it. */
const previewLines = 6

/**
 * The procedure every job's implementation follows. Append-only, so this saves
 * a new version rather than editing the one in force: jobs have already
 * approved against what it said, and their snapshots have to keep meaning
 * something.
 *
 * Read-only until asked. What it replaces was an editable textarea holding the
 * version in force, always focusable, with a save button beneath it — which
 * made the most consequential text in the installation the easiest thing on
 * the screen to change by accident.
 */
export function RunbookSettings() {
  // Null while reading; editing starts from a copy of the version in force.
  const [draft, setDraft] = useState<string | null>(null)
  const editing = draft !== null
  const [showHistory, setShowHistory] = useState(false)
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
  const nextVersion = (active?.version ?? 0) + 1
  const changed =
    draft !== null && draft.trim() !== '' && draft !== active?.content
  const earlier = versions.data?.slice(1) ?? []

  const lines = (active?.content ?? '').split('\n')
  const preview = lines.slice(0, previewLines)

  return (
    <section className="flex flex-col gap-3.5" id="runbook">
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className={sectionTitleClass}>Runbook</h2>
            <Tag small>
              {active === undefined
                ? 'not loaded'
                : `v${active.version} in force`}
            </Tag>
          </div>
          <p className={`max-w-[600px] ${helperClass}`}>
            Followed by every job&rsquo;s implementation. A job freezes this
            when its plan is approved, so edits here never change what an
            approved job will run.
          </p>
        </div>
        <div className="ml-auto flex flex-none flex-wrap items-center gap-1.5">
          {earlier.length === 0 ? null : (
            <button
              aria-expanded={showHistory}
              className={quietButtonClass}
              onClick={() => setShowHistory((was) => !was)}
              type="button"
            >
              {showHistory ? 'Hide history' : 'View history'}
            </button>
          )}
          <button
            aria-expanded={editing}
            className={secondaryButtonClass}
            disabled={versions.isPending}
            onClick={() => setDraft(editing ? null : (active?.content ?? ''))}
            type="button"
          >
            {editing ? 'Cancel' : 'Edit runbook'}
          </button>
        </div>
      </div>

      {editing ? (
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
            className={`${fieldClass} min-h-[260px] resize-y font-mono text-[12.5px] leading-[1.55]`}
            onChange={(event) => setDraft(event.target.value)}
            spellCheck={false}
            value={draft ?? ''}
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              className={primaryButtonClass}
              disabled={!changed || save.isPending}
              type="submit"
            >
              {save.isPending ? 'Saving…' : `Save as v${nextVersion}`}
            </button>
            {/* Said where the save button is: this never overwrites, so the
                number on the button is the one thing that tells the Handler
                what they are about to create. */}
            <p className={helperClass}>
              Saving adds a version. Nothing is overwritten and v
              {active?.version ?? 0} stays readable.
            </p>
          </div>
          {save.error === null ? null : (
            <p className="text-[13px] text-red-ink" role="alert">
              {save.error.message}
            </p>
          )}
        </form>
      ) : active === undefined ? (
        versions.isPending ? (
          <p className={emptyPanelClass} role="status">
            Reading the runbook…
          </p>
        ) : (
          <p className={emptyPanelClass}>
            No runbook yet. Every job&rsquo;s implementation follows this, so
            write one before approving a plan.
          </p>
        )
      ) : (
        <>
          <pre className="overflow-x-auto rounded-xl border border-line bg-deep px-[18px] py-4 font-mono text-[12px] leading-[1.8] text-ink-3">
            {preview.map((line, index) => (
              // Keyed by position: these are lines of one document, and two of
              // them are allowed to be identical.
              <span
                className={`block ${line.startsWith('#') ? 'text-mint-soft' : ''}`}
                key={index}
              >
                {line === '' ? ' ' : line}
              </span>
            ))}
            {lines.length > previewLines ? (
              <span className="block text-ink-6">…</span>
            ) : null}
          </pre>
          <p className="font-mono text-[12px] text-ink-5">
            saved {formatTimestamp(active.createdAt)} · read-only here
          </p>
        </>
      )}

      {showHistory && earlier.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {earlier.map((version) => (
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
      ) : null}
    </section>
  )
}
