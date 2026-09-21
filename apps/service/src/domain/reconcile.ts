import { realpathSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'

import {
  codexTerminationGraceMs,
  isAwaitingMerge,
  mergeCheckIntervalMs,
  pidReuseToleranceMs,
  type CodexProcessRecord,
} from '@handella/contracts'

import type { GitAdapter } from '../adapters/git.js'
import type {
  ProcessDescription,
  ProcessInspector,
} from '../adapters/processes.js'
import type { MergeCheck } from './merge-check.js'
import type { Store } from './store.js'
import { createWorkTracker } from './work-tracker.js'

/**
 * Making the machine agree with the database.
 *
 * Three jobs, all of the same kind: the database says something about the
 * Handler's machine that only the machine can confirm. A process it believes
 * is running, a worktree it believes belongs to a Job, a pull request it
 * believes is still open. Every one of those can be false after a crash, a
 * restart, or a merge the Handler did on github.com — and none of them
 * announce themselves, which is why this is the one part of Handella that runs
 * on a timer.
 *
 * Deliberately not the scheduler. That component documents itself as
 * event-driven and says a timer would be a second source of truth that is
 * usually wrong; it is right about itself, because every slot it grants is a
 * write this process makes. Nothing here is (docs/adr/0013).
 */
export interface Reconciler {
  /**
   * Kills the Codex processes a previous run of Handella left behind.
   *
   * Returns once every leftover has been signalled and its row closed. The
   * SIGKILL that follows a SIGTERM is not waited for: it is a grace period
   * later, and startup is not worth delaying by five seconds for a process
   * that is already on its way out.
   */
  reapProcesses(): Promise<ReapReport>
  /** Reports the worktrees under Handella's root that no Job row names. */
  reconcileWorktrees(): Promise<WorktreeReport>
  /** One pass over every Job whose pull request Handella is waiting for. */
  checkMerges(): Promise<void>
  /** Runs a pass now, then every `mergeCheckIntervalMs`. */
  start(): void
  stop(): void
  /** Resolves once nothing this component started is still running. */
  whenIdle(): Promise<void>
}

export interface ReapReport {
  /** Processes that were still alive and holding what Handella recorded. */
  killed: readonly CodexProcessRecord[]
  /**
   * Rows whose pid is now held by something that is not the process Handella
   * spawned. Nothing was signalled for these, which is the point of counting
   * them separately: it is the case where guessing would cost the Handler a
   * process of their own.
   */
  reused: readonly CodexProcessRecord[]
}

export interface WorktreeReport {
  /** Absolute paths of everything found, whether it was reported or not. */
  orphans: readonly string[]
  /**
   * Whether every registered repository answered. A partial answer is not
   * reported to the Handler at all: the report is a complete set by
   * definition, and half of one would resolve an item about residue that is
   * still there.
   */
  complete: boolean
}

interface ReconcilerLogger {
  error(context: Record<string, unknown>, message: string): void
  info(context: Record<string, unknown>, message: string): void
  warn(context: Record<string, unknown>, message: string): void
}

interface ReconcilerOptions {
  /** Injected so a test does not wait out a real grace period. */
  delay?: (ms: number) => Promise<void>
  git: GitAdapter
  logger?: ReconcilerLogger
  mergeCheck: MergeCheck
  processes: ProcessInspector
  store: Store
  /** ADR 0006's fixed root. Nothing outside it is ever Handella's to judge. */
  worktreeRoot: string
}

/**
 * What a Codex process's command line looks like, loosely. The binary may be
 * anywhere — a version manager's shims put it under a path nobody could
 * predict — so this asks whether the name appears at all rather than where.
 *
 * Loose on purpose: it is the weaker of the two identity checks and is never
 * the only one applied.
 */
const namesCodex = (description: ProcessDescription): boolean =>
  description.command.includes('codex')

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    timer.unref()
  })

/** Whether `path` is inside `root`, without believing a `..` that says so. */
const isInside = (root: string, path: string): boolean => {
  const within = relative(root, path)
  // The separator matters: `..` and `../x` climb out, while a sibling
  // directory the Handler named `..scratch` does not, and a prefix test alone
  // cannot tell the two apart. An absolute answer is `relative` saying the two
  // paths share no root at all.
  return (
    within !== '' &&
    within !== '..' &&
    !within.startsWith(`..${sep}`) &&
    !isAbsolute(within)
  )
}

/**
 * The path with every symlink resolved, or the path itself when there is
 * nothing on disk to resolve.
 *
 * git answers `worktree list` with real paths — a root under `/var` on macOS
 * comes back under `/private/var` — while the database holds the path as
 * Handella spelled it when it cut the worktree. Comparing the two spellings
 * directly would put every one of git's answers outside Handella's own root,
 * and the half of the report that git provides would quietly become empty.
 */
