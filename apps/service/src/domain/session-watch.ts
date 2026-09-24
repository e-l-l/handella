import {
  rolloutSearchGraceMs,
  sessionWatchIntervalMs,
  type Job,
  type JobState,
  type StartableJob,
} from '@handella/contracts'

import type { CodexSessions } from '../adapters/codex-sessions.js'
import { messageOf } from './errors.js'
import type { PullRequestCheck } from './pull-request-check.js'
import { readRolloutEvents, type RolloutEvent } from './rollout.js'
import type { SessionWatchRecord, Store } from './store.js'
import { createWorkTracker } from './work-tracker.js'

/**
 * Handella following a Job's Codex session through the file Codex writes it to.
 *
 * The Handler reads the plan in their terminal and answers it there, so the
 * two things that move a Job most — approving a plan, and opening the pull
 * request that ends the work — happen where Handella has no handle. This
 * watches for them instead: a session created in a held worktree, files
 * changing while a Job waits in `planReview`, a turn ending while it is
 * `implementing`. Nothing here believes what the session says about itself;
 * the only fact that completes a Job is still the pull request GitHub can be
 * asked about (docs/adr/0015).
 *
 * The second component with a timer, after Reconciliation, and for
 * Reconciliation's own reason: what is being waited for happens somewhere
 * Handella cannot hear. Seconds rather than minutes because a Handler who has
 * just typed "go" is looking at the dashboard now, and a pass costs one `stat`
 * per followed Job.
 */
export interface SessionWatch {
  /** Runs a pass now, then every `sessionWatchIntervalMs`. */
  start(): void
  stop(): void
  /** Resolves once nothing this component started is still running. */
  whenIdle(): Promise<void>
  /**
   * A pass of Handella's has begun on this Job, so the session is not the
   * Handler's to read until it ends.
   */
  passStarted(jobId: string): void
  /**
   * The pass is over. Everything the rollout has by now is Handella's own
   * turn, so the offset is moved past it: whatever is appended afterwards is
   * the Handler typing (docs/adr/0015).
   */
  passEnded(jobId: string): Promise<void>
  /** One pass, for a test that would rather not wait for the timer. */
  pass(): Promise<void>
}

interface SessionWatchLogger {
  error(context: Record<string, unknown>, message: string): void
  warn(context: Record<string, unknown>, message: string): void
}

interface SessionWatchOptions {
  codexSessions: CodexSessions
  logger?: SessionWatchLogger
  pullRequests: PullRequestCheck
  store: Store
}

/** The states whose session is worth reading, and what reading it can do. */
const followedStates: readonly JobState[] = [
  'planning',
  'planReview',
  'implementing',
]

/**
 * A Job with somewhere for Codex to have been working. Every question this
 * component asks — locate the rollout, verify the pull request — needs one.
 */
const inAWorktree = (job: Job): job is StartableJob => job.worktreePath !== null

