import { defaultBaseBranch, type Repository } from '@handella/contracts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { intakeKeys } from '../api/intake.ts'
import {
  chooseRepositoryPath,
  createRepository,
  deleteRepository,
  repositoriesOptions,
  repositoryKeys,
  updateRepository,
} from '../api/repositories.ts'
import {
  destructiveButtonClass,
  emptyPanelClass,
  fieldLabelClass,
  helperClass,
  monoFieldClass,
  primaryButtonClass,
  quietButtonClass,
  secondaryButtonClass,
  sectionTitleClass,
  fieldClass,
} from '../styles.ts'
import { ConfirmDialog } from './ConfirmDialog.tsx'
import { Tag } from './Tag.tsx'

const emptyDraft = { defaultBaseBranch, name: '', path: '' }

type Draft = typeof emptyDraft

/**
 * The name, path and default base branch of one checkout, however it is being
 * filled in. Both the add form and the edit form take exactly these three, so
 * they are one component rather than two that drift.
 */
function RepositoryFields({
  draft,
  onChange,
  onChoosePath,
  choosing,
}: {
  choosing: boolean
  draft: Draft
  onChange: (patch: Partial<Draft>) => void
  onChoosePath: () => void
}) {
  const relative = draft.path !== '' && !draft.path.startsWith('/')

  return (
    <>
      <label className={fieldLabelClass}>
        Name
        <input
          className={fieldClass}
          onChange={(event) => onChange({ name: event.target.value })}
          placeholder="acme monorepo"
          value={draft.name}
        />
      </label>

      {/* The hint sits outside the label, so the field's accessible name stays
          the one word the Handler was given rather than the sentence with it. */}
      <div className="flex flex-col gap-2">
        <label className={fieldLabelClass}>
          Path
          {/* The dialog is opened by the service, not the page: a browser is
              never told the absolute path of a folder someone picks. Typing
              still works, and is the whole story if the dialog fails. */}
          <div className="flex flex-wrap items-center gap-2">
            <input
              className={`${monoFieldClass} min-w-0 flex-1`}
              onChange={(event) => onChange({ path: event.target.value })}
              placeholder="/Users/you/workspace/acme"
              value={draft.path}
            />
            <button
              className={secondaryButtonClass}
              disabled={choosing}
              onClick={onChoosePath}
              type="button"
            >
              {choosing ? 'Choosing…' : 'Choose…'}
            </button>
          </div>
        </label>
        {/* Absolute because a worktree outlives the process that cut it. The
            submit button is disabled until it is one, so the rule is said out
            loud rather than left to be inferred from a button that does
            nothing. */}
        {relative ? (
          <span className="text-[12px] text-amber-ink" role="alert">
            This has to start with <code className="font-mono">/</code>.
            Handella does not expand <code className="font-mono">~</code> or
            resolve a relative path.
          </span>
        ) : (
          <span className="text-[12px] text-ink-5">
            An absolute path to an existing checkout.
          </span>
        )}
      </div>

      <label className={fieldLabelClass}>
        Default base branch
        <input
          className={monoFieldClass}
          onChange={(event) =>
            onChange({ defaultBaseBranch: event.target.value })
          }
          value={draft.defaultBaseBranch}
        />
      </label>
    </>
  )
}

const incompleteDraft = (draft: Draft): boolean =>
  draft.name.trim() === '' ||
  !draft.path.startsWith('/') ||
  draft.defaultBaseBranch.trim() === ''

/**
 * The checkouts Dispatch cuts worktrees from. Handella adopts a clone the
 * Handler already has rather than making one, so this asks for a path rather
 * than a remote URL.
 *
 * The add form is behind a disclosure now rather than permanently open under
 * the list, and removing a repository is a quiet destructive action behind a
 * confirmation rather than a bordered button as prominent as "Add". Both were
 * called out in the handoff: the screen is settings, and a settings screen that
 * is half an open form reads as a form.
 */
