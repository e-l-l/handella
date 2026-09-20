import {
  availableSlots,
  isStartable,
  orderQueue,
  type StartableJob,
} from '@handella/contracts'

import type { CodexAdapter } from '../adapters/codex.js'
import type { LinearAdapter } from '../adapters/linear.js'
import type { Broadcaster } from '../events/broadcaster.js'
import { dispatchNeedsLinearIssue } from './errors.js'
import type { Store } from './store.js'

export interface Scheduler {
  /** Runs one pass now and subscribes to the events that warrant another. */
  start(): void
  stop(): void
  /** Resolves once every started job's planning pass has settled. */
  whenIdle(): Promise<void>
}

interface SchedulerLogger {
  error(context: Record<string, unknown>, message: string): void
}

interface SchedulerOptions {
  broadcaster: Broadcaster
  codex: CodexAdapter
  linear: LinearAdapter
  logger?: SchedulerLogger
  store: Store
}

/**
 * Event-driven rather than polled: the only things that free or fill a slot are
 * writes this process makes, and every one of them already publishes. A timer
 * would be a second source of truth that is usually wrong.
 */
export function createScheduler(options: SchedulerOptions): Scheduler {
  const { broadcaster, codex, linear, logger, store } = options

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
  const inFlight = new Set<Promise<void>>()
  /** The live passes, so a stop or a shutdown can reach the process itself. */
  const passes = new Map<string, AbortController>()

  /**
   * The slot is claimed by the transition, which has already committed by the
   * time this is awaited — so the pass runs without holding up the next one,
   * and the store is what says how many slots are left.
   */
  const runPlanningPass = async (job: StartableJob): Promise<void> => {
    const abort = new AbortController()
    passes.set(job.id, abort)

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
        runbook: runbook.content,
        sessionId: job.codexSessionId ?? undefined,
        signal: abort.signal,
        worktreePath: job.worktreePath,
      })

      // Recorded before the plan, so a session is never lost to a failure in
      // the write that follows it: without the id the next revision has no
      // conversation to continue and the job cannot be revised at all.
      store.recordCodexSession({ jobId: job.id, sessionId: result.sessionId })
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
          reason: error instanceof Error ? error.message : String(error),
        })
      } catch (abandonError) {
        logger?.error(
          { err: abandonError, jobId: job.id },
          'Could not return a job whose planning pass failed to the queue',
        )
      }
    } finally {
      passes.delete(job.id)
    }
  }

  const runOnce = (): void => {
    const jobs = store.listJobs()
    const slots = availableSlots(jobs)
    if (slots === 0) return

    const startable = orderQueue(jobs.filter(isStartable)).slice(0, slots)

    for (const job of startable) {
      try {
        // Synchronous and first: the slot is held from here, so the count this
        // pass computed cannot be spent twice.
        store.transitionJob({
          actor: 'system',
          expectedState: 'queued',
          jobId: job.id,
          to: 'planning',
        })
      } catch (error) {
        // Another pass took it, or the Handler moved it. Neither is a fault.
        logger?.error({ err: error, jobId: job.id }, 'Could not start a job')
        continue
      }

      const pass = runPlanningPass(job).finally(() => inFlight.delete(pass))
      inFlight.add(pass)
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
      // may have twenty minutes left in it.
      for (const pass of passes.values()) {
        pass.abort()
      }
    },

    async whenIdle() {
      // Each pass can start another, so this drains rather than awaiting once.
      while (inFlight.size > 0) {
        await Promise.all([...inFlight])
      }
    },
  }
}
