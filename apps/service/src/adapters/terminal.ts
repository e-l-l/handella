import { terminalUnavailable } from '../domain/errors.js'

/** What a window is being opened on, and what it opens onto. */
export interface TerminalRequest {
  /**
   * The Job's Worktree. Always set: the window stands in it whether or not
   * there is a session to resume, because the directory is the one thing a
   * dispatched Job always has.
   */
  path: string
  /**
   * The Codex session the window resumes, when the Job has one. Null until
   * planning has reported a session id, and the window is then a plain shell.
   */
  sessionId: string | null
}

/**
 * A shell in front of the Handler, opened on the machine the service is
 * running on.
 *
 * This exists for the reason `FolderPicker` does: the browser cannot do it.
 * A page has no way to start a process, and what the Handler wants when a Job
 * is planning or implementing is the conversation — what Codex is reasoning
 * about, what it has tried, what it is stuck on — which the Milestone spine
 * summarises and the Attempt log flattens. V1 is macOS-only, single-user and
 * local-first (masterplan.md:97), so "open a terminal" means open one in the
 * login session of the person who just asked.
 *
 * The window resumes the Job's Codex session rather than only standing in its
 * Worktree, which makes the Handler a second voice in a conversation Handella
 * resumes too; docs/adr/0011 is why that is the trade the Handler wanted.
 */
export interface TerminalOpener {
  /** Opens a window on `request.path`, resuming its session if it has one. */
  open(request: TerminalRequest): Promise<void>
}

/** What a platform with no terminal Handella knows how to open gets. */
export const unavailableTerminal: TerminalOpener = {
  open: () =>
    Promise.reject(
      terminalUnavailable(
        'This installation cannot open a terminal; open one yourself at the worktree path',
      ),
    ),
}
