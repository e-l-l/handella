import { type IntakeIssue, type LinearIssueQuery } from '@handella/contracts'
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'

import { messageOf } from '../api/client.ts'
import {
  createJobFromLinearIssue,
  intakeKeys,
  issuesOptions,
  teamStatesOptions,
  teamsOptions,
} from '../api/intake.ts'
import { dispatchOrReason, jobKeys } from '../api/jobs.ts'
import { repositoriesOptions } from '../api/repositories.ts'
import { fetchSystemStatus, statusKeys } from '../api/status.ts'
import { AdhocIssueForm } from '../components/AdhocIssueForm.tsx'
import { BaseBranchField } from '../components/BaseBranchField.tsx'
import { LinearIssueRow } from '../components/LinearIssueRow.tsx'
import { NumberedStep } from '../components/NumberedStep.tsx'
import { SearchField } from '../components/SearchField.tsx'
import { ServiceUnreachable } from '../components/ServiceUnreachable.tsx'
import { Skeleton, SkeletonList } from '../components/Skeleton.tsx'
import { Dot } from '../components/Tag.tsx'
import { WorkClassField } from '../components/WorkClassField.tsx'
import { useJobs } from '../hooks/useJobs.ts'
import { availableSlots } from '../jobViews.ts'
import { formatAgo } from '../labels.ts'
import { type IssueChoices, useIntakeState } from '../state/intake.ts'
import {
  amberBannerClass,
  cardClass,
  cardTitleClass,
  emptyPanelClass,
  helperClass,
  metaClass,
  pageTitleClass,
  primaryBlockButtonClass,
  quietButtonClass,
  selectClass,
  wideRailGridClass,
} from '../styles.ts'

/**
 * What became of one selected issue. Four rather than two, because Intake now
 * runs Dispatch after itself and the two halves fail separately: a Job whose
 * Dispatch was refused still exists, still holds its issue, and is one button
 * away from the queue on the jobs list.
 */
type Outcome =
  | { kind: 'created' }
  | { kind: 'dispatched' }
  | { kind: 'failed'; message: string }
  | { kind: 'undispatched'; message: string }

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

/**
 * How stale the list the Handler is reading actually is.
 *
 * It is kept for two minutes rather than revalidated on sight, because one
 * refresh costs the local service a round trip to Linear per issue — so the
 * age is worth saying out loud beside the button that pays for a fresh one.
 */
const syncedAt = (updatedAt: number): string =>
  updatedAt === 0
    ? ''
    : ` · synced ${formatAgo(new Date(updatedAt).toISOString())}`

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
 * What happened to one issue in the last submission, under the row it was
 * picked from. A job that was created but not dispatched is neither of the
 * other two: it is amber because there is something left to do, and it says
 * where that is, because the Selection no longer holds the issue.
 */
function IssueOutcome({ outcome }: { outcome: Outcome }) {
  if (outcome.kind === 'dispatched') {
    return (
      <p className="pl-4 text-[12px] text-mint-soft">Job created and queued.</p>
    )
  }

  if (outcome.kind === 'created') {
    return (
      <p className="pl-4 text-[12px] text-mint-soft">
        Job created, waiting in intake.
      </p>
    )
  }

  if (outcome.kind === 'undispatched') {
    return (
      <p className="pl-4 text-[12px] text-amber-ink" role="alert">
        Job created, but it could not be dispatched: {outcome.message} Dispatch
        it again from{' '}
        <Link className="underline underline-offset-2" to="/jobs">
          the jobs list
        </Link>
        .
      </p>
    )
  }

  return (
    <p className="pl-4 text-[12px] text-red-ink" role="alert">
      {outcome.message}
    </p>
  )
}

/**
 * One selected issue's decisions, as the handoff's steps 2 and 3.
 *
 * The handoff draws a single selected issue and one set of choices; Handella
 * allows several, and each is classified, branched and created independently,
 * so the panel repeats these two steps per issue under the key they belong to
 * rather than merging them into one. Step 1 is the repository, which is chosen
 * once for the whole panel.
 */
