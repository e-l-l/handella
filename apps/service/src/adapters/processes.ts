/**
 * The one place Handella asks the operating system about a process it did not
 * spawn, and the one place it signals one.
 *
 * A port rather than `process.kill` at the call site, because what Reconciliation
 * does here is the most dangerous thing in Handella: a signal sent to a pid
 * that has been reused goes to whatever the Handler happens to be running. The
 * seam is what lets that decision be tested exhaustively against a fake,
 * including the cases where it must send nothing at all.
 *
 * Unlike the Linear port there is no "unconfigured" null object, for the reason
 * git has none: `ps` is a local binary, not an integration the Handler opts
 * into.
 */
export interface ProcessDescription {
  /**
   * The process's argv as `ps` prints it, used to check that the pid still
   * holds what Handella thinks it does.
   */
  command: string
  /** When the process itself started, according to the operating system. */
  startedAt: Date
}

export interface ProcessInspector {
  /**
   * What is holding this pid, or null when nothing is.
   *
   * Null is the ordinary answer after a machine restart and is not a failure:
   * the process Handella recorded is simply gone.
   */
  describe(pid: number): Promise<ProcessDescription | null>
  /**
   * Signals the process group led by `pid`, so a Codex pass's own children —
   * the installs and test runners its Runbook asked for — are reached too.
   * Codex is spawned detached precisely so this is possible (docs/adr/0012).
   *
   * A group that has already gone is success, not an error: the caller wanted
   * it stopped and it is stopped.
   */
  terminateGroup(pid: number, signal: NodeJS.Signals): void
}
