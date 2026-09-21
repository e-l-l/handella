import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { AttentionItemKind } from '@handella/contracts'

import type { Store } from '../src/domain/store.js'
import {
  aCodexProcess,
  aPullRequest,
  aJobAwaitingMerge,
  aGitFailure,
  buildTestApp,
  buildTestReconciler,
  cleanupTestContexts,
  createFakeProcessInspector,
  testRepositoryId,
  type FakeGitAdapter,
  type FakeGitHubAdapter,
  type FakeProcessInspector,
} from './helpers.js'

afterEach(cleanupTestContexts)

/**
 * The whole component over one context: the app is built because the store and
 * the fakes have to be the same ones the merge check is holding, and a
 * Reconciler wired to a second set of fakes would be reconciling a machine no
 * other part of the test can see.
 */
const aReconciliation = async (
  options: {
    /** Held open by the test, for the sweep that follows a SIGTERM. */
    delay?: () => Promise<void>
    processes?: FakeProcessInspector
  } = {},
) => {
  const processes = options.processes ?? createFakeProcessInspector()
  const built = await buildTestApp()

  return {
    ...built,
    git: built.git as FakeGitAdapter,
    github: built.github as FakeGitHubAdapter,
    processes,
    reconciler: buildTestReconciler({
      context: built.context,
      git: built.git,
      mergeCheck: built.mergeCheck,
      processes,
      worktreeRoot: built.worktreeRoot,
      ...(options.delay === undefined ? {} : { delay: options.delay }),
    }),
  }
}

/** The open attention items of one kind, since a Job in `prOpen` has its own. */
const itemsOfKind = (store: Store, kind: AttentionItemKind) =>
  store.listAttentionItems().filter((item) => item.kind === kind)

/** A worktree the way a crash leaves one: on disk, claimed by nobody. */
const anOrphanWorktree = (worktreeRoot: string, name: string): string => {
  const path = join(worktreeRoot, testRepositoryId, name)
  mkdirSync(path, { recursive: true })
  writeFileSync(join(path, '.git'), 'gitdir: /somewhere/.git/worktrees/x\n')
  return path
}

