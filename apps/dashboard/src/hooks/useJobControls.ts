import {
  isAwaitingMerge,
  isSettledJobState,
  isTerminalJobState,
  legalTransitionsFrom,
  type Job,
} from '@handella/contracts'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'

import {
  approveJob,
  checkJobMerge,
  dispatchJob,
  openJobTerminal,
  resumeJob,
  suspendJob,
  transitionJob,
  useJobRefresh,
} from '../api/jobs.ts'
import type { OverflowItem } from '../components/OverflowMenu.tsx'
import {
  actionLabels,
  jobAction,
  type JobActionKind,
} from '../jobPresentation.ts'
import { stateLabels } from '../labels.ts'

/**
 * How a Job is acted on, wherever it is acted on.
 *
 * The handoff's rule set needs the moves sorted into two piles — the one next
 * action, and everything else behind a `···` — and needs the Jobs list and the
 * job page to sort them the same way. That sorting is this hook: the list and
 * the page render the same `action` at different weights and hand the same
 * `overflow` to the same menu, so neither can offer a move the other does not.
 *
 * Every move still comes from the shared transition table, so the dashboard
 * cannot offer one the service would refuse. Dispatch is the exception and is
 * handled on its own: CONTEXT.md defines it as three actions rather than a
 * state change, and `intake -> queued` is therefore dropped from the derived
 * moves — travelling that edge by hand would claim no branch and cut no
 * worktree.
 */

/**
 * What the one action is, and how the surface is to trigger it.
 *
 * `disabled` belongs to the action rather than to the surface: a job Linear has
 * not named a branch for cannot be dispatched, and that is a fact about the
 * job, not about whether it is being drawn in a row or in a banner.
 */
export type JobActionTarget =
  | { act: () => void; disabled?: boolean; kind: JobActionKind; label: string }
  | { href: string; kind: JobActionKind; label: string }
  | { kind: JobActionKind; label: string; to: string }

export type JobControls = {
  action: JobActionTarget
  /**
   * Approving the plan, which lives in the Codex session rather than on any
   * screen here. Offered only while the job is waiting on it: the job page's
   * banner draws it as the primary, and nothing else draws it at all, because
   * a plan approved from a list row is a plan nobody read.
   */
  approve: { act: () => void; offered: boolean; pending: boolean }
  /**
   * Cancelling is the one move that opens a confirmation first. The `···`
   * entry and the job page's danger-zone button both `request` it, so there is
   * one flag and one dialog however it was reached.
   */
  cancel: {
    close: () => void
    confirm: () => void
    offered: boolean
    pending: boolean
    request: () => void
    requested: boolean
  }
  failure: Error | null
  overflow: OverflowItem[]
  pending: boolean
  /**
   * The one filled control the job page's state banner offers beside the
   * primary — never more, because the handoff allows the banner exactly two
   * buttons and the old five-button "Actions" box is what it replaces.
   */
  secondary: JobActionTarget | null
}

