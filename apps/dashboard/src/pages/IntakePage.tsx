import { type IntakeIssue, type LinearIssueQuery } from '@handella/contracts'
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
  intakeKeys,
  issuesOptions,
  teamStatesOptions,
  teamsOptions,
} from '../api/intake.ts'
import { jobKeys } from '../api/jobs.ts'
import { repositoriesOptions } from '../api/repositories.ts'
import { fetchSystemStatus, statusKeys } from '../api/status.ts'
import { AdhocIssueForm } from '../components/AdhocIssueForm.tsx'
import { BaseBranchField } from '../components/BaseBranchField.tsx'
import { Dot } from '../components/Chip.tsx'
import { LinearIssueRow } from '../components/LinearIssueRow.tsx'
import { Skeleton, SkeletonList } from '../components/Skeleton.tsx'
import { WorkClassField } from '../components/WorkClassField.tsx'
import { linearPriorityLabels } from '../labels.ts'
import { type IssueChoices, useIntakeState } from '../state/intake.ts'
import {
  amberBannerClass,
  cardClass,
  cardTitleClass,
  emptyPanelClass,
  labelClass,
  pillFieldClass,
  primaryButtonClass,
  screenClass,
  secondaryButtonClass,
  sectionTitleClass,
  softCardClass,
  wideRailGridClass,
} from '../styles.ts'

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

function SearchIcon() {
  return (
    <svg
      aria-hidden="true"
      className="size-3.75 flex-none text-ink-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" strokeLinecap="round" />
    </svg>
  )
}

function SetupNotice() {
  return (
    <section className={`flex flex-col gap-3 ${cardClass}`}>
      <h2 className={cardTitleClass}>Linear is not configured</h2>
      <p className="text-[13px] leading-[1.6] text-ink-3">
        Intake needs a Linear personal API key. Add{' '}
        <code className="font-mono text-mint-soft">
          HANDELLA_LINEAR_API_KEY
        </code>{' '}
        to <code className="font-mono text-mint-soft">.env</code> in the
        repository root, then restart Handella.
      </p>
      <p className="text-[13px] leading-[1.6] text-ink-3">
        Everything else keeps working without it, including{' '}
        <Link className="text-mint-soft underline" to="/jobs">
          the jobs you already have
        </Link>
        .
      </p>
    </section>
  )
}

/**
 * Why a selected issue cannot become a job, or null when it can. Linear owns
 * the canonical branch name and a Job cannot be dispatched without one (ADR
 * 0004), so an issue Handella can no longer name a branch for is refused here
 * rather than at the request.
 */
const blockedReason = (offer: IntakeIssue | undefined): string | null => {
  if (offer === undefined)
    return 'Linear has not named a branch for this issue in the current list, so Handella cannot claim one. Restore the filters it was selected under, or remove it.'
  if (offer.heldByJobId !== null)
    return 'A live job already holds this issue, and its canonical branch with it.'
  return null
}

/**
 * One selected issue's intake decisions. The handoff draws a single selected
 * issue; Handella allows several, and each is classified, branched and created
 * independently, so the panel repeats this card rather than merging them.
 */