describe('reaping the processes a restart left behind', () => {
  it('kills a process that is still holding what Handella recorded', async () => {
    const { context, processes, reconciler } = await aReconciliation()
    const jobId = await aJobAwaitingMerge(context)
    const record = context.store.startCodexProcess({
      jobId,
      kind: 'implement',
      pid: 4_242,
    })
    processes.processes.set(4_242, aCodexProcess())

    const report = await reconciler.reapProcesses()

    expect(report.killed.map((killed) => killed.pid)).toEqual([4_242])
    expect(processes.terminated).toEqual([{ pid: 4_242, signal: 'SIGTERM' }])
    // Closed, so the next reap does not signal a pid this one finished with.
    expect(context.store.listLiveCodexProcesses()).toEqual([])
    expect(record.endedAt).toBeNull()
  })

  it('kills a process outright when it does not stop when asked', async () => {
    const { context, processes, reconciler } = await aReconciliation()
    const jobId = await aJobAwaitingMerge(context)
    context.store.startCodexProcess({ jobId, kind: 'plan', pid: 4_243 })
    processes.processes.set(4_243, aCodexProcess())

    await reconciler.reapProcesses()
    // The grace period is answered immediately by the test's own `delay`, but
    // the sweep behind it is not awaited by the reap itself.
    await reconciler.whenIdle()

    expect(processes.terminated).toEqual([
      { pid: 4_243, signal: 'SIGTERM' },
      { pid: 4_243, signal: 'SIGKILL' },
    ])
  })

  it('does not kill a process that took the hint', async () => {
    // The grace period is held open by the test rather than answered at once,
    // because what is being asserted happens inside it.
    let release = (): void => {}
    const graced = new Promise<void>((resolve) => {
      release = resolve
    })
    const { context, processes, reconciler } = await aReconciliation({
      delay: () => graced,
    })
    const jobId = await aJobAwaitingMerge(context)
    context.store.startCodexProcess({ jobId, kind: 'plan', pid: 4_244 })
    processes.processes.set(4_244, aCodexProcess())

    await reconciler.reapProcesses()
    // Exited while being asked to, which is the ordinary case.
    processes.processes.delete(4_244)
    release()
    await reconciler.whenIdle()

    expect(processes.terminated).toEqual([{ pid: 4_244, signal: 'SIGTERM' }])
  })

  it('signals nothing when the pid now belongs to something else', async () => {
    const { context, processes, reconciler } = await aReconciliation()
    const jobId = await aJobAwaitingMerge(context)
    context.store.startCodexProcess({ jobId, kind: 'implement', pid: 4_245 })
    processes.processes.set(
      4_245,
      aCodexProcess({ command: '/usr/bin/psql handella_production' }),
    )

    const report = await reconciler.reapProcesses()

    expect(report.reused.map((record) => record.pid)).toEqual([4_245])
    expect(report.killed).toEqual([])
    expect(processes.terminated).toEqual([])
    expect(context.store.listLiveCodexProcesses()).toEqual([])
  })

  it('signals nothing when a codex on that pid started at another time', async () => {
    const { context, processes, reconciler } = await aReconciliation()
    const jobId = await aJobAwaitingMerge(context)
    context.store.startCodexProcess({ jobId, kind: 'implement', pid: 4_246 })
    // A Codex, but not the one Handella spawned: the pid came round again and
    // the Handler happens to be running one of their own.
    processes.processes.set(
      4_246,
      aCodexProcess({ startedAt: new Date(Date.now() - 86_400_000) }),
    )

    const report = await reconciler.reapProcesses()

    expect(report.reused.map((record) => record.pid)).toEqual([4_246])
    expect(processes.terminated).toEqual([])
  })

  it('closes the row of a process that is simply gone', async () => {
    const { context, processes, reconciler } = await aReconciliation()
    const jobId = await aJobAwaitingMerge(context)
    context.store.startCodexProcess({ jobId, kind: 'implement', pid: 4_247 })

    const report = await reconciler.reapProcesses()

    expect(report.killed).toEqual([])
    expect(report.reused).toEqual([])
    expect(processes.terminated).toEqual([])
    expect(context.store.listLiveCodexProcesses()).toEqual([])
  })

  it('carries on past a signal the operating system refused, and keeps that row', async () => {
    const { context, processes, reconciler } = await aReconciliation()
    const jobId = await aJobAwaitingMerge(context)
    const refused = context.store.startCodexProcess({
      jobId,
      kind: 'implement',
      pid: 4_249,
    })
    context.store.startCodexProcess({ jobId, kind: 'implement', pid: 4_250 })
    processes.processes.set(4_249, aCodexProcess())
    processes.processes.set(4_250, aCodexProcess())
    processes.refusals.set(
      4_249,
      Object.assign(new Error('kill EPERM'), { code: 'EPERM' }),
    )

    const report = await reconciler.reapProcesses()
    await reconciler.whenIdle()

    // The reap runs before `listen`, so one refusal escaping it would be a
    // Handella that does not come up — with the leftover still running.
    expect(report.killed.map((record) => record.pid)).toEqual([4_250])
    expect(processes.terminated).toEqual([
      { pid: 4_250, signal: 'SIGTERM' },
      { pid: 4_250, signal: 'SIGKILL' },
    ])
    // Nothing was stopped, so there is still something to find: the row stays
    // open for the next reap to establish identity against again.
    expect(context.store.listLiveCodexProcesses().map((row) => row.id)).toEqual(
      [refused.id],
    )
  })

  it('leaves every row alone when it cannot inspect processes at all', async () => {
    const { context, processes, reconciler } = await aReconciliation()
    const jobId = await aJobAwaitingMerge(context)
    context.store.startCodexProcess({ jobId, kind: 'implement', pid: 4_248 })
    processes.failNextWith = new Error('ps is not installed or is not on PATH')

    await reconciler.reapProcesses()

    // Identity could not be established, so nothing was signalled — and the
    // row stays open, because a row closed blind is a process nothing will
    // ever look for again.
    expect(processes.terminated).toEqual([])
    expect(context.store.listLiveCodexProcesses()).toHaveLength(1)
  })
})

