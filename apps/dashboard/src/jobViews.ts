/**
 * The scheduler's rules, re-exported for the views that read them.
 *
 * These predicates used to live here, when the only thing that needed them was
 * the concurrency chip. Phase 4 gave the service a real scheduler, and a slot
 * rule the dashboard and the scheduler each spelled for themselves would be a
 * UI that promises a turn the scheduler will not give — so they moved to
 * `@handella/contracts` and this file forwards them under the name the
 * components already know.
 */
export {
  availableSlots,
  isInFlight,
  isQueued,
  isRunning,
  maxConcurrency,
  orderQueue,
} from '@handella/contracts'
