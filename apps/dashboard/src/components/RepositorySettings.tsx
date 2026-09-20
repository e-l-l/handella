import { defaultBaseBranch } from '@handella/contracts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { intakeKeys } from '../api/intake.ts'
import {
  chooseRepositoryPath,
  createRepository,
  deleteRepository,
  repositoriesOptions,
  repositoryKeys,
} from '../api/repositories.ts'
import {
  cardClass,
  emptyPanelClass,
  labelClass,
  pillFieldClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '../styles.ts'

const emptyDraft = {
  name: '',
  path: '',
  defaultBaseBranch,
}

/**
 * The checkouts Dispatch cuts worktrees from. Handella adopts a clone the
 * Handler already has rather than making one, so this asks for a path rather
 * than a remote URL.
 */
export function RepositorySettings() {
  const [draft, setDraft] = useState(emptyDraft)
  const queryClient = useQueryClient()

  const repositories = useQuery(repositoriesOptions)

  // Adding or removing one changes what Intake can offer as a base branch.
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: repositoryKeys.all }),
      queryClient.invalidateQueries({ queryKey: intakeKeys.baseBranchesAll }),
    ])
  }

  const add = useMutation({
    mutationFn: () => createRepository(draft),
    onSuccess: () => setDraft(emptyDraft),
    onSettled: refresh,
  })
  const remove = useMutation({
    mutationFn: (repositoryId: string) => deleteRepository(repositoryId),
    onSettled: refresh,
  })
  // A name is proposed from the folder only when the Handler has not written
  // one: the dialog answers the question it was opened for and no other.
  const choosePath = useMutation({
    mutationFn: chooseRepositoryPath,
    onSuccess: ({ path }) => {
      if (path === null) return
      setDraft((current) => ({
        ...current,
        name:
          current.name.trim() === ''
            ? (path.split('/').pop() ?? '')
            : current.name,
        path,
      }))
    },
  })

  const failure = add.error ?? remove.error ?? choosePath.error
  const incomplete = draft.name.trim() === '' || !draft.path.startsWith('/')

  return (
    <article className={`flex flex-col gap-4 ${cardClass}`}>
      <div className="flex flex-col gap-1">
        <h2 className="text-[16px] font-semibold">Repositories</h2>
        <p className="text-[13px] leading-[1.6] text-ink-3">
          Handella cuts each job&rsquo;s worktree from one of these. It never
          clones: point it at a checkout you already have, and your own git
          credentials reach the remote.
        </p>
      </div>

      {repositories.data === undefined ? null : repositories.data.length ===
        0 ? (
        <p className={emptyPanelClass}>
          No repository yet, so nothing can be dispatched.
        </p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {repositories.data.map((repository) => (
            <li
              className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3"
              key={repository.id}
            >
              <div className="flex min-w-0 flex-col gap-1">
                <p className="text-[14px] font-[550]">{repository.name}</p>
                <p className="break-all font-mono text-[12px] text-ink-4">
                  {repository.path}
                </p>
              </div>
              <span className="rounded-full bg-deep px-3 py-1 font-mono text-[11.5px] text-ink-3">
                base {repository.defaultBaseBranch}
              </span>
              <button
                className={`ml-auto ${secondaryButtonClass}`}
                disabled={remove.isPending}
                onClick={() => remove.mutate(repository.id)}
                type="button"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <form
        aria-label="Add a repository"
        className="flex flex-col gap-3 border-t border-line pt-4"
        onSubmit={(event) => {
          event.preventDefault()
          add.mutate()
        }}
      >
        <label className="flex flex-col gap-2">
          <span className={labelClass}>Name</span>
          <input
            className={pillFieldClass}
            onChange={(event) =>
              setDraft((current) => ({ ...current, name: event.target.value }))
            }
            placeholder="acme monorepo"
            value={draft.name}
          />
        </label>

        {/* The hint sits outside the label, so the field's accessible name stays
            the one word the Handler was given rather than the sentence with it. */}
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-2">
            <span className={labelClass}>Path</span>
            {/* The dialog is opened by the service, not the page: a browser is
                never told the absolute path of a folder someone picks. Typing
                still works, and is the whole story if the dialog fails. */}
            <div className="flex flex-wrap items-center gap-2">
              <input
                className={`${pillFieldClass} min-w-0 flex-1 font-mono`}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    path: event.target.value,
                  }))
                }
                placeholder="/Users/you/workspace/acme"
                value={draft.path}
              />
              <button
                className={secondaryButtonClass}
                disabled={choosePath.isPending}
                onClick={() => choosePath.mutate()}
                type="button"
              >
                {choosePath.isPending ? 'Choosing…' : 'Choose…'}
              </button>
            </div>
          </label>
          {/* Absolute because a worktree outlives the process that cut it.
              The submit button is disabled until it is one, so the rule is
              said out loud rather than left to be inferred from a button that
              does nothing. */}
          {draft.path !== '' && !draft.path.startsWith('/') ? (
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

        <label className="flex flex-col gap-2">
          <span className={labelClass}>Default base branch</span>
          <input
            className={`${pillFieldClass} font-mono`}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                defaultBaseBranch: event.target.value,
              }))
            }
            value={draft.defaultBaseBranch}
          />
        </label>

        <button
          className={`self-start ${primaryButtonClass}`}
          disabled={add.isPending || incomplete}
          type="submit"
        >
          Add repository
        </button>
      </form>

      {failure === null || failure === undefined ? null : (
        <p className="text-[13px] text-red-ink" role="alert">
          {failure.message}
        </p>
      )}
    </article>
  )
}