export function RepositorySettings() {
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState(emptyDraft)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [edit, setEdit] = useState(emptyDraft)
  const [removing, setRemoving] = useState<Repository | null>(null)
  const queryClient = useQueryClient()

  const repositories = useQuery(repositoriesOptions)

  // Adding, editing or removing one changes what Intake can offer as a base
  // branch.
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: repositoryKeys.all }),
      queryClient.invalidateQueries({ queryKey: intakeKeys.baseBranchesAll }),
    ])
  }

  const add = useMutation({
    mutationFn: () => createRepository(draft),
    onSuccess: () => {
      setDraft(emptyDraft)
      setAdding(false)
    },
    onSettled: refresh,
  })
  const save = useMutation({
    mutationFn: (repositoryId: string) => updateRepository(repositoryId, edit),
    onSuccess: () => setEditingId(null),
    onSettled: refresh,
  })
  const remove = useMutation({
    mutationFn: (repositoryId: string) => deleteRepository(repositoryId),
    onSuccess: () => setRemoving(null),
    onSettled: refresh,
  })
  // A name is proposed from the folder only when the Handler has not written
  // one: the dialog answers the question it was opened for and no other.
  const choosePath = useMutation({
    mutationFn: chooseRepositoryPath,
    onSuccess: ({ path }) => {
      if (path === null) return
      const patch = (current: Draft): Draft => ({
        ...current,
        name:
          current.name.trim() === ''
            ? (path.split('/').pop() ?? '')
            : current.name,
        path,
      })
      if (editingId === null) setDraft(patch)
      else setEdit(patch)
    },
  })

  const failure = add.error ?? remove.error ?? save.error ?? choosePath.error

  const startEditing = (repository: Repository) => {
    setAdding(false)
    setEditingId(repository.id)
    setEdit({
      defaultBaseBranch: repository.defaultBaseBranch,
      name: repository.name,
      path: repository.path,
    })
  }

  return (
    <section className="flex flex-col gap-3.5" id="repositories">
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1.5">
          <h2 className={sectionTitleClass}>Repositories</h2>
          <p className={`max-w-[560px] ${helperClass}`}>
            Handella cuts each job&rsquo;s worktree from a checkout you already
            have. It never clones, and your own git credentials reach the
            remote.
          </p>
        </div>
        <button
          aria-expanded={adding}
          className={`ml-auto flex-none ${secondaryButtonClass}`}
          onClick={() => {
            setEditingId(null)
            setAdding((was) => !was)
          }}
          type="button"
        >
          {adding ? 'Cancel' : 'Add repository'}
        </button>
      </div>

      {adding ? (
        <form
          aria-label="Add a repository"
          className="flex flex-col gap-3 rounded-xl border border-line bg-raised p-4"
          onSubmit={(event) => {
            event.preventDefault()
            add.mutate()
          }}
        >
          <RepositoryFields
            choosing={choosePath.isPending}
            draft={draft}
            onChange={(patch) =>
              setDraft((current) => ({ ...current, ...patch }))
            }
            onChoosePath={() => choosePath.mutate()}
          />
          <button
            className={`self-start ${primaryButtonClass}`}
            disabled={add.isPending || incompleteDraft(draft)}
            type="submit"
          >
            {add.isPending ? 'Adding…' : 'Add repository'}
          </button>
        </form>
      ) : null}

      {repositories.data === undefined ? null : repositories.data.length ===
        0 ? (
        <p className={emptyPanelClass}>
          No repository yet, so nothing can be dispatched. Add one above and
          Intake can offer its branches.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {repositories.data.map((repository) =>
            repository.id === editingId ? (
              <li key={repository.id}>
                <form
                  aria-label={`Edit ${repository.name}`}
                  className="flex flex-col gap-3 rounded-xl border border-line-strong bg-raised p-4"
                  onSubmit={(event) => {
                    event.preventDefault()
                    save.mutate(repository.id)
                  }}
                >
                  <RepositoryFields
                    choosing={choosePath.isPending}
                    draft={edit}
                    onChange={(patch) =>
                      setEdit((current) => ({ ...current, ...patch }))
                    }
                    onChoosePath={() => choosePath.mutate()}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      className={secondaryButtonClass}
                      disabled={save.isPending || incompleteDraft(edit)}
                      type="submit"
                    >
                      {save.isPending ? 'Saving…' : 'Save changes'}
                    </button>
                    <button
                      className={quietButtonClass}
                      onClick={() => setEditingId(null)}
                      type="button"
                    >
                      Discard
                    </button>
                  </div>
                </form>
              </li>
            ) : (
              <li
                className="flex flex-wrap items-center gap-4 rounded-xl border border-line bg-raised px-[18px] py-4"
                key={repository.id}
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <p className="text-[14.5px] font-[550]">
                      {repository.name}
                    </p>
                    <Tag small>base {repository.defaultBaseBranch}</Tag>
                  </div>
                  <p className="break-all font-mono text-[11.5px] text-ink-5">
                    {repository.path}
                  </p>
                </div>
                <div className="ml-auto flex flex-none items-center gap-1.5">
                  <button
                    className={quietButtonClass}
                    onClick={() => startEditing(repository)}
                    type="button"
                  >
                    Edit
                  </button>
                  {/* Never mint, and never beside the primary: removing a
                      checkout used to be an outline button of exactly the same
                      weight as "Add repository". */}
                  <button
                    className={destructiveButtonClass}
                    disabled={remove.isPending}
                    onClick={() => setRemoving(repository)}
                    type="button"
                  >
                    Remove
                  </button>
                </div>
              </li>
            ),
          )}
        </ul>
      )}

      {failure === null || failure === undefined ? null : (
        <p className="text-[13px] text-red-ink" role="alert">
          {failure.message}
        </p>
      )}

      {removing === null ? null : (
        <ConfirmDialog
          confirmLabel="Remove repository"
          consequence="Handella forgets this checkout and stops offering its branches at Intake. The directory on disk, its worktrees and every job already cut from it are left exactly as they are."
          onCancel={() => setRemoving(null)}
          onConfirm={() => remove.mutate(removing.id)}
          pending={remove.isPending}
          title={`Remove “${removing.name}”?`}
        />
      )}
    </section>
  )
}