const resolved = (path: string): string => {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

/**
 * How far below the root a worktree can be before the walk stops looking.
 *
 * A worktree sits at `<root>/<repository>/<branch>`, and it is the branch name
 * that nests: `ell/eng-412` is two levels, and nothing a Linear branch name
 * can spell comes near six. The cap is not about finding worktrees, which are
 * all shallower than this, but about what happens below one that has lost the
 * `.git` file the walk recognises it by — without it this is a synchronous
 * walk of an agent's `node_modules`, on the timer, holding the event loop.
 */
const deepestWorktree = 6

/**
 * The worktree directories actually on disk under a root.
 *
 * A worktree is a directory holding a `.git` **file** pointing back at the
 * checkout, so a directory with a `.git` entry is one and is not descended
 * into. Needed as well as `git worktree list` because a cut that died between
 * making the directory and registering it leaves a directory git never heard
 * of — which is exactly the residue a crash produces.
 */
const worktreeDirectories = async (
  root: string,
  depth = 0,
): Promise<string[]> => {
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    // The root does not exist yet, or is not readable. Either way there is
    // nothing under it to report.
    return []
  }

  if (entries.some((entry) => entry.name === '.git')) return [root]
  if (depth >= deepestWorktree) return []

  // Asynchronous, because this runs on the timer while the service is
  // answering the Handler: the depth cap bounds how far down a directory that
  // lost its `.git` file is followed, and nothing bounds how wide it is.
  const below = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => worktreeDirectories(join(root, entry.name), depth + 1)),
  )

  return below.flat()
}

