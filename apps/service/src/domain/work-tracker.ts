/**
 * The work a component started and has not finished, so a shutdown can wait
 * for it.
 *
 * Both components that run work nobody awaits need this, and they need it
 * identically: the scheduler starts a pass the event that warranted it has
 * already returned from, and Reconciliation starts a SIGKILL a grace period
 * behind a SIGTERM. `server.ts` asks both to be idle before it closes the
 * database under them, which is the reason the bookkeeping is spelled once
 * rather than twice.
 */
export interface WorkTracker {
  /** Follows a promise until it settles, however it settles. */
  track(work: Promise<void>): void
  /**
   * Resolves once nothing is left running.
   *
   * Drains rather than awaiting once: work in flight is allowed to start more
   * of it, and a single `Promise.all` would return while the next wave ran.
   */
  whenIdle(): Promise<void>
}

export const createWorkTracker = (): WorkTracker => {
  const inFlight = new Set<Promise<void>>()

  return {
    track(work) {
      // Named before it is added, because the handle removes itself: `finally`
      // runs long after this line, by which time `tracked` is bound.
      const tracked = work.finally(() => inFlight.delete(tracked))
      inFlight.add(tracked)
    },

    async whenIdle() {
      while (inFlight.size > 0) {
        await Promise.all([...inFlight])
      }
    },
  }
}
