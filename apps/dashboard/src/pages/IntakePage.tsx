import {
  defaultBaseBranch,
  type IntakeChoices,
  type IntakeIssue,
  type LinearIssueQuery,
} from '@handella/contracts'
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'

import { ApiRequestError } from '../api/client.ts'
import {
  createJobFromLinearIssue,
  fetchIntakeIssues,
  fetchLinearTeamWorkflowStates,
  fetchLinearTeams,
  intakeKeys,
} from '../api/intake.ts'
import { jobKeys } from '../api/jobs.ts'
import { fetchSystemStatus, statusKeys } from '../api/status.ts'
import { AdhocIssueForm } from '../components/AdhocIssueForm.tsx'
import { BaseBranchField } from '../components/BaseBranchField.tsx'
import { LinearIssueRow } from '../components/LinearIssueRow.tsx'
import { WorkClassField } from '../components/WorkClassField.tsx'
import { fieldClass, primaryButtonClass } from '../styles.ts'

type Outcome = { kind: 'created' } | { kind: 'failed'; message: string }

/**
 * A page of issues costs the local service one request per issue to resolve
 * Linear's lazy state, so the search waits for the Handler to stop typing
 * rather than asking on every keystroke.
 */
function useDebounced(value: string, delay = 300): string {
  const [settled, setSettled] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])

  return settled
}

function SetupNotice() {
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5">
      <h2 className="text-sm font-semibold">Linear is not configured</h2>
      <p className="text-sm text-muted">
        Intake needs a Linear personal API key. Add{' '}
        <code>HANDELLA_LINEAR_API_KEY</code> to <code>.env</code> in the
        repository root, then restart Handella.
      </p>
      <p className="text-sm text-muted">
        Everything else keeps working without it, including{' '}
        <Link className="underline" to="/jobs">
          the jobs you already have
        </Link>
        .
      </p>
    </section>
  )
}