export function createReconciler(options: ReconcilerOptions): Reconciler {
  const { git, logger, mergeCheck, processes, store, worktreeRoot } = options
  const delay = options.delay ?? sleep

  let timer: NodeJS.Timeout | undefined
  let stopped = false
  /** A pass already running, so a timer tick never overlaps one. */
  let running = false
  const work = createWorkTracker()

  /**
   * Whether this pid still holds the process Handella recorded.
   *
   * Both checks, always. A pid is not an identity: the operating system hands
   * the same number out again, and a machine restart makes that likely rather
   * than merely possible. The command says it is a Codex, and the start time
   * says it is *this* Codex — a coincidence would have to satisfy both, and
   * the cost of being wrong is a signal sent to whatever the Handler happens
   * to be running (docs/adr/0012).
   */
  const stillHolds = (
    record: CodexProcessRecord,
    description: ProcessDescription,
  ): boolean =>
    namesCodex(description) &&
    Math.abs(description.startedAt.getTime() - record.startedAt.getTime()) <=
      pidReuseToleranceMs

  /**
   * The SIGKILL after the SIGTERM, for anything that did not take the hint.
   *
   * Identity is checked again rather than trusted from a moment ago: the
   * process may have exited in the grace period and its pid been handed to
   * something else, and this is the one signal that cannot be taken back.
   */
  const finishOff = async (
    records: readonly CodexProcessRecord[],
  ): Promise<void> => {
    await delay(codexTerminationGraceMs)

    for (const record of records) {
      try {
        const description = await processes.describe(record.pid)
        if (description === null || !stillHolds(record, description)) continue

        processes.terminateGroup(record.pid, 'SIGKILL')
        logger?.warn(
          { jobId: record.jobId, pid: record.pid },
          'Killed a Codex process that did not stop when asked',
        )
      } catch (error) {
        logger?.error(
          { err: error, jobId: record.jobId, pid: record.pid },
          'Could not finish off a Codex process',
        )
      }
    }
  }

  const reapProcesses = async (): Promise<ReapReport> => {
    const killed: CodexProcessRecord[] = []
    const reused: CodexProcessRecord[] = []

    for (const record of store.listLiveCodexProcesses()) {
      let description: ProcessDescription | null
      try {
        description = await processes.describe(record.pid)
      } catch (error) {
        // `ps` itself is unavailable, so identity cannot be established for
        // this row or any other. Nothing is signalled and no row is closed:
        // a row left open is a process that can still be reaped later, while
        // a row closed blind is a process nothing will ever look for again.
        logger?.error(
          { err: error },
          'Could not inspect processes; left the Codex processes on record alone',
        )
        break
      }

      if (description !== null && !stillHolds(record, description)) {
        reused.push(record)
        store.endCodexProcess(record.id)
        continue
      }

      try {
        if (description !== null) {
          // Asked to stop rather than killed outright, because Codex writes the
          // session file the Handler will resume from as it exits.
          processes.terminateGroup(record.pid, 'SIGTERM')
          killed.push(record)
        }

        // Closed either way: the process is gone or on its way out, and a row
        // left open would have the next reap signal a pid this one finished
        // with — by then quite possibly somebody else's.
        store.endCodexProcess(record.id)
      } catch (error) {
        // A signal the operating system would not deliver, or a write the
        // database would not take. Caught per row rather than per pass, and
        // never rethrown: this runs before `listen`, so one refused signal
        // escaping here is a Handella that does not come up at all.
        //
        // The row is left as it is on purpose. Nothing was stopped, so there
        // is still something to find, and the next reap establishes its
        // identity again before it tries anything.
        logger?.error(
          { err: error, jobId: record.jobId, pid: record.pid },
          'Could not stop a Codex process a restart left behind',
        )
      }
    }

    // Not awaited. The grace period is five seconds and startup is not worth
    // delaying for a process that has already been told to go.
    if (killed.length > 0) work.track(finishOff(killed))

    return { killed, reused }
  }

  const reconcileWorktrees = async (): Promise<WorktreeReport> => {
    const root = resolved(worktreeRoot)

    // Every Job that names a path, whatever state it is in. The column is the
    // attribution: a cancelled Job's worktree is residue the Handler may well
    // want to clear, but it is residue Handella can account for, and an item
    // saying nothing claims it would be false — and, since no later pass can
    // make it true, would never resolve. The same goes for a merged Job whose
    // worktree could not be removed safely: that already has a failure item
    // naming the path and the reason.
    const claimed = new Set(
      store
        .listJobs()
        .map((job) => job.worktreePath)
        .filter((path): path is string => path !== null)
        .map(resolved),
    )

    const orphans = new Set<string>()
    let complete = true

    // The disk first, and over the whole root rather than per repository: a
    // repository the Handler has since removed leaves its worktrees behind,
    // and iterating the repositories that still exist would be exactly the
    // walk that could not see them.
    for (const directory of await worktreeDirectories(root)) {
      if (claimed.has(directory)) continue
      orphans.add(directory)
    }

    for (const repository of store.listRepositories()) {
      try {
        // Metadata only: it forgets worktrees whose directories are already
        // gone, which is what a worktree removed by hand leaves behind.
        await git.pruneWorktrees(repository.path)

        // git's own answer as well as the disk's. The two disagree when a
        // worktree is registered but its directory is unreadable, or has lost
        // the `.git` file the walk recognises it by — residue either way.
        for (const listing of await git.listWorktrees(repository.path)) {
          // The checkout itself is never a Job's, and a worktree the Handler
          // cut somewhere else is theirs — ADR 0006 fixed Handella's root
          // precisely so this comparison is possible.
          if (listing.isMain) continue

          const path = resolved(listing.path)
          if (!isInside(root, path)) continue
          if (claimed.has(path)) continue
          orphans.add(path)
        }
      } catch (error) {
        complete = false
        logger?.error(
          { err: error, repositoryId: repository.id },
          'Could not read a checkout while looking for orphaned worktrees',
        )
      }
    }

    const found = [...orphans]

    if (!complete) {
      return { complete, orphans: found }
    }

    // Logged on the pass that changed the inbox and not on the four hundred
    // that found the same residue again: the store already decides what counts
    // as news, and a second opinion here would be a second definition of it.
    if (store.reportOrphanWorktrees({ paths: found }) && found.length > 0) {
      logger?.warn({ paths: found }, 'Found worktrees no job claims')
    }

    return { complete, orphans: found }
  }

  const checkMerges = async (): Promise<void> => {
    for (const job of store.listJobs().filter(isAwaitingMerge)) {
      if (stopped) return

      try {
        await mergeCheck.check(job.id)
      } catch (error) {
        // One Job's failure is not the pass's. A logged-out `gh` will fail for
        // every Job and be logged for every Job, which is the honest amount of
        // noise for a condition the status screen already reports — and no
        // attention item, because a timer would mint one of those forever.
        logger?.warn(
          { err: error, jobId: job.id },
          'Could not check whether a pull request has merged',
        )
      }
    }
  }

  const pass = async (): Promise<void> => {
    if (running || stopped) return
    running = true

    try {
      await checkMerges()
      // After the merges, so a worktree removed by this very pass is not
      // reported as residue a moment after it stopped existing.
      await reconcileWorktrees()
    } catch (error) {
      logger?.error({ err: error }, 'Reconciliation pass failed')
    } finally {
      running = false
    }
  }

  return {
    reapProcesses,
    reconcileWorktrees,
    checkMerges,

    start() {
      if (timer !== undefined) return
      stopped = false

      // One pass now: the Handler may have merged something while Handella was
      // not running, and waiting five minutes to notice would be five minutes
      // of a worktree that has no reason to exist.
      work.track(pass())

      timer = setInterval(() => work.track(pass()), mergeCheckIntervalMs)
      // Never the reason the process stays up.
      timer.unref()
    },

    stop() {
      stopped = true
      if (timer !== undefined) clearInterval(timer)
      timer = undefined
    },

    whenIdle: work.whenIdle,
  }
}