export function useJobControls(job: Job): JobControls {
  const refresh = useJobRefresh()
  const [cancelRequested, setCancelRequested] = useState(false)

  // One failure for the whole job rather than one per mutation: each mutation
  // keeps its own error until it next runs, so a failed move would otherwise
  // still be on the row after a Resume that worked.
  const [failure, setFailure] = useState<Error | null>(null)
  const reports = { onError: setFailure, onMutate: () => setFailure(null) }

  const move = useMutation({
    ...reports,
    mutationFn: (to: Job['state']) => transitionJob(job.id, to, job.state),
    onSettled: refresh,
  })
  const suspend = useMutation({
    ...reports,
    mutationFn: () => suspendJob(job.id, 'stoppedByHandler'),
    onSettled: refresh,
  })
  const resume = useMutation({
    ...reports,
    mutationFn: () => resumeJob(job.id),
    onSettled: refresh,
  })
  const dispatch = useMutation({
    ...reports,
    mutationFn: () => dispatchJob(job.id),
    onSettled: refresh,
  })
  // Nothing to refresh: this puts a window on the Handler's screen and changes
  // no record, so the only thing it can report back is that it could not.
  const terminal = useMutation({
    ...reports,
    mutationFn: () => openJobTerminal(job.id),
  })
  const checkMerge = useMutation({
    ...reports,
    mutationFn: () => checkJobMerge(job.id),
    onSettled: refresh,
  })
  const approve = useMutation({
    ...reports,
    mutationFn: () => approveJob(job.id),
    onSettled: refresh,
  })

  const pending =
    move.isPending ||
    suspend.isPending ||
    resume.isPending ||
    dispatch.isPending ||
    checkMerge.isPending ||
    approve.isPending

  const overForGood = isTerminalJobState(job.state)
  // Merged is not terminal — it can still be archived — but it is settled:
  // the worktree is gone, so a Suspension on it would promise a resume into
  // something that no longer exists.
  const canSuspend = !isSettledJobState(job.state)
  const canDispatch = job.state === 'intake'
  const kind = jobAction(job)
  const jobPath = `/jobs/${job.id}`

  /** What the terminal window will actually be when it opens. */
  const openTerminal = {
    act: () => terminal.mutate(),
    disabled: terminal.isPending,
    kind: 'openSession',
    label: terminal.isPending
      ? 'Opening…'
      : // A held job has no session yet and is not getting a shell either: the
        // window opens Codex on the brief Handella declined to send itself.
        job.codexSessionId === null && job.hold === null
        ? 'Open terminal'
        : 'Open session',
  } as const
  const askGitHub = {
    act: () => checkMerge.mutate(),
    kind: 'open',
    label: checkMerge.isPending ? 'Asking GitHub…' : 'Check merge',
  } as const

  const action: JobActionTarget = (() => {
    const label = actionLabels[kind]
    if (kind === 'resume')
      return {
        act: () => resume.mutate(),
        kind,
        label: resume.isPending ? 'Resuming…' : label,
      }
    if (kind === 'dispatch')
      return {
        act: () => dispatch.mutate(),
        // Linear owns the canonical branch name and a Job cannot be dispatched
        // without one (ADR 0004), so this is refused here rather than at the
        // request.
        disabled: job.canonicalBranch === null,
        kind,
        label: dispatch.isPending ? 'Dispatching…' : label,
      }
    if (kind === 'openSession') return openTerminal
    if (kind === 'reviewPr' && job.originalPrUrl !== null)
      return { href: job.originalPrUrl, kind, label }
    // `reviewPlan` lands here too: the plan is read in the Codex session, and
    // the job page is where the session is opened and the approval given.
    return { kind, label, to: jobPath }
  })()

  /**
   * What is worth offering beside the primary, and nothing else.
   *
   * A job whose pull request is open gets the merge check rather than a
   * terminal: it is the thing that actually advances the job, and the terminal
   * is one click further on in the `···`. Everything else with a worktree gets
   * the terminal, because standing in the worktree is how a Handler works out
   * what a stopped job needs.
   */
  const secondary: JobActionTarget | null = (() => {
    if (isAwaitingMerge(job)) return askGitHub
    if (job.worktreePath !== null && kind !== 'openSession') return openTerminal
    return null
  })()

  /**
   * Everything that is not the one action. Each entry is left out rather than
   * disabled when it would do nothing — a menu of greyed lines is a worse
   * answer to "where do I click" than a shorter menu.
   *
   * "Open job" is deliberately absent: the whole row is already the link on the
   * list, and the page the menu would navigate to is the page it is on.
   */
  const overflow: OverflowItem[] = []

  if (canDispatch)
    overflow.push({
      disabled: pending || job.canonicalBranch === null,
      label: 'Dispatch',
      onSelect: () => dispatch.mutate(),
    })

  // A job that has reached the end of its life is not stopped, it is over, and
  // the service refuses to suspend one — so it is not offered here either. A
  // merged job is not offered it for the reason `canSuspend` gives, but one
  // already carrying a Suspension can still have it lifted.
  if (job.suspension === null) {
    if (canSuspend)
      overflow.push({
        disabled: pending,
        label: 'Suspend',
        onSelect: () => suspend.mutate(),
      })
  } else if (!overForGood) {
    overflow.push({
      disabled: pending,
      label: 'Resume',
      onSelect: () => resume.mutate(),
    })
  }

  // Only once there is a worktree to stand in, which Dispatch cuts. Offered
  // for every dispatched job rather than only a running one: what the Handler
  // wants to see mid-pass is also what they want to see the moment it stops.
  if (job.worktreePath !== null)
    overflow.push({
      disabled: openTerminal.disabled,
      label: openTerminal.label,
      onSelect: openTerminal.act,
    })

  if (job.linearIssueUrl !== null)
    overflow.push({ href: job.linearIssueUrl, label: 'Open in Linear' })

  // The only pull request action there will ever be: merging is the Handler's,
  // so this links to it rather than offering it.
  if (job.originalPrUrl !== null)
    overflow.push({ href: job.originalPrUrl, label: 'Open pull request' })

  // Reconciliation asks GitHub every few minutes anyway; this is for the
  // Handler who has just merged and does not want to wait for it.
  if (isAwaitingMerge(job))
    overflow.push({
      disabled: pending,
      label: askGitHub.label,
      onSelect: askGitHub.act,
    })

  // `approved` is left out for the same kind of reason as Dispatch: the service
  // only lets a job in with a runbook snapshot behind it, and approving is its
  // own endpoint that writes one. Offered here, the move would be refused every
  // time.
  const moves = legalTransitionsFrom(job.state).filter(
    (to) =>
      to !== 'cancelled' &&
      to !== 'approved' &&
      !(canDispatch && to === 'queued'),
  )
  for (const to of moves) {
    overflow.push({
      disabled: pending,
      label: `Move to ${stateLabels[to]}`,
      onSelect: () => move.mutate(to),
    })
  }

  const cancelOffered = legalTransitionsFrom(job.state).includes('cancelled')
  if (cancelOffered) {
    overflow.push({ kind: 'separator' })
    overflow.push({
      destructive: true,
      disabled: pending,
      label: 'Cancel job',
      onSelect: () => setCancelRequested(true),
    })
  }

  return {
    action,
    approve: {
      act: () => approve.mutate(),
      offered: job.state === 'planReview' && job.suspension === null,
      pending: approve.isPending,
    },
    cancel: {
      close: () => setCancelRequested(false),
      confirm: () => {
        setCancelRequested(false)
        move.mutate('cancelled')
      },
      offered: cancelOffered,
      pending: move.isPending,
      request: () => setCancelRequested(true),
      requested: cancelRequested,
    },
    failure,
    overflow,
    pending,
    secondary,
  }
}

/** The sentence the cancel confirmation names its consequence with. */
export const cancelConsequence =
  'Cancelling removes the worktree and stops Codex if it is working there. The branch and the Linear issue are left alone, and a cancelled job never comes back.'
