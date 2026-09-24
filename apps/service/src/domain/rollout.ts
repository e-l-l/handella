/**
 * What a Codex session's rollout says happened, in Handella's own vocabulary.
 *
 * Pure, and deliberately small: Codex owns this format and adds to it, so the
 * only defence against that is to name the handful of records Handella acts on
 * and skip everything else — the reasoning, the token counts, the world state,
 * and whatever the next version writes. A line that does not parse is skipped
 * for the same reason the Codex adapter skips one: the file is being appended
 * to while it is read (docs/adr/0015).
 */
export type RolloutEvent =
  | { kind: 'turnStarted'; turnId: string | null }
  | {
      kind: 'turnCompleted'
      lastAgentMessage: string | null
      turnId: string | null
    }
  /** Codex edited the worktree, which is what telling it to go looks like. */
  | { kind: 'fileChanged'; turnId: string | null }
  | { kind: 'userMessage'; turnId: string | null }

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined

const stringOrNull = (value: unknown): string | null =>
  typeof value === 'string' ? value : null

/**
 * Item types compared with their spelling flattened.
 *
 * The rollout writes `FileChange` where the `--json` stream of the same Codex
 * writes `file_change`, and neither spelling is Handella's to insist on. Both
 * come here as `filechange`, and a third would too.
 */
const flattened = (value: unknown): string =>
  typeof value === 'string' ? value.toLowerCase().replace(/[_-]/g, '') : ''

const eventFrom = (line: string): RolloutEvent | undefined => {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return undefined
  }

  const record = asRecord(parsed)
  // `response_item`, `turn_context`, `session_meta` and the rest say what the
  // session is rather than what it did.
  if (record?.['type'] !== 'event_msg') return undefined

  const payload = asRecord(record['payload'])
  if (payload === undefined) return undefined

  const turnId = stringOrNull(payload['turn_id'])

  switch (payload['type']) {
    case 'task_started':
      return { kind: 'turnStarted', turnId }
    case 'task_complete':
      return {
        kind: 'turnCompleted',
        lastAgentMessage: stringOrNull(payload['last_agent_message']),
        turnId,
      }
    case 'item_completed': {
      const item = asRecord(payload['item'])
      const type = flattened(item?.['type'])
      if (type === 'filechange') return { kind: 'fileChanged', turnId }
      if (type === 'usermessage') return { kind: 'userMessage', turnId }
      return undefined
    }
    default:
      return undefined
  }
}

export const readRolloutEvents = (lines: readonly string[]): RolloutEvent[] =>
  lines
    .map((line) => eventFrom(line))
    .filter((event): event is RolloutEvent => event !== undefined)
