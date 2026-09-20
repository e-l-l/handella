import {
  defaultBaseBranch,
  linearPriorities,
  type LinearPriority,
  type WorkClass,
} from '@handella/contracts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'

import { createAdhocJob, teamsOptions } from '../api/intake.ts'
import { jobKeys } from '../api/jobs.ts'
import { linearPriorityLabels } from '../labels.ts'
import {
  cardClass,
  fieldClass,
  fieldLabelClass,
  primaryButtonClass,
} from '../styles.ts'
import { BaseBranchField } from './BaseBranchField.tsx'
import { WorkClassField } from './WorkClassField.tsx'

/**
 * Declared against the contract rather than inferred from its own initial
 * values, so the work class and the priority are the types the wire takes and
 * the `<select>`s narrow where a cast is local and cheap — rather than the
 * last line before the request, where a widened `string` stops the compiler
 * noticing that the contract moved.
 */
interface Draft {
  baseBranch: string
  description: string
  priority: LinearPriority
  teamId: string
  title: string
  workClass: WorkClass
}

const emptyDraft: Draft = {
  baseBranch: defaultBaseBranch,
  description: '',
  priority: 0,
  teamId: '',
  title: '',
  workClass: 'routine',
}

/**
 * Blank is how the Handler says "nothing to add", which the wire spells absent.
 * What survives is the trimmed text, so the decision and the value are made of
 * the same string.
 */
const trimmedOrUndefined = (value: string): string | undefined => {
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/**
 * Ad hoc work becomes a real Linear issue before it becomes a job, because only
 * Linear can name a canonical branch and a job without one can never be
 * dispatched.
 *
 * Nothing proposes a work class: the masterplan files that under Dispatch, and
 * Phase 5's Codex adapter plans an already-classified job rather than
 * classifying one, so the Handler still picks.
 */
export function AdhocIssueForm({
  onCreated,
  repositoryId,
}: {
  onCreated?: () => void
  /** Chosen once for the whole panel, so the ad hoc issue lands in the same checkout. */
  repositoryId: string
}) {
  const [draft, setDraft] = useState(emptyDraft)
  const queryClient = useQueryClient()
  const teams = useQuery(teamsOptions)

  // Which team is preselected is decided once: the submitted team and the
  // displayed team cannot be two different answers to the same question.
  const teamId =
    draft.teamId === '' ? (teams.data?.[0]?.id ?? '') : draft.teamId

  const create = useMutation({
    mutationFn: () => {
      const description = trimmedOrUndefined(draft.description)
      return createAdhocJob({
        teamId,
        title: draft.title,
        workClass: draft.workClass,
        repositoryId,
        baseBranch: draft.baseBranch,
        ...(description === undefined ? {} : { description }),
        priority: draft.priority,
      })
    },
    onSuccess: async () => {
      setDraft(emptyDraft)
      await queryClient.invalidateQueries({ queryKey: jobKeys.all })
      onCreated?.()
    },
  })

  const update = <Key extends keyof Draft>(key: Key, value: Draft[Key]) => {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    create.mutate()
  }

  return (
    <form
      aria-label="Create an ad hoc issue"
      className={`flex flex-col gap-4 ${cardClass}`}
      onSubmit={submit}
    >
      <p className="text-[12.5px] text-ink-4">
        Creates the Linear issue first, then the job, so it can be dispatched.
      </p>

      <label className={fieldLabelClass}>
        Team
        <select
          className={fieldClass}
          onChange={(event) => update('teamId', event.target.value)}
          value={teamId}
        >
          {(teams.data ?? []).map((team) => (
            <option key={team.id} value={team.id}>
              {team.key} — {team.name}
            </option>
          ))}
        </select>
      </label>

      <label className={fieldLabelClass}>
        Title
        <input
          className={fieldClass}
          onChange={(event) => update('title', event.target.value)}
          required
          value={draft.title}
        />
      </label>

      <label className={fieldLabelClass}>
        Description
        <textarea
          className={fieldClass}
          onChange={(event) => update('description', event.target.value)}
          rows={3}
          value={draft.description}
        />
      </label>

      <label className={fieldLabelClass}>
        Priority
        <select
          className={fieldClass}
          onChange={(event) =>
            // The options are built from the tuple, so the value is one of it.
            update('priority', Number(event.target.value) as LinearPriority)
          }
          value={draft.priority}
        >
          {linearPriorities.map((priority) => (
            <option key={priority} value={priority}>
              {linearPriorityLabels[priority]}
            </option>
          ))}
        </select>
      </label>

      <WorkClassField
        onChange={(workClass) => update('workClass', workClass)}
        value={draft.workClass}
      />

      <BaseBranchField
        onChange={(value) => update('baseBranch', value)}
        repositoryId={repositoryId}
        value={draft.baseBranch}
      />

      <button
        className={`self-start ${primaryButtonClass} disabled:opacity-50`}
        disabled={create.isPending || repositoryId === ''}
        type="submit"
      >
        Create issue and job
      </button>

      {/* Without a checkout there is nothing to cut a worktree from, and the
          job half of this request would be refused after the Linear issue had
          already been made. */}
      {repositoryId === '' ? (
        <p className="text-[12px] text-ink-5">
          No repository is configured, so no job can be created yet.{' '}
          <Link
            className="text-mint-soft underline underline-offset-2"
            to="/system"
          >
            Add one in System
          </Link>
          .
        </p>
      ) : null}

      {create.error === null ? null : (
        <p className="text-[13px] text-red-ink" role="alert">
          {create.error.message}
        </p>
      )}
    </form>
  )
}