export function IntakePage() {
  const [searchInput, setSearchInput] = useState('')
  const [teamId, setTeamId] = useState('')
  const [stateId, setStateId] = useState('')
  const [selections, setSelections] = useState<Record<string, IntakeChoices>>(
    {},
  )
  const queryClient = useQueryClient()

  const search = useDebounced(searchInput)
  const status = useQuery({
    queryKey: statusKeys.current,
    queryFn: fetchSystemStatus,
  })
  const configured = status.data?.integrations.linear.configured ?? false

  // Shared with the ad hoc form's query, which asks for the same teams under
  // the same key, so opening intake fetches them once.
  const teams = useQuery({
    queryKey: intakeKeys.teams,
    queryFn: fetchLinearTeams,
    enabled: configured,
  })

  // Workflow states belong to a team rather than to the workspace, and their
  // names repeat across teams, so there is no state to offer until the Handler
  // has said which team's workflow they mean.
  const states = useQuery({
    queryKey: intakeKeys.teamStates(teamId),
    queryFn: () => fetchLinearTeamWorkflowStates(teamId),
    enabled: configured && teamId !== '',
  })

  const query: LinearIssueQuery = {
    ...(search === '' ? {} : { search }),
    ...(teamId === '' ? {} : { teamId }),
    ...(stateId === '' ? {} : { stateId }),
  }

  /**
   * Linear pages its issues, so this one does too: the cursor the service
   * reported is what asks for the next page, and pages accumulate under the
   * key for these filters rather than replacing each other.
   */
  const issues = useInfiniteQuery({
    queryKey: intakeKeys.issues(query),
    queryFn: ({ pageParam }) =>
      fetchIntakeIssues({
        ...query,
        ...(pageParam === undefined ? {} : { cursor: pageParam }),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: configured,
  })

  // Whether an issue is free and what branch its next job would take are both
  // answered by the local service, beside the issue itself.
  const offers: IntakeIssue[] = useMemo(
    () => (issues.data?.pages ?? []).flatMap((page) => page.issues),
    [issues.data],
  )

  // One pass over the accumulated pages rather than a scan per selected row
  // per render: the base-branch inputs re-render this page on every keystroke.
  const identifiers = useMemo(
    () =>
      new Map(offers.map((offer) => [offer.issue.id, offer.issue.identifier])),
    [offers],
  )

  const toggle = (issueId: string) => {
    setSelections((current) => {
      if (issueId in current) {
        return Object.fromEntries(
          Object.entries(current).filter(([id]) => id !== issueId),
        )
      }
      return {
        ...current,
        [issueId]: { baseBranch: defaultBaseBranch, workClass: 'routine' },
      }
    })
  }

  const amend = (issueId: string, patch: Partial<IntakeChoices>) => {
    setSelections((current) => {
      const existing = current[issueId]
      if (existing === undefined) return current
      return { ...current, [issueId]: { ...existing, ...patch } }
    })
  }

  /**
   * One request per issue, so each job gets its own conflict and its own
   * outcome: a stale selection cannot discard the rest of the batch.
   */
  const create = useMutation({
    mutationFn: async () => {
      const entries = Object.entries(selections)
      const settled = await Promise.allSettled(
        entries.map(([issueId, selection]) =>
          createJobFromLinearIssue({
            issueId,
            baseBranch: selection.baseBranch,
            workClass: selection.workClass,
          }),
        ),
      )

      return Object.fromEntries(
        entries.map(([issueId], index): [string, Outcome] => {
          const result = settled[index]
          if (result?.status === 'fulfilled')
            return [issueId, { kind: 'created' }]
          return [
            issueId,
            {
              kind: 'failed',
              message:
                result?.reason instanceof ApiRequestError
                  ? result.reason.message
                  : 'That issue could not be taken.',
            },
          ]
        }),
      )
    },
    onSuccess: async (results) => {
      setSelections((current) =>
        Object.fromEntries(
          Object.entries(current).filter(
            ([issueId]) => results[issueId]?.kind !== 'created',
          ),
        ),
      )
      // Only what taking a job changes: the teams and workflow states under
      // `intakeKeys.all` are Linear's own and cannot have moved, and
      // refetching them costs a round trip to Linear per batch.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: jobKeys.all }),
        queryClient.invalidateQueries({ queryKey: intakeKeys.issuesAll }),
        queryClient.invalidateQueries({ queryKey: intakeKeys.baseBranches }),
      ])
    },
  })

  const selected = Object.entries(selections)
  const labelFor = (issueId: string): string =>
    identifiers.get(issueId) ?? issueId

  return (
    <section className="mx-auto flex max-w-4xl flex-col gap-6 px-5 py-10 sm:px-8">
      <h1 className="text-2xl font-semibold tracking-tight">Intake</h1>

      {status.isPending ? (
        <p aria-label="Loading intake" className="text-sm text-muted">
          Loading…
        </p>
      ) : !configured ? (
        <SetupNotice />
      ) : (
        <>
          <div className="flex flex-wrap gap-3">
            <label className="flex flex-1 flex-col gap-1 text-sm">
              Search
              <input
                className={fieldClass}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Title or description"
                value={searchInput}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Linear team
              <select
                className={fieldClass}
                onChange={(event) => {
                  // The chosen state belongs to the team it was chosen from, so
                  // it cannot outlive a change of team.
                  setTeamId(event.target.value)
                  setStateId('')
                }}
                value={teamId}
              >
                <option value="">All teams</option>
                {(teams.data ?? []).map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.key} · {team.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Linear state
              <select
                className={fieldClass}
                disabled={teamId === ''}
                onChange={(event) => setStateId(event.target.value)}
                value={stateId}
              >
                <option value="">
                  {teamId === '' ? 'Pick a team first' : 'Any actionable state'}
                </option>
                {(states.data ?? []).map((state) => (
                  <option key={state.id} value={state.id}>
                    {state.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {issues.isPending ? (
            <p aria-label="Loading issues" className="text-sm text-muted">
              Loading…
            </p>
          ) : issues.error !== null ? (
            <p className="text-sm text-danger" role="alert">
              {issues.error.message}
            </p>
          ) : offers.length === 0 ? (
            <p className="text-sm text-muted">
              No actionable issues are assigned to you.
            </p>
          ) : (
            <>
              <ul className="flex flex-col gap-3">
                {offers.map((offer) => {
                  const outcome = create.data?.[offer.issue.id]
                  return (
                    <li className="flex flex-col gap-1" key={offer.issue.id}>
                      <LinearIssueRow
                        offer={offer}
                        onToggle={() => toggle(offer.issue.id)}
                        selected={offer.issue.id in selections}
                      />
                      {outcome === undefined ? null : outcome.kind ===
                        'created' ? (
                        <p className="text-xs text-positive">Job created.</p>
                      ) : (
                        <p className="text-xs text-danger" role="alert">
                          {outcome.message}
                        </p>
                      )}
                    </li>
                  )
                })}
              </ul>

              {issues.hasNextPage ? (
                <button
                  className="self-start rounded-full border border-line px-4 py-2 text-sm font-medium disabled:opacity-50"
                  disabled={issues.isFetchingNextPage}
                  onClick={() => void issues.fetchNextPage()}
                  type="button"
                >
                  {issues.isFetchingNextPage ? 'Loading…' : 'Show more issues'}
                </button>
              ) : null}
            </>
          )}

          {selected.length === 0 ? null : (
            <form
              aria-label="Create jobs"
              className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-5"
              onSubmit={(event) => {
                event.preventDefault()
                create.mutate()
              }}
            >
              <h2 className="text-sm font-semibold">
                Classify each issue independently
              </h2>

              {selected.map(([issueId, selection]) => {
                const label = labelFor(issueId)
                return (
                  <div
                    className="flex flex-wrap items-end gap-3 border-t border-line pt-3 first:border-0 first:pt-0"
                    key={issueId}
                  >
                    <p className="w-full text-sm font-medium">{label}</p>
                    <WorkClassField
                      label={`Work class for ${label}`}
                      onChange={(workClass) => amend(issueId, { workClass })}
                      value={selection.workClass}
                    />
                    <BaseBranchField
                      label={`Base branch for ${label}`}
                      onChange={(baseBranch) => amend(issueId, { baseBranch })}
                      value={selection.baseBranch}
                    />
                  </div>
                )
              })}

              <button
                className={`self-start ${primaryButtonClass} disabled:opacity-50`}
                disabled={create.isPending}
                type="submit"
              >
                {selected.length === 1
                  ? 'Create job'
                  : `Create ${selected.length} jobs`}
              </button>
            </form>
          )}

          <div className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold">Ad hoc work</h2>
            <AdhocIssueForm />
          </div>
        </>
      )}
    </section>
  )
}
