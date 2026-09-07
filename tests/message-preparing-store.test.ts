import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArkmeMessagePreparingStore } from '../src/client/message-preparing-store.js'

function hint(overrides = {}) {
  return { type: 'message-preparing' as const, revision: 1, sourceKey: 'one', actorKey: 'actor',
    avatarRef: 'image-ref', prepareAtMillis: 100_000, expireAtMillis: 105_000,
    preparingState: 1 as const, stateVersion: 100_000, eventAtMillis: 100_000,
    chatConnectionGeneration: 1, chatRevision: 1, ...overrides }
}
function setup() { const store = new ArkmeMessagePreparingStore(); store.activateAccount('prod:1'); return store }
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(100_000) })
afterEach(() => { vi.useRealTimers() })

describe('short-lived message preparing projection', () => {
  it('expires without a new event and isolates source and actor identities', async () => {
    const store = setup(); const notify = vi.fn(); store.subscribe(notify)
    store.apply(hint()); store.apply(hint({ sourceKey: 'two' })); store.apply(hint({ actorKey: 'other' }))
    expect(store.get('one')).toHaveLength(2)
    expect(store.get('two')).toHaveLength(1)
    const notifications = notify.mock.calls.length
    await vi.advanceTimersByTimeAsync(5000)
    expect(store.get('one')).toEqual([])
    expect(notify.mock.calls.length).toBeGreaterThan(notifications)
    store.reset()
  })
  it('rejects duplicates and older versions; a cancel wins a tied version', () => {
    const store = setup(); store.apply(hint())
    const revision = store.getSnapshot()
    store.apply(hint()); store.apply(hint({ stateVersion: 99_999 }))
    expect(store.getSnapshot()).toBe(revision)
    store.apply(hint({ preparingState: 2, expireAtMillis: 100_000 }))
    expect(store.get('one')).toEqual([])
    store.apply(hint({ eventAtMillis: 100_001 }))
    expect(store.get('one')).toEqual([])
    store.apply(hint({ stateVersion: 100_002, prepareAtMillis: 100_002, eventAtMillis: 100_002 }))
    expect(store.get('one')).toHaveLength(1)
    store.reset()
  })
  it('clears only the arriving message actor and fences delayed earlier starts', () => {
    const store = setup(); store.apply(hint()); store.apply(hint({ actorKey: 'other' }))
    store.messageArrived({ type: 'message-arrived', revision: 2, sourceKey: 'one', actorKey: 'actor', eventAtMillis: 100_001,
      chatConnectionGeneration: 1, chatRevision: 2 })
    store.apply(hint())
    expect(store.get('one').map(entry => entry.actorKey)).toEqual(['other'])
    store.reset()
  })
  it('clears observed input without treating message send times as preparing versions', () => {
    const store = setup()
    store.apply(hint({ stateVersion: 110_000, prepareAtMillis: 110_000, expireAtMillis: 115_000 }))
    store.messageArrived({ type: 'message-arrived', revision: 2, sourceKey: 'one', actorKey: 'actor', eventAtMillis: 100_100,
      chatConnectionGeneration: 1, chatRevision: 2 })
    expect(store.get('one')).toEqual([])
    store.apply(hint({ stateVersion: 110_000, prepareAtMillis: 110_000, expireAtMillis: 115_000, eventAtMillis: 100_050 }))
    expect(store.get('one')).toEqual([])
    store.apply(hint({ chatRevision: 3, stateVersion: 110_200, prepareAtMillis: 110_200,
      expireAtMillis: 115_200, eventAtMillis: 100_200 }))
    expect(store.get('one')).toHaveLength(1)
    store.messageArrived({ type: 'message-arrived', revision: 3, sourceKey: 'one', actorKey: 'unseen', eventAtMillis: 100_100,
      chatConnectionGeneration: 1, chatRevision: 3 })
    // A later Chat observation may start again even when its independent device timestamp is lower.
    store.apply(hint({ actorKey: 'unseen', chatRevision: 4, stateVersion: 99_000,
      prepareAtMillis: 99_000, expireAtMillis: 104_000, eventAtMillis: 100_200 }))
    expect(store.get('one')).toHaveLength(2)
    store.reset()
  })
  it('uses Chat stream order instead of Browser delivery revision while keeping actor isolation', () => {
    const store = setup()
    store.apply(hint({ revision: 3, chatRevision: 3, actorKey: 'actor' }))
    store.apply(hint({ revision: 3, chatRevision: 3, actorKey: 'other' }))
    store.messageArrived({ type: 'message-arrived', revision: 4, sourceKey: 'one', actorKey: 'actor', eventAtMillis: 200_000,
      chatConnectionGeneration: 1, chatRevision: 2 })
    expect(store.get('one').map(entry => entry.actorKey).sort()).toEqual(['actor', 'other'])
    store.messageArrived({ type: 'message-arrived', revision: 2, sourceKey: 'one', actorKey: 'actor', eventAtMillis: 1,
      chatConnectionGeneration: 1, chatRevision: 4 })
    expect(store.get('one').map(entry => entry.actorKey)).toEqual(['other'])
    for (const chatRevision of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      store.messageArrived({ type: 'message-arrived', revision: 4, sourceKey: 'one', actorKey: 'other', eventAtMillis: 100_001,
        chatConnectionGeneration: 1, chatRevision })
    }
    expect(store.get('one').map(entry => entry.actorKey)).toEqual(['other'])
    store.messageArrived({ type: 'message-arrived', revision: 1, sourceKey: 'one', actorKey: 'other', eventAtMillis: 1,
      chatConnectionGeneration: 2, chatRevision: 1 })
    expect(store.get('one')).toEqual([])
    store.reset()
  })
  it('clears on account changes and reconnect reset; logged-out events are ignored', () => {
    const store = setup(); store.apply(hint()); store.activateAccount('test:1')
    expect(store.get('one')).toEqual([])
    store.apply(hint()); store.reset(); expect(store.get('one')).toEqual([])
    store.activateAccount(undefined); store.apply(hint()); expect(store.get('one')).toEqual([])
  })
  it('ignores malformed and expired hints and bounds hostile long expiry and entry volume', async () => {
    const store = setup()
    store.apply(hint({ expireAtMillis: 99_999 })); store.apply(hint({ actorKey: '' }))
    store.apply(hint({ chatConnectionGeneration: 0 })); store.apply(hint({ chatRevision: 0 }))
    expect(store.get('one')).toEqual([])
    for (let i = 0; i < 600; i++) store.apply(hint({ actorKey: `actor-${i}`, expireAtMillis: 1_000_000 }))
    expect(store.get('one').length).toBeLessThanOrEqual(256)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(store.get('one')).toEqual([])
    store.reset()
  })
})