function IntakeCard({
  choices,
  offer,
  onChange,
  onRemove,
  repositoryId,
}: {
  choices: IssueChoices
  offer: IntakeIssue | undefined
  onChange: (patch: Partial<IssueChoices>) => void
  onRemove: () => void
  repositoryId: string
}) {
  const label = offer?.issue.identifier ?? 'this issue'
  const blocked = blockedReason(offer)

  return (
    <div className="flex flex-col gap-4">
      <div className={`flex flex-col gap-2 ${softCardClass}`}>
        <div className="flex items-start justify-between gap-3">
          <p className="font-mono text-[11.5px] text-ink-5">{label}</p>
          {/* The Selection outlives the list it was made from, so the row that
              would untick this issue may not be on the screen at all. This is
              the way out that does not go through restoring the filters. */}
          <button
            aria-label={`Remove ${label} from the Selection`}
            className="-my-1 flex-none rounded-full px-2 py-1 text-[12px] text-ink-5 hover:bg-raised-alt hover:text-ink-2"
            onClick={onRemove}
            type="button"
          >
            Remove
          </button>
        </div>
        <p className="text-[15px] font-[550] leading-[1.4]">
          {offer?.issue.title ?? 'Selected issue'}
        </p>
        {offer === undefined ? null : (
          <p className="text-[12.5px] text-ink-4">
            {offer.issue.stateName} ·{' '}
            {linearPriorityLabels[offer.issue.priority]}
          </p>
        )}
      </div>

      <WorkClassField
        label={`Work class for ${label}`}
        onChange={(workClass) => onChange({ workClass })}
        value={choices.workClass}
      />

      <BaseBranchField
        label={`Base branch for ${label}`}
        onChange={(baseBranch) => onChange({ baseBranch })}
        repositoryId={repositoryId}
        value={choices.baseBranch}
      />

      <div className="flex flex-col gap-2">
        <p className="text-[13px] font-medium text-ink-2">
          Canonical branch from Linear
        </p>
        {/* Read-only on purpose: Linear owns this name, and a job that cannot
            be given one can never be dispatched. */}
        <p
          className={`rounded-2xl border border-dashed bg-surface px-4 py-3 font-mono text-[12.5px] ${
            blocked === null
              ? 'border-line-dashed text-mint-soft'
              : 'border-amber/20 text-amber-ink'
          }`}
        >
          {offer?.plannedBranch ?? 'No branch name'}
        </p>
        {blocked !== null ? (
          // The handoff's blocked state: the reason sits in this field's
          // helper line, beside the name it is about.
          <p className={amberBannerClass} role="alert">
            {blocked}
          </p>
        ) : (
          <p className="flex items-center gap-2 text-[12px] text-ink-4">
            <Dot className="size-1.5" tone="mint" />
            {offer !== undefined && offer.round > 1
              ? 'Worked before, so this job takes its own numbered branch.'
              : 'Unclaimed. The worktree is cut from it at dispatch.'}
          </p>
        )}
      </div>
    </div>
  )
}