function IntakeCard({
  choices,
  first,
  offer,
  onChange,
  onRemove,
  repositoryId,
}: {
  choices: IssueChoices
  /** The topmost card needs no rule above it; the ones after it do. */
  first: boolean
  offer: IntakeIssue | undefined
  onChange: (patch: Partial<IssueChoices>) => void
  onRemove: () => void
  repositoryId: string
}) {
  const label = offer?.issue.identifier ?? 'this issue'
  const blocked = blockedReason(offer)

  return (
    <div className="flex flex-col gap-5">
      <div
        className={`flex items-start justify-between gap-3 ${first ? '' : 'border-t border-line pt-4'}`}
      >
        <div className="flex min-w-0 flex-col gap-1">
          <p className={metaClass}>{label}</p>
          <p className="truncate text-[13px] text-ink-2">
            {offer?.issue.title ?? 'Selected issue'}
          </p>
        </div>
        {/* Always offered, including for a single selection. The Selection
            outlives the list it was made from, so the row that would untick
            this issue may not be on the screen at all — and when it is not,
            this is the only way out that does not go through restoring the
            filters the issue was picked under. */}
        <button
          aria-label={`Remove ${label} from the Selection`}
          className={`-my-1 flex-none ${quietButtonClass}`}
          onClick={onRemove}
          type="button"
        >
          Remove
        </button>
      </div>

      {/* The step numbers repeat per issue rather than counting up across the
          panel: each selected issue is classified, branched and created on its
          own, so what they number is the decisions for one job. */}
      <NumberedStep label="Work class" step={2}>
        <WorkClassField
          label={`Work class for ${label}`}
          labelHidden
          onChange={(workClass) => onChange({ workClass })}
          value={choices.workClass}
        />
      </NumberedStep>

      <NumberedStep label="Base branch" step={3}>
        <BaseBranchField
          label={`Base branch for ${label}`}
          labelHidden
          onChange={(baseBranch) => onChange({ baseBranch })}
          repositoryId={repositoryId}
          value={choices.baseBranch}
        />
      </NumberedStep>

      {/* Read-only on purpose: Linear owns this name, and a job that cannot be
          given one can never be dispatched. Shown as a card rather than as a
          field because there is nothing here to fill in. */}
      <div className="flex flex-col gap-2 rounded-xl border border-line bg-deep p-3.5">
        {blocked === null ? (
          <p className="flex items-center gap-2 text-[12.5px] text-ink-2">
            <Dot className="size-1.5" tone="mint" />
            {offer !== undefined && offer.round > 1
              ? 'Worked before — this job takes its own numbered branch'
              : 'Branch is unclaimed — worktree cut at dispatch'}
          </p>
        ) : (
          <p className={amberBannerClass} role="alert">
            {blocked}
          </p>
        )}
        <p className="break-all font-mono text-[11.5px] leading-[1.5] text-ink-3">
          {offer?.plannedBranch ?? 'No branch name'}
        </p>
      </div>
    </div>
  )
}

