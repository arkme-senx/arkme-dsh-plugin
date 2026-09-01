import { describe, expect, it } from 'vitest'
import { ArkmeAttentionSummaryStore } from '../src/client/attention-summary-store.js'

function summary(badgeCount: number, summaryVersion: number) {
  return {
    badgeCount,
    mutedUnreadCount: 0,
    sessionCountWithUnread: badgeCount > 0 ? 1 : 0,
    hasAttention: false,
    summaryVersion,
    updatedAtMillis: summaryVersion,
  }
}

describe('Arkme attention summary store', () => {
  it('accepts a changed same-millisecond summary and rejects older watermarks', () => {
    const store = new ArkmeAttentionSummaryStore()
    store.activateAccount(1)
    store.apply(summary(1, 100))
    store.apply(summary(2, 100))
    store.apply(summary(9, 99))
    expect(store.getSnapshot().summary).toEqual(summary(2, 100))
  })

  it('never carries an old account badge into the next account', () => {
    const store = new ArkmeAttentionSummaryStore()
    store.activateAccount(1)
    store.apply(summary(5, 100))
    store.activateAccount(2)
    expect(store.getSnapshot().ready).toBe(false)
    expect(store.getSnapshot().summary).toBeUndefined()
    store.apply(summary(1, 90))
    expect(store.getSnapshot().summary).toEqual(summary(1, 90))
  })

  it('clears the same numeric user when the environment scope changes', () => {
    const store = new ArkmeAttentionSummaryStore()
    store.activateAccount(1, 'prod:1')
    store.apply(summary(5, 100))
    store.activateAccount(1, 'test:1')
    expect(store.getSnapshot()).toMatchObject({
      ready: false,
      accountUserId: 1,
      accountScope: 'test:1',
    })
    expect(store.getSnapshot().summary).toBeUndefined()
  })
})
