import { describe, expect, it } from 'vitest'

import { readRolloutEvents } from '../src/domain/rollout.js'
import { rolloutLines } from './codex-sessions-fake.js'

describe('reading a rollout', () => {
  it('reads the four records Handella acts on', () => {
    expect(
      readRolloutEvents([
        rolloutLines.turnStarted('t1'),
        rolloutLines.userMessage('t1'),
        rolloutLines.fileChanged('t1'),
        rolloutLines.turnCompleted('t1', 'Opened the pull request.'),
      ]),
    ).toEqual([
      { kind: 'turnStarted', turnId: 't1' },
      { kind: 'userMessage', turnId: 't1' },
      { kind: 'fileChanged', turnId: 't1' },
      {
        kind: 'turnCompleted',
        lastAgentMessage: 'Opened the pull request.',
        turnId: 't1',
      },
    ])
  })

  it('reads an item type however Codex spells it', () => {
    // The rollout writes `FileChange` where the `--json` stream of the same
    // Codex writes `file_change`, and neither spelling is Handella's.
    const spellings = ['FileChange', 'file_change', 'filechange'].map((type) =>
      JSON.stringify({
        payload: { item: { type }, turn_id: 't1', type: 'item_completed' },
        type: 'event_msg',
      }),
    )

    expect(readRolloutEvents(spellings)).toHaveLength(3)
  })

  it('skips what the session is rather than what it did', () => {
    const noise = [
      JSON.stringify({
        payload: { cwd: '/repo', id: 's1' },
        type: 'session_meta',
      }),
      JSON.stringify({ payload: { turn_id: 't1' }, type: 'turn_context' }),
      JSON.stringify({
        payload: { role: 'assistant', type: 'message' },
        type: 'response_item',
      }),
      JSON.stringify({ payload: { type: 'token_count' }, type: 'event_msg' }),
      JSON.stringify({ payload: {}, type: 'world_state' }),
      // A type nobody has written yet, which is the case this is really about.
      JSON.stringify({ payload: { type: 'something_new' }, type: 'event_msg' }),
    ]

    expect(readRolloutEvents(noise)).toEqual([])
  })

  it('skips a line it cannot parse rather than losing the chunk', () => {
    // The file is appended to while it is read, and a half-written line is
    // the ordinary case rather than corruption.
    expect(
      readRolloutEvents([
        'not json at all',
        '{"type":"event_msg","payload":{"type":"task_sta',
        rolloutLines.turnCompleted('t1'),
      ]),
    ).toMatchObject([{ kind: 'turnCompleted' }])
  })

  it('reads an item with no type, and a payload that is not an object, as neither', () => {
    expect(
      readRolloutEvents([
        JSON.stringify({ payload: 'nope', type: 'event_msg' }),
        JSON.stringify({
          payload: { item: null, turn_id: 't1', type: 'item_completed' },
          type: 'event_msg',
        }),
      ]),
    ).toEqual([])
  })
})