export function createSessionWatch(options: SessionWatchOptions): SessionWatch {
  const { codexSessions, logger, pullRequests, store } = options

  let timer: NodeJS.Timeout | undefined
  let stopped = false
  /** A pass already running, so a timer tick never overlaps one. */
  let running = false
  const work = createWorkTracker()
  /**
   * The Jobs a pass of Handella's is running on. Not read from the database:
   * what makes a turn Handella's is that this process is taking it, and the
   * fence has to close the moment the pass starts rather than a write later.
   */
  const live = new Set<string>()

  const askHandler = (jobId: string, title: string, body: string): void => {
    try {
      store.requestHandlerInput({ body, jobId, title })
    } catch (error) {
      logger?.error({ err: error, jobId }, 'Could not ask the Handler to look')
    }
  }

  /**
   * Where the rollout is, and the bookkeeping for when it cannot be found.
   *
   * Looked for again on every pass rather than trusted once: a session the
   * Handler archives moves, and one Handella has just started may not have
   * been written yet. Only a file that stays missing for the grace period is
   * called lost, and even then the looking continues.
   */
  const locate = async (
    job: Job,
    watch: SessionWatchRecord | undefined,
    sessionId: string,
  ): Promise<string | null> => {
    const path = await codexSessions.locateRollout(sessionId)
    if (path !== null) {
      if (watch?.missingSince != null) {
        store.advanceSessionWatch({
          jobId: job.id,
          missingSince: null,
          rolloutPath: path,
          status: 'following',
        })
      }
      return path
    }

    const missingSince = watch?.missingSince ?? new Date()
    const missingFor = Date.now() - missingSince.getTime()
    const lost = missingFor >= rolloutSearchGraceMs

    store.advanceSessionWatch({
      jobId: job.id,
      missingSince,
      status: lost ? 'lost' : (watch?.status ?? 'following'),
    })

    if (lost && watch?.status !== 'lost') {
      logger?.warn(
        { jobId: job.id, sessionId },
        'Could not find the rollout for a Codex session',
      )
      askHandler(
        job.id,
        'Handella cannot follow this session',
        'Handella can no longer find the file Codex writes this session to, so it will not notice what happens in the terminal. The session itself is unaffected: open it and carry on, and move the job by hand when you are done.',
      )
    }

    return null
  }

  /**
   * What the Handler did, turn by turn, applied to the Job they did it to.
   *
   * The state is carried rather than re-read because one chunk can hold a
   * whole approval: files start changing, the turn ends, and the pull request
   * is already open by the time Handella looks.
   */
  const apply = async (
    job: StartableJob,
    events: readonly RolloutEvent[],
  ): Promise<void> => {
    let state: JobState = job.state

    for (const event of events) {
      if (stopped) return

      // The plan was made in the terminal rather than by a pass of Handella's,
      // which is what a held Job's first turn is.
      if (state === 'planning' && event.kind === 'turnCompleted') {
        store.transitionJob({
          actor: 'system',
          expectedState: 'planning',
          jobId: job.id,
          reason: 'The session planned in the terminal',
          to: 'planReview',
        })
        state = 'planReview'
        continue
      }

      // Codex writing in the worktree while the Job waits for an answer is the
      // Handler having given one. Deliberately not "any turn": the ordinary
      // turn in `planReview` is a question about the plan, and calling that an
      // approval would say a Job was implementing with nothing implemented.
      if (state === 'planReview' && event.kind === 'fileChanged') {
        store.beginImplementationFromTerminal({ jobId: job.id })
        state = 'implementing'
        continue
      }

      // The safety net under that rule: an implementation that wrote through a
      // shell rather than a patch produces no file change Handella can see, so
      // the pull request is what gives it away.
      if (state === 'planReview' && event.kind === 'turnCompleted') {
        const verdict = await pullRequests.verify(job)
        if (verdict.url === null) continue

        store.beginImplementationFromTerminal({ jobId: job.id })
        store.openPullRequest({ jobId: job.id, url: verdict.url })
        state = 'prOpen'
        continue
      }

      // The Handler is back in a session Handella had asked them to look at.
      if (state === 'implementing' && event.kind === 'turnStarted') {
        store.resolveHandlerInput(job.id)
        continue
      }

      if (state === 'implementing' && event.kind === 'turnCompleted') {
        let verdict
        try {
          verdict = await pullRequests.verify(job)
        } catch (error) {
          askHandler(
            job.id,
            'Implementation needs you',
            `A turn ended in this session, but Handella could not check whether a pull request exists: ${messageOf(error)}`,
          )
          continue
        }

        if (verdict.url !== null) {
          store.openPullRequest({ jobId: job.id, url: verdict.url })
          state = 'prOpen'
          continue
        }

        askHandler(
          job.id,
          'Implementation needs you',
          `${verdict.reason}\n\nThe turn in this session ended without one. Carry on in the terminal; Handella is following the session and moves the job when the pull request is open.`,
        )
        continue
      }
    }
  }

  /** One Job whose session Handella is reading. */
  const follow = async (
    job: StartableJob,
    watch: SessionWatchRecord | undefined,
  ): Promise<void> => {
    const sessionId = job.codexSessionId
    if (sessionId === null) return

    const path = await locate(job, watch, sessionId)
    if (path === null) return

    const offset = watch?.rolloutPath === path ? watch.byteOffset : 0
    const chunk = await codexSessions.readFrom(path, offset)

    if (chunk.truncated) {
      // Not the file that offset was measured against. Reading it from the
      // start is safe by construction: every move below is guarded by the
      // Job's current state, the pull request is verified against GitHub, and
      // an item that is already open is not raised twice.
      logger?.warn(
        { jobId: job.id, path },
        'A rollout was shorter than Handella had already read; reading it again',
      )
      store.advanceSessionWatch({
        jobId: job.id,
        byteOffset: 0,
        rolloutPath: path,
        status: 'following',
      })
      return
    }

    if (chunk.lines.length === 0) {
      if (watch?.rolloutPath !== path || watch.status !== 'following') {
        store.advanceSessionWatch({
          jobId: job.id,
          byteOffset: chunk.nextOffset,
          rolloutPath: path,
          status: 'following',
        })
      }
      return
    }

    await apply(job, readRolloutEvents(chunk.lines))

    // After the events, so a pass that threw halfway reads them again rather
    // than skipping them. Everything they do is safe to do twice.
    store.advanceSessionWatch({
      jobId: job.id,
      byteOffset: chunk.nextOffset,
      rolloutPath: path,
      status: 'following',
    })
  }

  /**
   * A Job held for the Handler to plan, waiting for them to open a session in
   * its worktree. What Handella is looking for is an interactive session it
   * did not start, in that directory, since the hold began.
   */
  const discover = async (
    job: StartableJob,
    watch: SessionWatchRecord | undefined,
  ): Promise<void> => {
    const since = watch?.createdAt ?? job.updatedAt
    const [session] = await codexSessions.discoverSessions({
      cwd: job.worktreePath,
      since: new Date(since),
    })
    if (session === undefined) return

    store.adoptDiscoveredSession({
      jobId: job.id,
      rolloutPath: session.path,
      sessionId: session.sessionId,
    })
  }

  const pass = async (): Promise<void> => {
    if (running || stopped) return
    running = true

    try {
      const jobs = store.listJobs()
      const watches = new Map(
        store.listSessionWatches().map((watch) => [watch.jobId, watch]),
      )

      for (const job of jobs) {
        if (stopped) return
        // A stopped Job is one the Handler is holding: whatever is in its
        // session is theirs to finish, and the offset waits where it is.
        if (job.suspension !== null) continue
        // A pass of Handella's is writing this session right now.
        if (live.has(job.id)) continue
        if (!followedStates.includes(job.state)) continue
        if (!inAWorktree(job)) continue

        const watch = watches.get(job.id)

        try {
          if (job.codexSessionId === null) {
            if (job.hold !== null) await discover(job, watch)
            continue
          }

          if (!codexSessions.available) {
            askHandler(
              job.id,
              'Handella cannot follow this session',
              'This Codex keeps no session files where Handella reads them, so it will not notice what happens in the terminal. The session itself is unaffected: open it and carry on, and move the job by hand when you are done.',
            )
            continue
          }

          await follow(job, watch)
        } catch (error) {
          // One Job's failure is not the pass's: the next Job is still worth
          // reading, and this one is read again in three seconds.
          logger?.error(
            { err: error, jobId: job.id },
            'Could not follow a Codex session',
          )
        }
      }
    } catch (error) {
      logger?.error({ err: error }, 'Session watch pass failed')
    } finally {
      running = false
    }
  }

  return {
    pass,

    passStarted(jobId) {
      live.add(jobId)
    },

    async passEnded(jobId) {
      try {
        const job = store.getJob(jobId)
        const sessionId = job.codexSessionId
        if (sessionId === null) return

        const path = await codexSessions.locateRollout(sessionId)
        if (path === null) return

        // Everything written so far is Handella's own turn. Reading it would
        // find file changes and a completed turn and call them the Handler's,
        // which is the one thing this component must never do.
        const { nextOffset } = await codexSessions.readFrom(path, 0)
        store.advanceSessionWatch({
          jobId,
          byteOffset: nextOffset,
          rolloutPath: path,
          status: 'following',
        })
      } catch (error) {
        // The fence failed to close, so the pass's own lines will be read as
        // the Handler's. Every move they could make is guarded by the Job's
        // state and verified against GitHub, so what this costs is a wasted
        // read rather than a wrong answer.
        logger?.warn(
          { err: error, jobId },
          'Could not record where Handella’s own turn ended in the session',
        )
      } finally {
        live.delete(jobId)
      }
    },

    start() {
      if (timer !== undefined) return
      stopped = false

      // One pass now: a Handler who approved in the terminal while Handella
      // was down has been waiting longer than anyone.
      work.track(pass())

      timer = setInterval(() => work.track(pass()), sessionWatchIntervalMs)
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
