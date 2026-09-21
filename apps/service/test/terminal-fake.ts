import type {
  TerminalOpener,
  TerminalRequest,
} from '../src/adapters/terminal.js'

export interface FakeTerminalOpener extends TerminalOpener {
  /** Every window that was asked for, in order. */
  readonly opened: () => TerminalRequest[]
}

/**
 * Opens nothing. The real thing puts a window in front of a person, which is
 * not automatable — what is asserted here is everything around it: that the
 * route asks, that it asks with the Job's worktree and the Job's session, and
 * that it does not ask at all for a Job that has no worktree.
 */
export const createFakeTerminalOpener = (): FakeTerminalOpener => {
  const opened: TerminalRequest[] = []

  return {
    opened: () => [...opened],
    open(request) {
      opened.push(request)
      return Promise.resolve()
    },
  }
}
