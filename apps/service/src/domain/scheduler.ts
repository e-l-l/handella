import { closeSync, mkdirSync, openSync, writeSync } from 'node:fs'
import { dirname } from 'node:path'

import {
  availableSlots,
  isImplementable,
  isRepairable,
  isStartable,
  maxImplementationAttempts,
  orderQueue,
  type Attempt,
  type CodexPassKind,
  type Job,
  type JobState,
  type StartableJob,
} from '@handella/contracts'

import type { CodexAdapter, ImplementationResult } from '../adapters/codex.js'
import type { GitAdapter } from '../adapters/git.js'
import type { GitHubAdapter } from '../adapters/github.js'
import type { LinearAdapter } from '../adapters/linear.js'
import type { Broadcaster } from '../events/broadcaster.js'
import {
  codexSessionMissing,
  dispatchNeedsLinearIssue,
  messageOf,
  transitionGuardFailed,
} from './errors.js'
import type { Store } from './store.js'
import { createWorkTracker } from './work-tracker.js'

/**
 * The most often a running job announces itself. A turn produces a milestone
 * every few seconds and sometimes several at once; a dashboard that refetched
 * per row would spend the turn refetching. Coalescing keeps the spine moving
 * without making the stream the transport.
 */
const progressCoalesceMs = 1_000

export interface Scheduler {
  /** Runs one pass now and subscribes to the events that warrant another. */
  start(): void
  stop(): void
  /** Resolves once every started job's pass, of either kind, has settled. */
  whenIdle(): Promise<void>
}

interface SchedulerLogger {
  error(context: Record<string, unknown>, message: string): void
}

interface SchedulerOptions {
  broadcaster: Broadcaster
  codex: CodexAdapter
  git: GitAdapter
  github: GitHubAdapter
  linear: LinearAdapter
  logger?: SchedulerLogger
  /** Where an Attempt's raw stream is written. */
  logRoot: string
  store: Store
}

/**
 * Event-driven rather than polled: the only things that free or fill a slot are
 * writes this process makes, and every one of them already publishes. A timer
 * would be a second source of truth that is usually wrong.
 */
