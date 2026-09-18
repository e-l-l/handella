import {
  availableSlots,
  isStartable,
  orderQueue,
  type Job,
} from '@handella/contracts'

import type { CodexAdapter } from '../adapters/codex.js'
import type { Broadcaster } from '../events/broadcaster.js'
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
  logger?: SchedulerLogger
  store: Store
}

/**
 * Event-driven rather than polled: the only things that free or fill a slot are
 * writes this process makes, and every one of them already publishes. A timer
 * would be a second source of truth that is usually wrong.
 */
export function createScheduler(options: SchedulerOptions): Scheduler {
  const { broadcaster, codex, logger, store } = options

  let unsubscribe: (() => void) | undefined
  let running = false
  /** A pass asked for while one was running, so nothing is missed. */
  let again = false
  const inFlight = new Set<Promise<void>>()

  /**
   * The slot is claimed by the transition, which has already committed by the
   * time this is awaited — so the pass runs without holding up the next one,
   * and the store is what says how many slots are left.
   */
  const runPlanningPass = async (job: Job): Promise<void> => {
    try {
      const result = await codex.plan({
        job,
        // Narrowed by `isStartable`, which is what makes a job eligible.
        worktreePath: job.worktreePath ?? '',
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

      // The slot has to come back, and a job stopped by the system is the
      // orthogonal way to say so without inventing a lifecycle state (ADR 0003).
      try {
        store.suspendJob({
          jobId: job.id,
          reason: error instanceof Error ? error.message : String(error),
          suspension: 'stoppedBySystem',
        })
      } catch (suspendError) {
        logger?.error(
          { err: suspendError, jobId: job.id },
          'Could not suspend a job whose planning pass failed',
        )
      }
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
      unsubscribe ??= broadcaster.subscribe((event) => {
        // Only a job's movement can free or fill a slot; attention items cannot.
        if (event.name === 'job.changed') tick()
      })
      tick()
    },

    stop() {
      unsubscribe?.()
      unsubscribe = undefined
    },

    async whenIdle() {
      // Each pass can start another, so this drains rather than awaiting once.
      while (inFlight.size > 0) {
        await Promise.all([...inFlight])
      }
    },
  }
}
