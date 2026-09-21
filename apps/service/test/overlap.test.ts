import { maxConcurrency, type PlanContent } from '@handella/contracts'
import { afterEach, describe, expect, it } from 'vitest'

import { plannedPaths, sharedPaths } from '../src/domain/overlap.js'
import {
  aDispatchedQueue,
  aPlanContent,
  cleanupTestContexts,
  createTestContext,
  type TestContext,
} from './helpers.js'

afterEach(cleanupTestContexts)

/** A plan that says it will touch exactly these paths. */
const aPlanTouching = (...files: string[]): PlanContent =>
  aPlanContent({
    steps: [
      {
        id: 'do-the-thing',
        title: 'Do the thing',
        detail: 'The thing that touches these files.',
        files,
        required: true,
      },
    ],
  })

/** Takes a Job all the way to an approved plan naming `files`. */
const anApprovalTouching = async (
  context: TestContext,
  jobId: string,
  ...files: string[]
): Promise<void> => {
  context.store.transitionJob({ actor: 'system', jobId, to: 'planning' })
  context.store.recordCodexSession({ jobId, sessionId: `session-${jobId}` })
  const version = context.store.createPlanVersion({
    content: aPlanTouching(...files),
    jobId,
  })
  context.store.transitionJob({ actor: 'system', jobId, to: 'planReview' })
  context.store.approvePlan({ jobId, planVersionId: version.id })
}

const overlapItems = (context: TestContext) =>
  context.store
    .listAttentionItems()
    .filter((item) => item.kind === 'overlapWarning')

describe('the paths a plan names', () => {
  it('reads one spelling of a path out of every spelling of it', () => {
    expect([
      ...plannedPaths(
        aPlanTouching('./src/store.ts', 'src/store.ts', 'src/./store.ts'),
      ),
    ]).toEqual(['src/store.ts'])
  })

  it('drops what is not a path at all', () => {
    expect([...plannedPaths(aPlanTouching('', '  ', '.', './'))]).toEqual([])
  })

  it('answers with the shared paths in a stable order', () => {
    const mine = plannedPaths(aPlanTouching('b.ts', 'a.ts', 'c.ts'))
    const theirs = plannedPaths(aPlanTouching('c.ts', 'a.ts'))

    expect(sharedPaths(mine, theirs)).toEqual(['a.ts', 'c.ts'])
  })

  it('keeps case, because the repository is not only read on this machine', () => {
    const mine = plannedPaths(aPlanTouching('src/Store.ts'))
    const theirs = plannedPaths(aPlanTouching('src/store.ts'))

    expect(sharedPaths(mine, theirs)).toEqual([])
  })
})

describe('warning about overlap', () => {
  it('warns the second job about the first, naming both and the paths', async () => {
    const context = createTestContext()
    const [first, second] = await aDispatchedQueue(context, 2)
    if (first === undefined || second === undefined) throw new Error('no jobs')

    await anApprovalTouching(context, first, 'src/store.ts', 'src/only-mine.ts')
    await anApprovalTouching(context, second, 'src/store.ts', 'src/theirs.ts')

    const items = overlapItems(context)
    expect(items).toHaveLength(1)
    // Raised against the job that approved second: the first had nothing to
    // overlap with when it was approved.
    expect(items[0]?.jobId).toBe(second)
    expect(items[0]?.body).toContain('ENG-0')
    expect(items[0]?.body).toContain('src/store.ts')
    // Only what is shared. A path one plan names alone is not an overlap.
    expect(items[0]?.body).not.toContain('src/only-mine.ts')
    expect(items[0]?.body).not.toContain('src/theirs.ts')
  })

  it('says nothing when two plans touch different files', async () => {
    const context = createTestContext()
    const [first, second] = await aDispatchedQueue(context, 2)
    if (first === undefined || second === undefined) throw new Error('no jobs')

    await anApprovalTouching(context, first, 'src/store.ts')
    await anApprovalTouching(context, second, 'src/scheduler.ts')

    expect(overlapItems(context)).toEqual([])
  })

  it('does not count a job whose plan is only proposed', async () => {
    const context = createTestContext()
    const [first, second] = await aDispatchedQueue(context, 2)
    if (first === undefined || second === undefined) throw new Error('no jobs')

    // Planned and waiting for the Handler rather than approved. What a Job
    // will execute is what was approved, and nothing has been.
    context.store.transitionJob({
      actor: 'system',
      jobId: first,
      to: 'planning',
    })
    context.store.createPlanVersion({
      content: aPlanTouching('src/store.ts'),
      jobId: first,
    })
    context.store.transitionJob({
      actor: 'system',
      jobId: first,
      to: 'planReview',
    })

    await anApprovalTouching(context, second, 'src/store.ts')

    expect(overlapItems(context)).toEqual([])
  })

  it('does not count a job that has settled', async () => {
    const context = createTestContext()
    const [first, second] = await aDispatchedQueue(context, 2)
    if (first === undefined || second === undefined) throw new Error('no jobs')

    await anApprovalTouching(context, first, 'src/store.ts')
    for (const to of ['implementing', 'prOpen', 'merged'] as const) {
      context.store.transitionJob({ actor: 'handler', jobId: first, to })
    }

    await anApprovalTouching(context, second, 'src/store.ts')

    expect(overlapItems(context)).toEqual([])
  })

  it('resolves the warning once the overlapping work has merged', async () => {
    const context = createTestContext()
    const [first, second] = await aDispatchedQueue(context, 2)
    if (first === undefined || second === undefined) throw new Error('no jobs')

    await anApprovalTouching(context, first, 'src/store.ts')
    await anApprovalTouching(context, second, 'src/store.ts')
    expect(overlapItems(context)).toHaveLength(1)

    context.store.transitionJob({
      actor: 'system',
      jobId: second,
      to: 'implementing',
    })
    context.store.openPullRequest({
      jobId: second,
      url: 'https://github.com/acme/monorepo/pull/9',
    })
    context.store.confirmMerge({ jobId: second })

    // It was a warning about what that job was going to touch, and it has.
    expect(overlapItems(context)).toEqual([])
  })

  it('never serialises the jobs it warns about', async () => {
    const context = createTestContext()
    const ids = await aDispatchedQueue(context, maxConcurrency)

    for (const jobId of ids) {
      await anApprovalTouching(context, jobId, 'src/store.ts')
    }

    // Every job overlaps every other, and all three are still startable: the
    // scheduler is never told about an overlap, which is what makes
    // masterplan.md:56 structural rather than a rule to remember.
    expect(overlapItems(context)).toHaveLength(ids.length - 1)
    expect(
      context.store.listJobs().filter((job) => job.state === 'approved'),
    ).toHaveLength(maxConcurrency)
  })
})
