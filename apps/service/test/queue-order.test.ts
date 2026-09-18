import { afterEach, describe, expect, it } from 'vitest'

import {
  aDispatchedQueue,
  buildTestApp,
  cleanupTestContexts,
} from './helpers.js'

afterEach(cleanupTestContexts)

describe('reordering the queue', () => {
  it('numbers the list it was given, from one', async () => {
    const { context, store } = await buildTestApp()
    const [first, second, third] = await aDispatchedQueue(context, 3)

    store.reorderQueue([third ?? '', first ?? '', second ?? ''])

    expect(store.getJob(third ?? '').queuePriority).toBe(1)
    expect(store.getJob(first ?? '').queuePriority).toBe(2)
    expect(store.getJob(second ?? '').queuePriority).toBe(3)
  })

  it('drops the position of a queued job left out of the list', async () => {
    const { context, store } = await buildTestApp()
    const [first, second] = await aDispatchedQueue(context, 2)
    store.reorderQueue([first ?? '', second ?? ''])

    store.reorderQueue([second ?? ''])

    expect(store.getJob(second ?? '').queuePriority).toBe(1)
    // Left out means unordered, not left where it was: a stale position would
    // let it jump the job the Handler just put first.
    expect(store.getJob(first ?? '').queuePriority).toBeNull()
  })

  it('stays silent when the order it was given is the order already held', async () => {
    const { context, store } = await buildTestApp()
    const [first, second] = await aDispatchedQueue(context, 2)
    store.reorderQueue([first ?? '', second ?? ''])
    context.published.length = 0

    const queue = store.reorderQueue([first ?? '', second ?? ''])

    // The queue still comes back; nothing moved, so nothing is announced and
    // the dashboard's lists are left alone.
    expect(queue.map((job) => job.id)).toEqual([first, second])
    expect(context.published).toEqual([])
  })

  it('answers with the queue in its new order', async () => {
    const { context, store } = await buildTestApp()
    const [first, second, third] = await aDispatchedQueue(context, 3)

    const queue = store.reorderQueue([third ?? '', first ?? '', second ?? ''])

    expect(queue.map((job) => job.id)).toEqual([third, first, second])
  })

  it('refuses a job that is not waiting for a slot', async () => {
    const { context, store } = await buildTestApp()
    const [queued] = await aDispatchedQueue(context, 1)
    const intakeJob = store.createJob({
      source: 'adhoc',
      title: 'Not dispatched',
      workClass: 'routine',
      baseBranch: 'dev',
    })

    expect(() => store.reorderQueue([queued ?? '', intakeJob.id])).toThrowError(
      /not in the queue/,
    )
  })

  it('refuses a job that does not exist at all', async () => {
    const { store } = await buildTestApp()

    expect(() =>
      store.reorderQueue(['00000000-0000-4000-8000-000000000000']),
    ).toThrowError(/No job with id/)
  })
})

describe('POST /api/queue/order', () => {
  it('answers with the jobs it moved', async () => {
    const { app, context } = await buildTestApp()
    const [first, second] = await aDispatchedQueue(context, 2)

    const response = await app.inject({
      method: 'POST',
      url: '/api/queue/order',
      payload: { jobIds: [second, first] },
    })

    expect(response.statusCode).toBe(200)
    expect(
      response
        .json()
        .map((job: { queuePriority: number }) => job.queuePriority),
    ).toEqual([1, 2])
  })

  it('refuses an empty list rather than silently clearing the queue', async () => {
    const { app } = await buildTestApp()

    const response = await app.inject({
      method: 'POST',
      url: '/api/queue/order',
      payload: { jobIds: [] },
    })

    expect(response.statusCode).toBe(400)
  })
})
