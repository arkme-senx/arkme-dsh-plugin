import { describe, expect, it, vi } from 'vitest'
import { SocialAccessService } from '../src/services/social-access-service.js'
import type { ServiceRuntime } from '../src/services/service.js'
import { SocialAccessStore, isSocialSource } from '../src/client/social-access-store.js'

function fixture(allowed: unknown = false) {
  let listener = () => {}
  const post = vi.fn(async () => ({ allowed }))
  const runtime = {
    requestScope: (id: number) => `user:${id}`, readRevision: () => 0,
    subscribeAccountScope(fn: () => void) { listener = fn; return () => {} },
    requireSession: vi.fn(async () => ({ userId: 7 })), authenticatedAuthReadPost: post,
  }
  return { service: new SocialAccessService(runtime as unknown as ServiceRuntime), runtime, post, change: () => listener() }
}
describe('account-owned social access', () => {
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
 it('deduplicates only in-flight reads and rechecks the next action', async () => {
  const { service, post } = fixture(true)
  await Promise.all([service.status(), service.status()])
  expect(post).toHaveBeenCalledTimes(1)
  await service.require(); expect(post).toHaveBeenCalledTimes(2)
 })
 it('fresh page refresh does not join an older cache read, while normal callers join fresh reads', async () => {
  const { service, post } = fixture()
  let stale!: (value: { allowed: boolean }) => void
  let fresh!: (value: { allowed: boolean }) => void
  post.mockImplementationOnce(() => new Promise(resolve => { stale = resolve }))
    .mockImplementationOnce(() => new Promise(resolve => { fresh = resolve }))
  const cached = service.status(); await Promise.resolve()
  const refreshed = service.status(true); await Promise.resolve()
  const normal = service.status(); await Promise.resolve()
  expect(post).toHaveBeenCalledTimes(2)
  expect(post).toHaveBeenNthCalledWith(2, '/api/v1/social-access/status', { refresh: true }, { userId: 7 }, expect.any(AbortSignal), { publishServiceCooldown: false })
  fresh({ allowed: true }); expect((await refreshed).allowed).toBe(true); expect((await normal).allowed).toBe(true)
  stale({ allowed: false }); expect((await cached).allowed).toBe(false)
  await service.status(); expect(post).toHaveBeenCalledTimes(3)
 })
 it('distinguishes denial from unavailable without mutating authentication', async () => {
  const { service, post } = fixture(false)
  await expect(service.require()).rejects.toMatchObject({ code: 'PHONE_BINDING_REQUIRED', retryable: false })
  post.mockRejectedValueOnce(new Error('offline'))
  await expect(service.require()).rejects.toMatchObject({ code: 'SOCIAL_ACCESS_UNAVAILABLE' })
 })
 it('rejects stale account reads including logout and return to the same account', async () => {
  const { service, post, change } = fixture()
  let resolve!: (value: {allowed: boolean}) => void
  post.mockImplementationOnce(() => new Promise(done => { resolve = done }))
  const pending = service.status(); await Promise.resolve(); change(); resolve({allowed: true})
  await expect(pending).rejects.toMatchObject({ code: 'account-changed' })
 })
 it('presentation hides unknown and failed reads and discards old account responses', async () => {
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