export function IntakePage() {
  // Held above the router, so a trip to another screen no longer discards the
  // Selection or resets the filters under the query key.
  const {
    amend,
    clear,
    drop,
    filters: { repositoryId, searchInput, stateId, teamId },
    select,
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
  // Only to say whether a dispatch will start planning now or wait, which is
  // the footer's consequence line.
  const jobs = useJobs()

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
   * Where the last plain click landed, so a shift-click has something to
   * extend from. A ref rather than state: nothing on the screen draws the
   * anchor, and re-rendering the list to remember it would be a render per
   * click for no visible change.
   */
  const anchor = useRef<string | null>(null)

  const pick = (issueId: string, extend: boolean) => {
    const eligible = offers.filter((offer) => offer.heldByJobId === null)
    const from = eligible.findIndex(
      (offer) => offer.issue.id === anchor.current,
    )
    const to = eligible.findIndex((offer) => offer.issue.id === issueId)

    if (extend && from !== -1 && to !== -1) {
      const [start, end] = from < to ? [from, to] : [to, from]
      // Adds rather than toggles: extending over issues the Handler already
      // picked should not un-pick them, and should not discard the work class
      // they set on them either.
      select(eligible.slice(start, end + 1).map((offer) => offer.issue.id))
      return
    }

    anchor.current = issueId
    toggle(issueId)
  }

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
   *
   * `dispatch` is the usual answer. A job left in `intake` is a job the
   * scheduler cannot see, and the Handler who just picked the work has already
   * said they want it done — so Dispatch runs here, per issue, rather than
   * waiting to be asked again from the job page.
   */
  const create = useMutation({
    mutationFn: async (dispatch: boolean) => {
      const results = await Promise.all(
        Object.entries(selections).map(
          async ([issueId, selection]): Promise<[string, Outcome]> => {
            try {
              const job = await createJobFromLinearIssue({
                issueId,
                repositoryId: chosenRepositoryId,
                baseBranch: selection.baseBranch,
                workClass: selection.workClass,
              })

              if (!dispatch) return [issueId, { kind: 'created' }]

              // Answered rather than thrown: the Job record has committed, so
              // this issue is taken whatever happened next, and a rejection
              // here would report it as one that was never taken at all.
              const refused = await dispatchOrReason(job.id)
              return [
                issueId,
                refused === null
                  ? { kind: 'dispatched' }
                  : { kind: 'undispatched', message: refused },
              ]
            } catch (error) {
              return [
                issueId,
                {
                  kind: 'failed',
                  message: messageOf(error, 'That issue could not be taken.'),
                },
              ]
            }
          },
        ),
      )

      return Object.fromEntries(results)
    },
    onSuccess: async (results) => {
      // Everything but an outright failure made a Job, and a Job holds its
      // issue: one whose Dispatch was refused leaves the Selection too, or the
      // next submission would be refused for an issue it already took.
      drop(
        Object.entries(results)
          .filter(([, outcome]) => outcome.kind !== 'failed')
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
  // Both buttons submit the same Selection, so they are refused together.
  const cannotSubmit = create.isPending || blocked || chosenRepositoryId === ''
  const freeSlots = jobs.data === undefined ? null : availableSlots(jobs.data)

  if (status.isPending) {
    return (
      <section
        aria-label="Loading intake"
        className="px-6 pb-[34px] pt-[26px]"
        role="status"
      >
        <Skeleton className="h-40 rounded-2xl" />
      </section>
    )
  }

  if (status.isError) {
    return (
      <section className="flex flex-col gap-6 px-6 pb-[34px] pt-[26px]">
        <h1 className={pageTitleClass}>Intake</h1>
        <ServiceUnreachable
          // Told apart from a status read that says Linear is unconfigured:
          // they look identical from here otherwise, and a Handler who has set
          // a key would read the setup notice as a lie about their own .env.
          heading="Handella could not reach the local service, so it cannot say whether Linear is set up."
          message={status.error.message}
          onRetry={() => void status.refetch()}
          retrying={status.isFetching}
        />
      </section>
    )
  }

  if (!configured) {
    return (
      <section className="flex flex-col gap-6 px-6 pb-[34px] pt-[26px]">
        <h1 className={pageTitleClass}>Intake</h1>
        <SetupNotice />
      </section>
    )
  }

  return (
    <div className={wideRailGridClass}>
      <section className="flex min-w-0 flex-col gap-4 px-6 pb-[30px] pt-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className={pageTitleClass}>Assigned to you</h1>
          <p className={metaClass}>
            {offers.length} actionable issue{offers.length === 1 ? '' : 's'}
          </p>
          {/* The list is kept for two minutes rather than revalidated on
              sight, because one refresh of it costs the local service a round
              trip to Linear per issue. This is how the Handler asks for one
              anyway, and it says how stale what they are reading is. */}
          <button
            className={`ml-auto ${quietButtonClass}`}
            disabled={issues.isFetching}
            onClick={refresh}
            type="button"
          >
            {issues.isFetching
              ? 'Refreshing…'
              : `Refresh${syncedAt(issues.dataUpdatedAt)}`}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="min-w-[240px] flex-1">
            <SearchField
              label="Search issues"
              onChange={setSearchInput}
              placeholder="Search title, label, project…"
              value={searchInput}
            />
          </div>

          <label>
            <span className="sr-only">Linear team</span>
            <select
              className={selectClass}
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
              className={selectClass}
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

        {/* New in the revamp. The Selection outlives the filters it was made
            under, so how many issues are picked used to be readable only from
            the rail — and the rail is a screen's height away once the list is
            twenty issues long. */}
        {selected.length === 0 ? null : (
          <div className="flex flex-wrap items-center gap-3 rounded-[10px] border border-mint/[0.22] bg-mint/[0.08] px-3.5 py-2.5">
            <span
              aria-hidden="true"
              className="grid size-[17px] flex-none place-items-center rounded-[5px] bg-mint font-mono text-[11px] font-bold text-on-mint"
            >
              ✓
            </span>
            <p className="text-[13px] text-ink-2">
              {selected.length} issue{selected.length === 1 ? '' : 's'} selected
            </p>
            <button className={quietButtonClass} onClick={clear} type="button">
              Clear
            </button>
            <p className="ml-auto text-[12.5px] text-ink-4">
              Select more to dispatch them as separate jobs.
            </p>
          </div>
        )}

        {issues.isPending ? (
          <SkeletonList
            className="h-[62px] rounded-xl"
            count={5}
            label="Loading issues"
            wrapperClassName="flex flex-col gap-2"
          />
        ) : issues.error !== null ? (
          <p className="text-[13px] text-red-ink" role="alert">
            {issues.error.message}
          </p>
        ) : offers.length === 0 ? (
          <p className={emptyPanelClass}>
            No actionable issues are assigned to you. Write your own below, or
            widen the team and state filters above.
          </p>
        ) : (
          <>
            <ul
              aria-label="Assigned and actionable issues"
              className="flex flex-col gap-2"
            >
              {offers.map((offer) => {
                const outcome = create.data?.[offer.issue.id]
                return (
                  <li className="flex flex-col gap-1.5" key={offer.issue.id}>
                    <LinearIssueRow
                      offer={offer}
                      onToggle={(extend) => pick(offer.issue.id, extend)}
                      selected={offer.issue.id in selections}
                    />
                    {outcome === undefined ? null : (
                      <IssueOutcome outcome={outcome} />
                    )}
                  </li>
                )
              })}
            </ul>

            {issues.hasNextPage ? (
              <button
                className={`self-start ${quietButtonClass}`}
                disabled={issues.isFetchingNextPage}
                onClick={() => void issues.fetchNextPage()}
                type="button"
              >
                {issues.isFetchingNextPage ? 'Loading…' : 'Show more issues'}
              </button>
            ) : null}
          </>
        )}

        {/* Behind a disclosure rather than a permanently open form at the foot
            of the list. The handoff's Intake is a list and a panel; ad hoc work
            is a real Source in CONTEXT.md and cannot be dropped, but it is the
            rare path and a second open form was competing with the list. */}
        <details className="mt-4 rounded-xl border border-line bg-raised px-4 py-3">
          <summary className="cursor-pointer text-[13.5px] font-[550]">
            Write your own issue
          </summary>
          <p className={`mt-1.5 ${helperClass}`}>
            For work that is not in Linear yet. Handella creates the issue, then
            takes it as a job.
          </p>
          <div className="mt-3.5">
            <AdhocIssueForm repositoryId={chosenRepositoryId} />
          </div>
        </details>
      </section>

      {/* Its own scroll, pinned under the 64px header, and a column flex so the
          footer sits at the bottom of it: the issue list is as long as Linear
          makes it, and a rail that stretched to match it put the submit button
          a thousand pixels below the card it submits. Only from 1200px, which
          is where the rail exists at all — below that it is a section stacked
          under the list, and the footer is what stays pinned. */}
      <aside className="flex flex-col border-line-nav bg-deep min-[1200px]:sticky min-[1200px]:top-16 min-[1200px]:max-h-[calc(100svh-4rem)] min-[1200px]:self-start min-[1200px]:overflow-y-auto min-[1200px]:border-l">
        <div className="flex flex-1 flex-col gap-5 px-6 pb-5 pt-6">
          <div className="flex flex-col gap-1.5">
            <h2 className="text-[17px] font-semibold">Dispatch</h2>
            <p className={helperClass}>
              {/* The card below names the issue, so this counts the jobs
                  rather than repeating the key. */}
              {selected.length === 0
                ? 'Pick an issue on the left to classify it and give it a base branch.'
                : selected.length === 1
                  ? 'One job will be created.'
                  : `${selected.length} issues · one job will be created for each.`}
            </p>
          </div>

          {/* Chosen once for the panel rather than per issue: a base branch
              means nothing without the checkout it is on, and V1 manages one
              primary repository. */}
          {repositories.isPending ? (
            <Skeleton className="h-[42px] rounded-[10px]" />
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
            <NumberedStep label="Repository" step={1}>
              {/* Named by `aria-label` rather than a visible label: the step's
                  own heading is already the word, and a second copy of it
                  would be read out twice. */}
              <select
                aria-label="Repository"
                className={`w-full ${selectClass}`}
                onChange={(event) => setRepositoryId(event.target.value)}
                value={chosenRepositoryId}
              >
                {(repositories.data ?? []).map((repository) => (
                  <option key={repository.id} value={repository.id}>
                    {repository.name}
                  </option>
                ))}
              </select>
            </NumberedStep>
          )}

          {selected.length === 0 ? (
            <p className={emptyPanelClass}>
              Nothing selected yet. The work class and base branch appear here
              once you tick an issue.
            </p>
          ) : (
            <form
              aria-label="Create jobs"
              className="flex flex-col gap-5"
              id="dispatch-form"
              onSubmit={(event) => {
                event.preventDefault()
                create.mutate(true)
              }}
            >
              {selected.map(([issueId, choices], index) => (
                <IntakeCard
                  choices={choices}
                  first={index === 0}
                  key={issueId}
                  offer={byIssueId.get(issueId)}
                  onChange={(patch) => amend(issueId, patch)}
                  onRemove={() => toggle(issueId)}
                  repositoryId={chosenRepositoryId}
                />
              ))}
            </form>
          )}
        </div>

        {/* Pinned to the bottom of the rail, and to the viewport below 1200px.
            The two equal-looking buttons at the end of a long scroll are gone:
            one primary, one quiet, and a line saying what pressing the primary
            will actually do. */}
        {selected.length === 0 ? null : (
          <div className="sticky bottom-0 flex flex-col gap-2.5 border-t border-line bg-chrome px-6 pb-[22px] pt-[18px]">
            <button
              className={primaryBlockButtonClass}
              disabled={cannotSubmit}
              form="dispatch-form"
              type="submit"
            >
              {create.isPending
                ? 'Dispatching…'
                : selected.length === 1
                  ? 'Dispatch job now'
                  : `Dispatch ${selected.length} jobs now`}
            </button>
            {/* For work that is being taken now and started later: the job
                exists, holds its issue, and claims no branch until the Handler
                dispatches it from the jobs list. */}
            <button
              className={`self-center ${quietButtonClass}`}
              disabled={cannotSubmit}
              onClick={() => create.mutate(false)}
              type="button"
            >
              Create without dispatching
            </button>
            <p className="text-center text-[11.5px] leading-[1.5] text-ink-5">
              {freeSlots === null
                ? 'Each issue is classified, branched, created and dispatched on its own.'
                : freeSlots >= selected.length
                  ? 'A slot is free, so this starts planning right away.'
                  : freeSlots === 0
                    ? 'Every slot is busy, so this waits in the queue.'
                    : `${freeSlots} of these start planning right away; the rest wait in the queue.`}
            </p>
          </div>
        )}
      </aside>
    </div>
  )
}
