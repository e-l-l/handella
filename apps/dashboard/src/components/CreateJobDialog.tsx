import { workClasses, type CreateJob } from '@handella/contracts'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { createJob, jobKeys } from '../api/jobs.ts'

const fieldClass =
  'w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink'

const emptyDraft = {
  baseBranch: 'dev',
  canonicalBranch: '',
  linearIssueKey: '',
  title: '',
  workClass: 'routine',
}

type Draft = typeof emptyDraft

interface FieldSpec {
  hint?: string
  key: keyof Draft
  label: string
  /** Present for the one control that picks from a fixed set. */
  options?: readonly string[]
  placeholder?: string
  required?: boolean
}

const fields: readonly FieldSpec[] = [
  { key: 'title', label: 'Title', required: true },
  { key: 'workClass', label: 'Work class', options: workClasses },
  { key: 'baseBranch', label: 'Base branch', required: true },
  { key: 'linearIssueKey', label: 'Linear issue key', placeholder: 'ENG-412' },
  {
    hint: 'Required before a job can be queued.',
    key: 'canonicalBranch',
    label: 'Canonical branch',
    placeholder: 'ell/eng-412-fix-flaky-login-test',
  },
]

/** Blank is how the Handler says "not known yet", which the wire spells null. */
const orNull = (value: string): string | null =>
  value.trim() === '' ? null : value

/**
 * Phase 3 replaces the two Linear fields with a picker. Until then the Handler
 * types what the adapter will later fetch, and leaving them blank is valid:
 * a job at intake has not been dispatched yet.
 */
export function CreateJobDialog({ onCreated }: { onCreated?: () => void }) {
  const [draft, setDraft] = useState(emptyDraft)
  const queryClient = useQueryClient()

  const create = useMutation({
    mutationFn: () =>
      createJob({
        source: 'adhoc',
        title: draft.title,
        // The select only ever offers members of the tuple.
        workClass: draft.workClass as CreateJob['workClass'],
        baseBranch: draft.baseBranch,
        canonicalBranch: orNull(draft.canonicalBranch),
        linearIssueKey: orNull(draft.linearIssueKey),
      }),
    onSuccess: async () => {
      setDraft(emptyDraft)
      await queryClient.invalidateQueries({ queryKey: jobKeys.all })
      onCreated?.()
    },
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    create.mutate()
  }

  const update = (key: keyof Draft, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  return (
    <form
      aria-label="Create a job"
      className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-5"
      onSubmit={submit}
    >
      {fields.map((field) => (
        <label className="flex flex-col gap-1 text-sm" key={field.key}>
          {field.label}
          {field.hint === undefined ? null : (
            <span className="text-xs text-muted">{field.hint}</span>
          )}
          {field.options === undefined ? (
            <input
              className={fieldClass}
              onChange={(event) => update(field.key, event.target.value)}
              placeholder={field.placeholder}
              required={field.required ?? false}
              value={draft[field.key]}
            />
          ) : (
            <select
              className={fieldClass}
              onChange={(event) => update(field.key, event.target.value)}
              value={draft[field.key]}
            >
              {field.options.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          )}
        </label>
      ))}

      <button
        className="self-start rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        disabled={create.isPending}
        type="submit"
      >
        Create job
      </button>

      {create.error === null ? null : (
        <p className="text-sm text-danger" role="alert">
          {create.error.message}
        </p>
      )}
    </form>
  )
}