describe('reporting worktrees no job claims', () => {
  it('reports residue on disk and leaves it exactly where it is', async () => {
    const { context, reconciler, worktreeRoot } = await aReconciliation()
    const stray = anOrphanWorktree(worktreeRoot, 'ell/abandoned')

    const report = await reconciler.reconcileWorktrees()

    expect(report.complete).toBe(true)
    expect(report.orphans).toEqual([stray])

    const [item] = context.store.listAttentionItems()
    expect(item?.kind).toBe('orphanWorktree')
    expect(item?.jobId).toBeNull()
    expect(item?.body).toContain(stray)
    // Reported, never removed.
    expect(existsSync(stray)).toBe(true)
  })

  it('does not report a worktree a live job is holding', async () => {
    const built = await aReconciliation()
    await aJobAwaitingMerge(built.context, {
      git: built.git,
      worktreeRoot: built.worktreeRoot,
    })

    const report = await built.reconciler.reconcileWorktrees()

    expect(report.orphans).toEqual([])
    expect(itemsOfKind(built.context.store, 'orphanWorktree')).toEqual([])
  })

  it('does not report the worktree of a job the Handler cancelled', async () => {
    const built = await aReconciliation()
    const jobId = await aJobAwaitingMerge(built.context, {
      git: built.git,
      worktreeRoot: built.worktreeRoot,
    })
    built.context.store.transitionJob({
      actor: 'handler',
      jobId,
      to: 'cancelled',
    })

    const report = await built.reconciler.reconcileWorktrees()

    // The column still names it, which is what makes it residue Handella can
    // account for. An item saying nothing claims it would be false, and no
    // later pass could ever make it true.
    expect(report.orphans).toEqual([])
    expect(itemsOfKind(built.context.store, 'orphanWorktree')).toEqual([])
  })

  it('does not report a worktree the merge was unable to tidy up', async () => {
    const built = await aReconciliation()
    const jobId = await aJobAwaitingMerge(built.context, {
      git: built.git,
      worktreeRoot: built.worktreeRoot,
    })
    const before = built.context.store.getJob(jobId)
    built.git.dirty.add(before.worktreePath ?? '')
    built.github.pullRequests.set(
      before.canonicalBranch ?? '',
      aPullRequest({ state: 'MERGED' }),
    )

    await built.reconciler.checkMerges()
    const report = await built.reconciler.reconcileWorktrees()

    // Already reported, once, as the failure that it is — with the path and
    // the reason the Handler needs. Saying it again in an item about residue
    // nobody claims would be saying it wrong.
    expect(report.orphans).toEqual([])
    expect(itemsOfKind(built.context.store, 'orphanWorktree')).toEqual([])
    expect(itemsOfKind(built.context.store, 'failure')).toHaveLength(1)
  })

  it('reports a worktree git still has registered under Handella’s root', async () => {
    const { git, reconciler, worktreeRoot } = await aReconciliation()
    const path = join(worktreeRoot, testRepositoryId, 'ell/registered')
    git.registered.set('/tmp/handella-test-repository', [
      { branch: 'ell/registered', isMain: false, path },
    ])

    const report = await reconciler.reconcileWorktrees()

    expect(report.orphans).toEqual([path])
    // Stale registrations are git's own metadata, so forgetting them needs
    // nobody's permission.
    expect(git.pruned).toEqual(['/tmp/handella-test-repository'])
  })

  it('leaves a worktree outside its own root to the Handler', async () => {
    const { context, git, reconciler } = await aReconciliation()
    git.registered.set('/tmp/handella-test-repository', [
      { branch: 'spike', isMain: false, path: '/Users/handler/spike' },
    ])

    const report = await reconciler.reconcileWorktrees()

    expect(report.orphans).toEqual([])
    expect(itemsOfKind(context.store, 'orphanWorktree')).toEqual([])
  })

  it('replaces its report when the residue changes and resolves it when it goes', async () => {
    const { context, reconciler, worktreeRoot } = await aReconciliation()
    const first = anOrphanWorktree(worktreeRoot, 'ell/one')

    await reconciler.reconcileWorktrees()
    const [original] = context.store.listAttentionItems()

    // Unchanged, so the item is left alone: this runs on a timer, and a fresh
    // item every pass would be an item whose age meant nothing.
    await reconciler.reconcileWorktrees()
    expect(context.store.listAttentionItems()).toHaveLength(1)
    expect(context.store.listAttentionItems()[0]?.id).toBe(original?.id)

    anOrphanWorktree(worktreeRoot, 'ell/two')
    await reconciler.reconcileWorktrees()
    const replaced = context.store.listAttentionItems()
    expect(replaced).toHaveLength(1)
    expect(replaced[0]?.id).not.toBe(original?.id)
    expect(replaced[0]?.body).toContain(first)

    // Tidied up by hand, and the item goes with it.
    rmSync(join(worktreeRoot, testRepositoryId), {
      force: true,
      recursive: true,
    })
    await reconciler.reconcileWorktrees()
    expect(context.store.listAttentionItems()).toEqual([])
  })

  it('reports nothing at all when a checkout could not be read', async () => {
    const { context, git, reconciler, worktreeRoot } = await aReconciliation()
    anOrphanWorktree(worktreeRoot, 'ell/abandoned')
    git.failNextWith = aGitFailure('fatal: not a git repository')

    const report = await reconciler.reconcileWorktrees()

    // A partial answer is not an answer: half a set would resolve an item
    // about residue that is still there.
    expect(report.complete).toBe(false)
    expect(context.store.listAttentionItems()).toEqual([])
  })
})

