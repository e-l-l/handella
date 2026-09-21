/**
 * Which kind of pass a Codex process was spawned for. The two differ in what
 * they are allowed to do — a planning pass runs read-only and an implementing
 * one may write — so a leftover process of each kind is a different thing to
 * find, and Reconciliation says which it killed.
 *
 * Named for the pass rather than the Job's Lifecycle State: a Job in
 * `implementing` between repair turns has no process at all, and the row is
 * about the process.
 */
export const codexPassKinds = ['plan', 'implement'] as const

export type CodexPassKind = (typeof codexPassKinds)[number]

/**
 * How long a Codex process gets between SIGTERM and SIGKILL, whether it is
 * this process signalling a pass it started or Reconciliation signalling one a
 * previous process left behind.
 *
 * Here rather than in the adapter because both of those spell it, and two
 * spellings are two answers to "how long does Handella wait" — the one the
 * Handler experiences as a stop that hung.
 */
export const codexTerminationGraceMs = 5_000

/**
 * How far apart a process's own start time and Handella's record of it may be
 * before Handella concludes the pid was reused.
 *
 * A pid is not an identity: the operating system hands the same number out
 * again, and a machine restart makes that likely rather than merely possible.
 * The row says when Handella spawned the process, `ps` says when the process
 * holding that pid actually started, and a number that only ever grows apart
 * from the truth is the one signal that cannot be forged by coincidence.
 *
 * Generous rather than tight: the two clocks are read seconds apart by
 * different tools, and the cost of being wrong in this direction is a stale
 * process left alive to be found next pass, while the cost of being wrong in
 * the other is a signal sent to something that was never Handella's.
 */
export const pidReuseToleranceMs = 10_000

/**
 * Deliberately has no TypeBox schema and appears in no response. A pid is
 * Handella's business with the operating system: the Handler has no use for
 * one, and putting it on the wire would invite a dashboard that offers to kill
 * things — which is Reconciliation's job and nobody else's.
 */
export interface CodexProcessRecord {
  id: string
  jobId: string
  kind: CodexPassKind
  pid: number
  startedAt: Date
  endedAt: Date | null
}
