import { describe, expect, it, vi } from 'vitest'
import { SocialAccessStore, isSocialSource } from '../src/client/social-access-store.js'

describe('optional social presentation', () => {
 it.each([true, false])('presentation retains confirmed %s on failed refresh without publishing a change', async allowed => {
  const load = vi.fn(async () => ({ userId: 7, allowed: allowed as boolean | null }))
  const store = new SocialAccessStore(load)
  store.activate('test:7'); await store.refresh()
  const snapshot = store.getSnapshot()
  const listener = vi.fn(); store.subscribe(listener)
  load.mockRejectedValueOnce(new Error('offline'))
  await store.refresh()
  expect(store.getSnapshot()).toBe(snapshot)
  load.mockResolvedValueOnce({ userId: 7, allowed: null })
  await store.refresh()
  expect(store.getSnapshot()).toBe(snapshot)
  await store.refresh()
  expect(listener).not.toHaveBeenCalled()
  load.mockResolvedValueOnce({ userId: 7, allowed: !allowed })
  await store.refresh()
  expect(store.getSnapshot().allowed).toBe(!allowed)
  expect(listener).toHaveBeenCalledTimes(1)
  store.activate('test:8')
  expect(store.getSnapshot().allowed).toBeNull()
 })
 it('presentation retains unknown on failed reads and discards old account responses', async () => {
  let resolve!: (value: {userId:number;allowed:boolean}) => void
  const load = vi.fn(() => new Promise<{userId:number;allowed:boolean}>(done => { resolve=done }))
  const store=new SocialAccessStore(load);store.activate('test:7');const pending=store.refresh()
  expect(store.getSnapshot().allowed).toBeNull();store.activate('test:8');resolve({userId:7,allowed:true});await pending
  expect(store.getSnapshot()).toEqual({accountKey:'test:8',allowed:null,resolved:false})
  load.mockRejectedValueOnce(new Error('offline'));await store.refresh();expect(store.getSnapshot().allowed).toBeNull()
 })
 it('classifies human conversations without hiding personal bot sources', () => {
  expect(isSocialSource({kind:'private_chat'})).toBe(true);expect(isSocialSource({kind:'group_chat'})).toBe(true)
  expect(isSocialSource({kind:'send_to_self'})).toBe(false);expect(isSocialSource({kind:'topic'})).toBe(false)
 })
})