describe('confirming a merge', () => {
  const branch = 'ell/eng-0-something'

  it('moves the job to merged and removes its worktree', async () => {
    const built = await aReconciliation()
    const jobId = await aJobAwaitingMerge(built.context, {
      git: built.git,
      worktreeRoot: built.worktreeRoot,
    })
    const before = built.context.store.getJob(jobId)
    built.github.pullRequests.set(branch, aPullRequest({ state: 'MERGED' }))

    await built.reconciler.checkMerges()

    const job = built.context.store.getJob(jobId)
    expect(job.state).toBe('merged')
    // Retained: the branch, the session and the pull request outlive the
    // directory, which is what masterplan.md:69 means by keeping metadata.
    expect(job.canonicalBranch).toBe(branch)
    expect(job.codexSessionId).toBe('session-1')
    expect(job.originalPrUrl).toBe('https://github.com/acme/monorepo/pull/41')
    expect(job.worktreePath).toBeNull()
    expect(built.git.removed).toEqual([before.worktreePath])
    expect(existsSync(before.worktreePath ?? '')).toBe(false)
    // Nothing to tell the Handler: the ready-PR item is resolved by the move
    // to `merged` and the cleanup had nothing to complain about.
    expect(built.context.store.listAttentionItems()).toEqual([])
  })

  it('leaves a job whose pull request is still open exactly where it is', async () => {
    const built = await aReconciliation()
    const jobId = await aJobAwaitingMerge(built.context, {
      git: built.git,
      worktreeRoot: built.worktreeRoot,
    })
    built.github.pullRequests.set(branch, aPullRequest({ state: 'OPEN' }))

    await built.reconciler.checkMerges()

    const job = built.context.store.getJob(jobId)
    expect(job.state).toBe('prOpen')
    expect(job.worktreePath).not.toBeNull()
    expect(built.git.removed).toEqual([])
  })

  it('keeps a worktree that still holds uncommitted work, and says so', async () => {
    const built = await aReconciliation()
    const jobId = await aJobAwaitingMerge(built.context, {
      git: built.git,
      worktreeRoot: built.worktreeRoot,
    })
    const before = built.context.store.getJob(jobId)
    built.git.dirty.add(before.worktreePath ?? '')
    built.github.pullRequests.set(branch, aPullRequest({ state: 'MERGED' }))

    await built.reconciler.checkMerges()

    const job = built.context.store.getJob(jobId)
    // The merge is GitHub's fact either way; what failed is the tidying up.
    expect(job.state).toBe('merged')
    expect(job.worktreePath).toBe(before.worktreePath)
    expect(built.git.removed).toEqual([])

    const [item] = built.context.store.listAttentionItems()
    expect(item?.kind).toBe('failure')
    expect(item?.body).toContain('uncommitted changes')
    expect(item?.body).toContain(before.worktreePath ?? '')
  })

  it('keeps a worktree that has drifted onto another branch, and says so', async () => {
    const built = await aReconciliation()
    const jobId = await aJobAwaitingMerge(built.context, {
      git: built.git,
      worktreeRoot: built.worktreeRoot,
    })
    const before = built.context.store.getJob(jobId)
    built.git.heads.set(before.worktreePath ?? '', 'somebody-elses-branch')
    built.github.pullRequests.set(branch, aPullRequest({ state: 'MERGED' }))

    await built.reconciler.checkMerges()

    expect(built.context.store.getJob(jobId).worktreePath).toBe(
      before.worktreePath,
    )
    expect(built.git.removed).toEqual([])
    expect(built.context.store.listAttentionItems()[0]?.body).toContain(
      'somebody-elses-branch',
    )
  })

  it('keeps a worktree git refused to remove, and says why', async () => {
    const built = await aReconciliation()
    const jobId = await aJobAwaitingMerge(built.context, {
      git: built.git,
      worktreeRoot: built.worktreeRoot,
    })
    built.github.pullRequests.set(branch, aPullRequest({ state: 'MERGED' }))
    // Spent by the removal, which is the last git call the cleanup makes.
    built.git.failNextWith = aGitFailure('fatal: validation failed')

    await built.reconciler.checkMerges()

    expect(built.context.store.getJob(jobId).worktreePath).not.toBeNull()
    expect(built.context.store.listAttentionItems()[0]?.body).toContain(
      'validation failed',
    )
  })

  it('asks once when the Handler and the timer ask at the same moment', async () => {
    const built = await aReconciliation()
    const jobId = await aJobAwaitingMerge(built.context, {
      git: built.git,
      worktreeRoot: built.worktreeRoot,
    })
    built.github.pullRequests.set(branch, aPullRequest({ state: 'MERGED' }))

    const [first, second] = await Promise.all([
      built.mergeCheck.check(jobId),
      built.mergeCheck.check(jobId),
    ])

    // One answer, one removal. Two would have both read a clean worktree and
    // both asked git to remove it, and the slower one would have raised a
    // failure item about work that succeeded.
    expect(second).toBe(first)
    expect(first?.state).toBe('merged')
    expect(built.git.removed).toHaveLength(1)
    expect(itemsOfKind(built.context.store, 'failure')).toEqual([])
  })

  it('leaves a stopped job alone however its pull request ended', async () => {
    const built = await aReconciliation()
    const jobId = await aJobAwaitingMerge(built.context, {
      git: built.git,
      worktreeRoot: built.worktreeRoot,
    })
    built.context.store.suspendJob({
      jobId,
      reason: 'The Handler is looking at it',
      suspension: 'stoppedByHandler',
    })
    built.github.pullRequests.set(branch, aPullRequest({ state: 'MERGED' }))

    await built.reconciler.checkMerges()

    // A stop means leave it alone, and removing the worktree because the
    // branch happened to land is the opposite of that.
    expect(built.context.store.getJob(jobId).state).toBe('prOpen')
    expect(built.git.removed).toEqual([])
    expect(built.github.asked).toEqual([])
  })

  it('carries on past a job GitHub could not answer for', async () => {
    const built = await aReconciliation()
    const jobId = await aJobAwaitingMerge(built.context, {
      git: built.git,
      worktreeRoot: built.worktreeRoot,
    })
    built.github.findPullRequest = () =>
      Promise.reject(new Error('gh: not logged in'))

    await built.reconciler.checkMerges()

    // Logged rather than raised: a five-minute timer would mint an attention
    // item forever, and the status screen already reports `gh`.
    expect(built.context.store.getJob(jobId).state).toBe('prOpen')
    expect(itemsOfKind(built.context.store, 'failure')).toEqual([])
  })
})
