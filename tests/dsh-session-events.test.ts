import { describe, expect, it } from 'vitest'
import { readSessionEvents } from '../src/dsh-session-events.js'

describe('DSH session event reader', () => {
  it('reads a fresh snapshot on every access with its session receiver', () => {
    let reads = 0
    const session = {
      snapshotEvents() {
        expect(this).toBe(session)
        reads++
        return []
      },
      get events(): never { throw new Error('legacy events must not be accessed') },
    }
    readSessionEvents(session)
    readSessionEvents(session)
    expect(reads).toBe(2)
  })

  it('supports the declared older host event contract', () => {
    const events: never[] = []
    expect(readSessionEvents({ events })).toBe(events)
  })

  it('fails closed when no event contract is available', () => {
    expect(() => readSessionEvents({})).toThrow('无法核验用户输入')
  })

  it('propagates snapshot failures instead of falling back to stale events', () => {
    expect(() => readSessionEvents({ events: [], snapshotEvents() { throw new Error('snapshot failed') } }))
      .toThrow('snapshot failed')
  })
})
