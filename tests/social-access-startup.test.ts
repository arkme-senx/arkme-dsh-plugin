import { describe, expect, it, vi } from 'vitest'
import { SocialAccessStore } from '../src/client/social-access-store.js'
import { SocialAccessSnapshotStorage } from '../src/client/social-access-snapshot-storage.js'

function storage() {
  const values = new Map<string, string>()
  return { values, getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) } }
}

describe('social presentation startup', () => {
  it.each([true, false])('restores confirmed %s before loading and avoids a redundant render', async allowed => {
    const disk = storage()
    const first = new SocialAccessStore(async () => ({ userId: 7, allowed }), new SocialAccessSnapshotStorage(() => disk))
    first.activate('test:7'); await first.refresh()
    const next = new SocialAccessStore(async () => ({ userId: 7, allowed }), new SocialAccessSnapshotStorage(() => disk))
    next.activate('test:7')
    expect(next.getSnapshot()).toMatchObject({ allowed, resolved: true })
    const listener = vi.fn(); next.subscribe(listener)
    await next.refresh()
    expect(listener).not.toHaveBeenCalled()
  })
  it('account updates supersede an older read and retain the confirmed display until the fresh result', async () => {
    const disk = storage(); const snapshots = new SocialAccessSnapshotStorage(() => disk)
    snapshots.write('test:7', true)
    const reads: Array<(value: { userId: number; allowed: boolean }) => void> = []
    const load = vi.fn(() => new Promise<{ userId: number; allowed: boolean }>(resolve => { reads.push(resolve) }))
    const store = new SocialAccessStore(load, snapshots)
    store.activate('test:7', 1)
    const stale = store.refresh()
    const presentation = store.getSnapshot()
    store.activate('test:7', 2)
    expect(store.getSnapshot()).toBe(presentation)
    const fresh = store.refresh()
    store.activate('test:7', 2)
    expect(store.refresh()).toBe(fresh)
    expect(load).toHaveBeenCalledTimes(2)
    reads[1]!({ userId: 7, allowed: true }); await fresh
    reads[0]!({ userId: 7, allowed: false }); await stale
    expect(store.getSnapshot()).toBe(presentation)
    expect(snapshots.read('test:7')).toBe(true)
  })
  it('isolates accounts/environments, removes on logout and ignores a late owner result', async () => {
    const disk = storage(); const snapshots = new SocialAccessSnapshotStorage(() => disk)
    snapshots.write('test:7', true)
    expect(snapshots.read('prod:7')).toBeNull(); expect(snapshots.read('test:8')).toBeNull()
    let finish!: (value: { userId: number; allowed: boolean }) => void
    const store = new SocialAccessStore(() => new Promise(resolve => { finish = resolve }), snapshots)
    store.activate('test:7'); const pending = store.refresh()
    store.activate(undefined); store.activate('test:8')
    finish({ userId: 7, allowed: true }); await pending
    expect(snapshots.read('test:7')).toBeNull()
    expect(store.getSnapshot()).toMatchObject({ accountKey: 'test:8', allowed: null, resolved: false })
  })
  it('persists explicit denial; unavailable refresh preserves a confirmed result', async () => {
    const disk = storage(); const snapshots = new SocialAccessSnapshotStorage(() => disk)
    snapshots.write('test:7', true)
    const load = vi.fn(async () => ({ userId: 7, allowed: null as boolean | null }))
    const store = new SocialAccessStore(load, snapshots); store.activate('test:7')
    await store.refresh(); expect(store.getSnapshot().allowed).toBe(true)
    load.mockResolvedValueOnce({ userId: 7, allowed: false }); await store.refresh()
    expect(snapshots.read('test:7')).toBe(false)
  })
  it('releases first startup on an unavailable response or rejected request', async () => {
    for (const load of [async () => ({ userId: 7, allowed: null }), async () => { throw new Error('offline') }]) {
      const store = new SocialAccessStore(load); store.activate('test:7')
      expect(store.getSnapshot().resolved).toBe(false)
      await store.refresh()
      expect(store.getSnapshot()).toMatchObject({ allowed: null, resolved: true })
    }
  })
  it('treats malformed or inaccessible storage as a miss without blocking the account owner', async () => {
    const disk = storage(); const snapshots = new SocialAccessSnapshotStorage(() => disk)
    snapshots.write('test:7', true)
    for (const key of disk.values.keys()) disk.values.set(key, '"true"')
    expect(snapshots.read('test:7')).toBeNull()
    const unavailable = new SocialAccessSnapshotStorage(() => { throw new Error('storage unavailable') })
    const store = new SocialAccessStore(async () => ({ userId: 7, allowed: true }), unavailable)
    store.activate('test:7'); await store.refresh()
    expect(store.getSnapshot()).toMatchObject({ allowed: true, resolved: true })
    store.activate(undefined)
  })
})
