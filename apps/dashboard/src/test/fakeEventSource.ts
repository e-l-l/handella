import { vi } from 'vitest'

type Listener = (event: MessageEvent) => void

/**
 * jsdom ships no EventSource, so the hook under test needs one to attach to.
 * This is the transport, not the hook: the invalidation logic stays under test.
 */
export class FakeEventSource {
  static instances: FakeEventSource[] = []

  readonly url: string
  closed = false
  private readonly listeners = new Map<string, Listener[]>()

  constructor(url: string) {
    this.url = url
    FakeEventSource.instances.push(this)
  }

  addEventListener(name: string, listener: Listener): void {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener])
  }

  close(): void {
    this.closed = true
  }

  emit(name: string, data: unknown = {}): void {
    for (const listener of this.listeners.get(name) ?? []) {
      listener(new MessageEvent(name, { data: JSON.stringify(data) }))
    }
  }
}

export function installFakeEventSource(): void {
  FakeEventSource.instances = []
  vi.stubGlobal('EventSource', FakeEventSource)
}

export const latestEventSource = (): FakeEventSource => {
  const source = FakeEventSource.instances.at(-1)
  if (source === undefined) {
    throw new Error('The dashboard never opened an event stream')
  }
  return source
}