export function IntakePage() {
  // Held above the router, so a trip to another screen no longer discards the
  // Selection or resets the filters under the query key.
  const {
    amend,
    drop,
    filters: { repositoryId, searchInput, stateId, teamId },
    selections,
    setRepositoryId,
    setSearchInput,
    setStateId,
    setTeamId,
    toggle,
  } = useIntakeState()
  const queryClient = useQueryClient()

  const search = useDebounced(searchInput)
  const status = useQuery({
    queryKey: statusKeys.current,
    queryFn: fetchSystemStatus,
  })
  const configured = status.data?.integrations.linear.configured ?? false

  // Local, so it answers whether or not Linear is set up.
  const repositories = useQuery(repositoriesOptions)

  // The first repository is the primary one until the Handler says otherwise.
  // Resolved on read rather than in an effect, so the first render already has
  // a value and nothing submits an empty id.
  const chosenRepositoryId =
    repositoryId !== '' ? repositoryId : (repositories.data?.[0]?.id ?? '')

  // Shared with the ad hoc form's query, which asks for the same teams under
  // the same key, so opening intake fetches them once.
  const teams = useQuery({ ...teamsOptions, enabled: configured })

  // Workflow states belong to a team rather than to the workspace, and their
  // names repeat across teams, so there is no state to offer until the Handler
  // has said which team's workflow they mean.
  const states = useQuery({
    ...teamStatesOptions(teamId),
    enabled: configured && teamId !== '',
  })

  const query: LinearIssueQuery = {
    ...(search === '' ? {} : { search }),
    ...(teamId === '' ? {} : { teamId }),
    ...(stateId === '' ? {} : { stateId }),
  }

  const issues = useInfiniteQuery({
    ...issuesOptions(query),
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
  const byIssueId = useMemo(
    () => new Map(offers.map((offer) => [offer.issue.id, offer])),
    [offers],
  )

  /**
   * Back to a first page rather than a refetch of every page loaded so far:
   * `refetch` on an infinite query asks for all of them, and each one costs
   * the local service a round trip to Linear per issue. The teams and their
   * workflow states are Linear's own configuration and cached for far longer
   * than the list, so this is also the moment to read them again — it is the
   * only one the Handler has to ask with.
   */
  const refresh = () => {
    void queryClient.resetQueries({ queryKey: intakeKeys.issues(query) })
    void queryClient.invalidateQueries({ queryKey: intakeKeys.teams })
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
            repositoryId: chosenRepositoryId,
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
      drop(
        Object.entries(results)
          .filter(([, outcome]) => outcome.kind === 'created')
          .map(([issueId]) => issueId),
      )
      // Only what taking a job changes: the teams and workflow states under
      // `intakeKeys.all` are Linear's own and cannot have moved, and
      // refetching them costs a round trip to Linear per batch.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: jobKeys.all }),
        queryClient.invalidateQueries({ queryKey: intakeKeys.issuesAll }),
        queryClient.invalidateQueries({ queryKey: intakeKeys.baseBranchesAll }),
      ])
    },
  })

  const selected = Object.entries(selections)
  // One blocked selection blocks the batch: every job in it is created from
  // the same submission, and a job without a canonical branch is one Handella
  // could never dispatch.
  const blocked = selected.some(
    ([issueId]) => blockedReason(byIssueId.get(issueId)) !== null,
  )

  if (status.isPending) {
    return (
      <section
        aria-label="Loading intake"
        className={screenClass}
        role="status"
      >
        <Skeleton className="h-40 rounded-[22px]" />
      </section>
    )
  }

  if (!configured) {
    return (
      <section className={`flex flex-col gap-6 ${screenClass}`}>
        <h1 className={sectionTitleClass}>Intake</h1>
        <SetupNotice />
      </section>
    )
  }

  return (
    <div className={wideRailGridClass}>
      <section className="flex flex-col px-7 pb-8 pt-[26px]">
        <div className="mb-4 flex flex-wrap items-center gap-3.5">
          <h1 className={sectionTitleClass}>Assigned &amp; actionable</h1>
          <p className="font-mono text-[11.5px] text-ink-5">
            {offers.length} issue{offers.length === 1 ? '' : 's'} ·{' '}
            {selected.length} selected
          </p>
        </div>

        <div className="mb-[18px] flex flex-wrap items-center gap-2.5">
          <label className="flex min-w-[240px] flex-1 items-center gap-2.5 rounded-full border border-line-strong bg-raised px-4 py-3">
            <span className="sr-only">Search</span>
            <SearchIcon />
            <input
              className="w-full bg-transparent text-[13.5px] text-ink outline-none placeholder:text-ink-4"
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search title, label, project…"
              value={searchInput}
            />
          </label>

          <label>
            <span className="sr-only">Linear team</span>
            <select
              className={pillFieldClass}
              onChange={(event) => setTeamId(event.target.value)}
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

          <label>
            <span className="sr-only">Linear state</span>
            <select
              className={pillFieldClass}
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

          {/* The list is kept for two minutes rather than revalidated on sight,
              because one refresh of it costs the local service a round trip to
              Linear per issue. This is how the Handler asks for one anyway. */}
          <button
            className={`${secondaryButtonClass} ml-auto`}
            disabled={issues.isFetching}
            onClick={refresh}
            type="button"
          >
            {issues.isFetching ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>

        {issues.isPending ? (
          <SkeletonList
            className="h-[70px] rounded-[18px]"
            count={4}
            label="Loading issues"
            wrapperClassName="flex flex-col gap-[9px]"
          />
        ) : issues.error !== null ? (
          <p className="text-[13px] text-red-ink" role="alert">
            {issues.error.message}
          </p>
        ) : offers.length === 0 ? (
          <p className={emptyPanelClass}>
            No actionable issues are assigned to you.
          </p>
        ) : (
          <>
            <ul
              aria-label="Assigned and actionable issues"
              className="flex flex-col gap-[9px]"
            >
              {offers.map((offer) => {
                const outcome = create.data?.[offer.issue.id]
                return (
                  <li className="flex flex-col gap-1.5" key={offer.issue.id}>
                    <LinearIssueRow
                      offer={offer}
                      onToggle={() => toggle(offer.issue.id)}
                      selected={offer.issue.id in selections}
                    />
                    {outcome === undefined ? null : outcome.kind ===
                      'created' ? (
                      <p className="pl-[18px] text-[12px] text-mint-soft">
                        Job created.
                      </p>
                    ) : (
                      <p
                        className="pl-[18px] text-[12px] text-red-ink"
                        role="alert"
                      >
                        {outcome.message}
                      </p>
                    )}
                  </li>
                )
              })}
            </ul>

            {issues.hasNextPage ? (
              <button
                className={`mt-4 self-start ${secondaryButtonClass}`}
                disabled={issues.isFetchingNextPage}
                onClick={() => void issues.fetchNextPage()}
                type="button"
              >
                {issues.isFetchingNextPage ? 'Loading…' : 'Show more issues'}
              </button>
            ) : null}
          </>
        )}

        <div className="mt-8 flex flex-col gap-3.5">
          <h2 className="text-[16px] font-semibold">Ad hoc work</h2>
          <AdhocIssueForm repositoryId={chosenRepositoryId} />
        </div>
      </section>

      {/* Its own scroll, pinned under the 70px header: the issue list is as
          long as Linear makes it, and a rail that stretched to match it put
          the submit button a thousand pixels below the card it submits. Only
          from 1200px, which is where the rail exists at all — below that it is
          a section stacked under the list and scrolls with the page. */}
      <aside className="flex flex-col gap-[18px] border-line bg-deep px-[26px] pb-8 pt-[26px] min-[1200px]:sticky min-[1200px]:top-[70px] min-[1200px]:max-h-[calc(100svh-70px)] min-[1200px]:self-start min-[1200px]:overflow-y-auto min-[1200px]:border-l">
        {/* Intake, not Dispatch: this panel commits the Job record and nothing
            else. Claiming the branch, cutting the worktree and taking a queue
            position are Dispatch's, and happen from the job page. */}
        <h2 className="text-[16px] font-semibold">Intake</h2>

        {/* Chosen once for the panel rather than per issue: a base branch means
            nothing without the checkout it is on, and V1 manages one primary
            repository. */}
        {repositories.isPending ? (
          <Skeleton className="h-[42px] rounded-full" />
        ) : repositories.error !== null ? (
          <p className="text-[13px] text-red-ink" role="alert">
            {repositories.error.message}
          </p>
        ) : (repositories.data ?? []).length === 0 ? (
          <p className={amberBannerClass} role="alert">
            No repository is configured, so nothing can be taken on yet.{' '}
            {/* The only way out of this state, so it is marked as one. */}
            <Link
              className="font-medium underline underline-offset-2"
              to="/system"
            >
              Add one in System
            </Link>
            .
          </p>
        ) : (
          <label className="flex flex-col gap-2">
            <span className={labelClass}>Repository</span>
            <select
              className={pillFieldClass}
              onChange={(event) => setRepositoryId(event.target.value)}
              value={chosenRepositoryId}
            >
              {(repositories.data ?? []).map((repository) => (
                <option key={repository.id} value={repository.id}>
                  {repository.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {selected.length === 0 ? (
          <p className={emptyPanelClass}>
            Pick an issue to classify it and give it a base branch.
          </p>
        ) : (
          <form
            aria-label="Create jobs"
            className="flex flex-col gap-6"
            onSubmit={(event) => {
              event.preventDefault()
              create.mutate()
            }}
          >
            {selected.map(([issueId, choices]) => (
              <IntakeCard
                choices={choices}
                key={issueId}
                offer={byIssueId.get(issueId)}
                onChange={(patch) => amend(issueId, patch)}
                onRemove={() => toggle(issueId)}
                repositoryId={chosenRepositoryId}
              />
            ))}

            <div className="flex flex-col gap-2.5">
              <button
                className={`w-full ${primaryButtonClass} py-3.5 text-[14px]`}
                disabled={
                  create.isPending || blocked || chosenRepositoryId === ''
                }
                type="submit"
              >
                {selected.length === 1
                  ? 'Create job'
                  : `Create ${selected.length} jobs`}
              </button>
              <p className="text-center text-[12px] text-ink-5">
                Each issue is classified, branched and created on its own.
              </p>
            </div>
          </form>
        )}
      </aside>
    </div>
  )
}