export function createScheduler(options: SchedulerOptions): Scheduler {
  const { broadcaster, codex, git, github, linear, logRoot, logger, store } =
    options

  let unsubscribe: (() => void) | undefined
  let running = false
  /** A pass asked for while one was running, so nothing is missed. */
  let again = false
  /**
   * Set once `stop` has been called. A pass cut off by shutdown is not a
   * failed pass: its job is left in `planning` so the next startup's
   * reconciliation returns it to the queue, which is the one place that knows
   * an interruption from a fault.
   */
  let shuttingDown = false
  const work = createWorkTracker()
  /** The live passes, so a stop or a shutdown can reach the process itself. */
  const passes = new Map<string, AbortController>()

  /**
   * Keeps the row that says how to find a Codex process for exactly as long as
   * the pass owns it.
   *
   * A pass holds a pid in a closure the process cannot outlive: if this one
   * dies the handle dies with it, and the process carries on writing in the
   * worktree with nothing left that knows its number. The row is what a later
   * startup reaps from (docs/adr/0012), and closing it here is what stops that
   * reap signalling a pid this process has already finished with — and which
   * the operating system is free to hand to something else.
   */
  const recordProcess = (jobId: string, kind: CodexPassKind) => {
    let codexProcessId: string | undefined

    return {
      onSpawn: (pid: number): void => {
        try {
          codexProcessId = store.startCodexProcess({ jobId, kind, pid }).id
        } catch (error) {
          // A pass that is already running is not worth stopping over a row
          // that failed to be written; what it costs is a reap that cannot
          // find this process, which is worth saying out loud.
          logger?.error(
            { err: error, jobId, pid },
            'Could not record a Codex process',
          )
        }
      },
      release: (): void => {
        if (codexProcessId === undefined) return
        try {
          store.endCodexProcess(codexProcessId)
        } catch (error) {
          logger?.error(
            { err: error, jobId },
            'Could not close the record of a Codex process',
          )
        }
      },
    }
  }

  /**
   * The slot is claimed by the transition, which has already committed by the
   * time this is awaited — so the pass runs without holding up the next one,
   * and the store is what says how many slots are left.
   */
  const runPlanningPass = async (job: StartableJob): Promise<void> => {
    const abort = new AbortController()
    passes.set(job.id, abort)
    const codexProcess = recordProcess(job.id, 'plan')

    try {
      if (job.linearIssueId === null) {
        throw dispatchNeedsLinearIssue()
      }

      // Read now rather than trusted from intake, for the reason Dispatch
      // re-reads it: Linear owns the issue and the Handler may have rewritten
      // it since the job was taken.
      const issue = await linear.getIssue(job.linearIssueId)
      const runbook = store.activeRunbook()

      // A job that has planned before is revising, and what it is revising
      // against is the feedback on its newest revision. The plan itself is not
      // sent: it is already in the session this pass resumes.
      const feedback = store.latestPlanVersion(job.id)?.feedback ?? undefined

      const result = await codex.plan({
        feedback,
        issue,
        job,
        // Written the moment Codex opens the session rather than when the pass
        // ends. A first pass reasons for minutes, and until this lands the job
        // has no session the Handler can open and no conversation a failed
        // pass could be retried into — which is the whole of what a job in
        // `planning` has to show for itself.
        //
        // Only when it is news. A revision resumes the session the job is
        // already holding, and the write is not free: it bumps `updatedAt`
        // and announces a `job.changed` every dashboard then refetches on.
        onSessionId: (sessionId) => {
          if (sessionId !== job.codexSessionId) {
            store.recordCodexSession({ jobId: job.id, sessionId })
          }
        },
        onSpawn: codexProcess.onSpawn,
        runbook: runbook.content,
        sessionId: job.codexSessionId ?? undefined,
        signal: abort.signal,
        worktreePath: job.worktreePath,
      })

      store.createPlanVersion({ content: result.content, jobId: job.id })
      store.transitionJob({
        actor: 'system',
        expectedState: 'planning',
        jobId: job.id,
        to: 'planReview',
      })
    } catch (error) {
      logger?.error({ err: error, jobId: job.id }, 'Planning pass failed')

      // Shutdown is not a fault: the job is left in `planning` for the next
      // startup's reconciliation, which is the one place that can tell an
      // interruption from a failure.
      if (shuttingDown) return

      try {
        // The slot has to come back, and a job stopped by the system is the
        // orthogonal way to say so without inventing a lifecycle state
        // (ADR 0003). The store re-queues as it stops, so the slot is given
        // back rather than merely freed: a job resumed in `planning` would
        // hold one with nothing running in it.
        store.abandonPlanningPass({
          jobId: job.id,
          reason: messageOf(error),
        })
      } catch (abandonError) {
        logger?.error(
          { err: abandonError, jobId: job.id },
          'Could not return a job whose planning pass failed to the queue',
        )
      }
    } finally {
      codexProcess.release()
      passes.delete(job.id)
    }
  }

  /**
   * One `job.progress` per job per interval, however many milestones landed.
   * Held here rather than in the store because coalescing is a property of the
   * stream, not of the write: the row is durable the moment it is inserted, and
   * what is being rationed is how often a dashboard is asked to look.
   */
  const announcements = new Map<
    string,
    { last: number; pending: NodeJS.Timeout | undefined }
  >()

  const announcementFor = (jobId: string) => {
    const existing = announcements.get(jobId)
    if (existing !== undefined) return existing

    const created = {
      last: 0,
      pending: undefined as NodeJS.Timeout | undefined,
    }
    announcements.set(jobId, created)
    return created
  }

  const publishProgress = (jobId: string): void => {
    const state = announcementFor(jobId)
    state.last = Date.now()
    state.pending = undefined
    broadcaster.publish({ data: { jobId }, name: 'job.progress' })
  }

  const announceProgress = (jobId: string): void => {
    const state = announcementFor(jobId)
    if (state.pending !== undefined) return

    const wait = state.last + progressCoalesceMs - Date.now()
    if (wait <= 0) {
      publishProgress(jobId)
      return
    }

    state.pending = setTimeout(() => publishProgress(jobId), wait)
    state.pending.unref()
  }

  /** The last word on a turn, so the spine shows its final beats. */
  const flushProgress = (jobId: string): void => {
    const state = announcements.get(jobId)
    if (state?.pending !== undefined) clearTimeout(state.pending)
    announcements.delete(jobId)
    broadcaster.publish({ data: { jobId }, name: 'job.progress' })
  }

  /**
   * Either the pull request Handella found, or why it accepted none. Both keys
   * always present, as `Nullable` does everywhere else here, so the caller
   * destructures rather than probing with `in`.
   */
  type Verification =
    { reason: null; url: string } | { reason: string; url: null }

  /**
   * What Handella can see for itself, asked before it believes anything the
   * agent reported. The worktree's HEAD first, because a pull request on some
   * other branch is worse than none; then GitHub, which is the only authority
   * on whether a pull request exists.
   */
  const verifyPullRequest = async (
    job: StartableJob,
  ): Promise<Verification> => {
    const branch = job.canonicalBranch
    if (branch === null) {
      return {
        reason: 'The job has no canonical branch to look for',
        url: null,
      }
    }

    const head = await git.headBranch(job.worktreePath)
    if (head !== branch) {
      return {
        reason: `The worktree is on ${head} rather than ${branch}, so no pull request was accepted`,
        url: null,
      }
    }

    const pullRequest = await github.findPullRequest(job.worktreePath, branch)
    if (pullRequest === null) {
      return { reason: `No pull request was opened for ${branch}`, url: null }
    }
    if (pullRequest.state !== 'OPEN') {
      return {
        reason: `The pull request for ${branch} is ${pullRequest.state.toLowerCase()}`,
        url: null,
      }
    }
    if (pullRequest.isDraft) {
      return {
        reason: `The pull request for ${branch} is a draft rather than ready for review`,
        url: null,
      }
    }
    if (pullRequest.baseRefName !== job.baseBranch) {
      return {
        reason: `The pull request for ${branch} targets ${pullRequest.baseRefName} rather than ${job.baseBranch}`,
        url: null,
      }
    }

    return { reason: null, url: pullRequest.url }
  }

  /**
   * What happens to the job now the turn is over.
   *
   * A repairable ending with budget left does nothing at all: the job stays in
   * `implementing` holding its slot with no live pass, which is exactly what
   * the orphan rule in `runOnce` starts the next turn from. Exhausting the
   * budget is the only thing that suspends, which is also what stops that rule
   * from starting a fourth.
   */
  const settle = (
    jobId: string,
    attemptNumber: number,
    outcome: ImplementationResult['outcome'],
    reason: string,
    url: string | null,
  ): void => {
    if (outcome === 'reportedDone' && url !== null) {
      store.openPullRequest({ jobId, url })
      return
    }

    // The Handler's own stop, and the one ending that is nobody's to answer:
    // their suspension is already on the job, and the worktree keeps whatever
    // the turn had written.
    if (outcome === 'stopped') return

    // `isRepairable` is the same rule `startAttempt` numbers rounds by, so a
    // turn this leaves for another is a turn that one will grant. A wrong plan
    // is not one: another turn would implement the same wrong plan again.
    if (isRepairable(outcome) && attemptNumber < maxImplementationAttempts) {
      return
    }

    store.failImplementation({ body: reason, jobId })
  }

  /** Why a turn that produced no pull request did not, in the Handler's words. */
  const describeEnding = (
    result: ImplementationResult,
    verification: string | null,
  ): string => {
    if (result.outcome === 'reportedBlocked') {
      const deviations = result.report?.planDeviations ?? []
      const summary = result.report?.summary ?? ''
      return [
        'The agent stopped because the plan did not match the repository.',
        ...(summary === '' ? [] : ['', summary]),
        ...(deviations.length === 0
          ? []
          : ['', ...deviations.map((line) => `- ${line}`)]),
      ].join('\n')
    }

    if (verification !== null) {
      const unresolved = result.report?.unresolved ?? []
      return [
        verification,
        ...(unresolved.length === 0
          ? []
          : [
              '',
              'The agent reported these as unresolved:',
              ...unresolved.map((line) => `- ${line}`),
            ]),
      ].join('\n')
    }

    return result.failureReason ?? 'The turn ended without saying why'
  }

  const runImplementationPass = async (job: StartableJob): Promise<void> => {
    const abort = new AbortController()
    passes.set(job.id, abort)
    const codexProcess = recordProcess(job.id, 'implement')

    let attempt: Attempt | undefined
    let log: number | undefined
    /** Whether the turn's own ending is already on the row. */
    let finished = false

    try {
      if (job.linearIssueId === null) throw dispatchNeedsLinearIssue()
      if (job.codexSessionId === null) throw codexSessionMissing(job.id)

      // Asked before the turn rather than after it. The agent opens the pull
      // request, so a logged-out `gh` is otherwise discovered only once the work
      // is done and has nowhere to go — and that costs a whole turn.
      await github.checkAuth()

      const plan = store.latestPlanVersion(job.id)
      if (plan === undefined || plan.approvalState !== 'approved') {
        throw transitionGuardFailed(
          'A job cannot be implemented without an approved plan',
        )
      }

      // The snapshot rather than the active Runbook: this job approved against
      // what it said then, and the Handler may have rewritten it since.
      const snapshot = store.latestRunbookSnapshot(job.id)
      if (snapshot === undefined) {
        throw transitionGuardFailed(
          'A job cannot be implemented without a runbook snapshot',
        )
      }

      const issue = await linear.getIssue(job.linearIssueId)
      const previous = store.latestAttempt(job.id)

      attempt = store.startAttempt({
        jobId: job.id,
        logRoot,
        sessionId: job.codexSessionId,
      })

      const logPath = store.attemptLogPath({
        attemptId: attempt.id,
        jobId: job.id,
      })
      mkdirSync(dirname(logPath), { mode: 0o700, recursive: true })
      // A descriptor written synchronously rather than a stream: a stream opens
      // and flushes on later ticks, so a turn could finish — and its attempt row
      // say where its log is — before any of it had reached the disk.
      log = openSync(logPath, 'a', 0o600)

      const started = attempt
      const result = await codex.implement({
        attempt: started.attempt,
        issue,
        job,
        onLine: (text) => {
          if (log !== undefined) writeSync(log, `${text}\n`)
        },
        onMilestone: (milestone) => {
          store.recordMilestone({
            attemptId: started.id,
            jobId: job.id,
            ...milestone,
          })
          announceProgress(job.id)
        },
        onSpawn: codexProcess.onSpawn,
        plan: plan.content,
        round: started.round,
        runbook: snapshot.content,
        sessionId: job.codexSessionId,
        signal: abort.signal,
        unresolved: previous?.report?.unresolved ?? [],
        worktreePath: job.worktreePath,
      })

      // A turn cut off by shutdown is left open, so the next startup's
      // reconciliation is the one thing that calls it interrupted.
      if (shuttingDown) return

      // Closed before GitHub is asked anything. The report is the only record
      // of what this turn did — and its `unresolved` list is the whole of the
      // next turn's brief — so it is written down before a network call that
      // can fail gets the chance to throw it away.
      store.finishAttempt({
        attemptId: started.id,
        failureReason: result.failureReason,
        outcome: result.outcome,
        report: result.report,
      })
      finished = true

      let verified: Verification | undefined
      let unverifiable: string | undefined
      if (result.outcome === 'reportedDone') {
        try {
          verified = await verifyPullRequest(job)
        } catch (error) {
          unverifiable = messageOf(error)
        }
      }

      // Handella could not see whether the work landed, and another turn would
      // not tell it: a repair turn answers a turn that went wrong, not a
      // question Handella failed to ask. Asking the Handler is the cheaper of
      // the two, and spends no budget on an answer nobody has.
      if (unverifiable !== undefined) {
        store.failImplementation({
          body: `The turn finished, but Handella could not check whether a pull request exists: ${unverifiable}`,
          jobId: job.id,
        })
        return
      }

      const { reason, url } = verified ?? { reason: null, url: null }

      settle(
        job.id,
        started.attempt,
        result.outcome,
        describeEnding(result, reason),
        url,
      )
    } catch (error) {
      logger?.error({ err: error, jobId: job.id }, 'Implementation pass failed')
      if (shuttingDown) return

      const reason = messageOf(error)

      try {
        if (attempt === undefined) {
          // Nothing was ever attempted, so nothing consumed budget — and a job
          // left running would be started again immediately by the orphan rule,
          // failing the same way forever. Stopping it is what breaks that.
          store.suspendJob({
            jobId: job.id,
            reason,
            suspension: 'stoppedBySystem',
          })
        } else {
          // Only if the turn's own ending was never written: a failure after
          // that point is Handella's, and overwriting would discard the report
          // the turn actually produced.
          if (!finished) {
            store.finishAttempt({
              attemptId: attempt.id,
              failureReason: reason,
              outcome: 'failed',
              report: null,
            })
          }
          settle(job.id, attempt.attempt, 'failed', reason, null)
        }
      } catch (settleError) {
        logger?.error(
          { err: settleError, jobId: job.id },
          'Could not record the end of a failed implementation pass',
        )
      }
    } finally {
      codexProcess.release()
      // Cleared before it is closed, because `onLine` still holds this closure
      // and a closed descriptor number is one the operating system is free to
      // hand to something else.
      const descriptor = log
      log = undefined
      if (descriptor !== undefined) closeSync(descriptor)
      passes.delete(job.id)
      if (!shuttingDown) {
        flushProgress(job.id)
        // Nothing this pass wrote necessarily published an event, so the next
        // turn is asked for rather than waited for.
        tick()
      }
    }
  }

  /**
   * A job mid-implementation with no live pass behind it. It already owns its
   * slot — `isRunning` counts `implementing`, so `availableSlots` was debited
   * before this tick ever ran — which is why it starts outside the budget and
   * without a transition: its position has not changed, only the fact that
   * nothing is running in it.
   *
   * There are exactly two ways to be one. Between repair turns, where the
   * previous pass returned without suspending precisely because budget
   * remained; and just after a Handler resumed a job that had run out, where a
   * fresh round is what they asked for. Neither needs a budget check here: a
   * job with nothing left is suspended, and a suspended job is not one of these.
   */
  const isOrphaned = (job: Job): job is StartableJob =>
    job.suspension === null &&
    job.state === 'implementing' &&
    job.worktreePath !== null &&
    !passes.has(job.id)

  /**
   * What the scheduler may start, in the order it prefers to start it.
   *
   * Implementation outranks planning: the Handler has already spent their
   * attention approving that plan, and planning a fourth job while an approved
   * one waits only widens the work in progress.
   *
   * A table rather than a boolean re-derived from the state and the three
   * ternaries it drove, so the next phase's start condition is a row here
   * rather than a third branch in the loop.
   */
  const startableKinds: readonly {
    from: JobState
    ready: (job: Job) => job is StartableJob
    run: (job: StartableJob) => Promise<void>
    to: JobState
  }[] = [
    {
      from: 'approved',
      ready: isImplementable,
      run: runImplementationPass,
      to: 'implementing',
    },
    {
      from: 'queued',
      ready: isStartable,
      run: runPlanningPass,
      to: 'planning',
    },
  ]

  const runOnce = (): void => {
    const jobs = store.listJobs()

    for (const job of jobs.filter(isOrphaned)) {
      work.track(runImplementationPass(job))
    }

    const slots = availableSlots(jobs)
    if (slots === 0) return

    const starting = startableKinds
      .flatMap((kind) =>
        orderQueue(jobs.filter(kind.ready)).map((job) => ({ job, kind })),
      )
      .slice(0, slots)

    for (const { job, kind } of starting) {
      try {
        // Synchronous and first: the slot is held from here, so the count this
        // pass computed cannot be spent twice.
        store.transitionJob({
          actor: 'system',
          expectedState: kind.from,
          jobId: job.id,
          to: kind.to,
        })
      } catch (error) {
        // Another pass took it, or the Handler moved it. Neither is a fault.
        logger?.error({ err: error, jobId: job.id }, 'Could not start a job')
        continue
      }

      work.track(kind.run(job))
    }
  }

  const tick = (): void => {
    if (running) {
      again = true
      return
    }

    running = true
    try {
      do {
        again = false
        runOnce()
      } while (again)
    } finally {
      running = false
    }
  }

  return {
    start() {
      shuttingDown = false
      unsubscribe ??= broadcaster.subscribe((event) => {
        // Only a job's movement can free or fill a slot; attention items cannot.
        if (event.name !== 'job.changed') return

        // A stopped job stops paying for Codex. Without this the suspension
        // would free the slot in the database while the process it stands for
        // kept running in the worktree.
        if (event.data.suspension !== null) {
          passes.get(event.data.jobId)?.abort()
        }

        tick()
      })
      tick()
    },

    stop() {
      shuttingDown = true
      unsubscribe?.()
      unsubscribe = undefined

      // Asked to stop rather than waited for: `whenIdle` runs next, and a pass
      // may have most of its budget left in it.
      for (const pass of passes.values()) {
        pass.abort()
      }

      for (const state of announcements.values()) {
        if (state.pending !== undefined) clearTimeout(state.pending)
      }
      announcements.clear()
    },

    // Each pass can start another, which is what the tracker's drain is for.
    whenIdle: work.whenIdle,
  }
}
