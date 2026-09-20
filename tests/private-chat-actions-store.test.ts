import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ArkmeDirectMessageAdmission } from '../src/direct-message-admission.js'
import type { ArkmeUserProfileSnapshot } from '../src/types.js'
import { ArkmeClientError } from '../src/client/api.js'
import { ArkmeAuthStore } from '../src/client/auth-store.js'
import { bindPrivateChatActionsAuth } from '../src/client/private-chat-actions-auth-binding.js'
import { PrivateChatActionsStore, chatActionKey, UnconfirmedBanError, type PrivateChatActionsPort } from '../src/client/private-chat-actions-store.js'

const account = 'production:7'
const binding = { account, source: { sourceKey: 'private:42', sourceRef: 'opaque', kind: 'private_chat' as const, peerUserId: 42, displayName: 'Peer' } }
const identity = { account, userId: 7 }
const allowed: ArkmeDirectMessageAdmission = { ownRefused: false, counterpartRefused: false, state: 'allowed', canSend: true, refusalCreationEnabled: true, ownRevision: 0, counterpartRevision: 0 }
const refused: ArkmeDirectMessageAdmission = { ...allowed, ownRefused: true, state: 'refused_by_self', canSend: false, ownRevision: 1 }
const profile = (userId = 7, accountType = 2) => ({ profile: { userId, accountType }, revision: 1, cachedAtMillis: Date.now() }) as ArkmeUserProfileSnapshot
const record = (banned: boolean) => ({ sourceRef: 'opaque', displayName: 'Peer', status: banned ? 'banned' as const : 'unbanned' as const, remark: '', bannedAtMillis: 1, unbannedAtMillis: 0, updatedAtMillis: 1 })
const deferred = <T>() => { let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
const stores: PrivateChatActionsStore[] = []
function setup(overrides: Partial<PrivateChatActionsPort> = {}) {
  const port = { identity: vi.fn(async () => profile()), eligibility: vi.fn(async () => ({ allowed: true })),
    admission: vi.fn(async () => allowed), setRefused: vi.fn(async () => refused),
    banStatus: vi.fn(async () => ({ sourceRef: 'opaque', displayName: 'Peer', exists: false, banned: false })),
    setBanned: vi.fn(async (_binding, banned) => record(banned)), ...overrides } satisfies PrivateChatActionsPort
  const store = new PrivateChatActionsStore(port); stores.push(store); store.activateAccount(account)
  return { port, store, key: chatActionKey(binding) }
}
afterEach(() => { for (const store of stores.splice(0)) { store.activateAccount(undefined); store.reset() }; vi.useRealTimers(); vi.unstubAllGlobals() })

describe('private-chat business resources', () => {
  it('shares only the account eligibility fact across peers, using the new source for revalidation', async () => {
    const { store, port } = setup()
    await store.eligibility.refresh(account, binding)
    const other = { ...binding, source: { ...binding.source, sourceKey: 'private:43', sourceRef: 'other', peerUserId: 43 } }
    const pending = store.eligibility.refresh(account, other)
    expect(store.eligibility.get(account).value).toEqual({ allowed: true })
    await pending
    expect(port.eligibility).toHaveBeenLastCalledWith(other, expect.any(AbortSignal))
    expect(store.eligibility.get('test:9').value).toBeUndefined()
    expect(store.ban.get(chatActionKey(other)).value).toBeUndefined()
    expect(store.admission.get(chatActionKey(other)).value).toBeUndefined()
  })
  it('observes same-account logout/login without relying on React to render the intermediate state', async () => {
    const auth = new ArkmeAuthStore(); const { store, port } = setup()
    const stop = bindPrivateChatActionsAuth(auth, store)
    auth.setAuth({ status: 'authenticated', environment: 'prod', userId: 7 })
    await store.identity.refresh('prod:7', { account: 'prod:7', userId: 7 }, false)
    auth.setAuth({ status: 'logged-out', environment: 'prod' })
    expect(store.identity.get('prod:7').value).toBeUndefined()
    auth.setAuth({ status: 'authenticated', environment: 'prod', userId: 7 })
    await store.identity.refresh('prod:7', { account: 'prod:7', userId: 7 }, false)
    expect(port.identity).toHaveBeenCalledTimes(2)
    stop()
  })
  it('does not erase unconfirmed recovery when the user cancels its confirmation', async () => {
    const { store, port, key } = setup()
    port.setBanned.mockRejectedValueOnce(new Error('lost'))
    await expect(store.setBanned(binding, identity, true, () => true, () => true)).rejects.toBeInstanceOf(UnconfirmedBanError)
    await store.setBanned(binding, identity, true, () => false, () => true)
    expect(store.ban.get(key).operationError).toBeInstanceOf(UnconfirmedBanError)
    expect(port.setBanned).toHaveBeenCalledOnce()
  })
  it('preserves definite permission rejection instead of inventing an uncertain server write', async () => {
    const { store, port } = setup()
    const rejected = new ArkmeClientError({ code: 'arkme-code-1001', message: '参数错误', retryable: false })
    port.setBanned.mockRejectedValue(rejected)
    await expect(store.setBanned(binding, identity, true, () => true, () => true)).rejects.toBe(rejected)
    expect(port.setBanned).toHaveBeenCalledOnce()
  })
  it('never turns unknown or persistent profile state into employee permission', async () => {
    const { store, port } = setup()
    expect(store.canManage(binding, identity)).toBe(false)
    await store.identity.refresh(account, identity)
    expect(store.canManage(binding, identity)).toBe(true)
    expect(store.canManage(binding, { ...identity, userId: 99 })).toBe(false)
    expect(store.canManage({ ...binding, source: { ...binding.source, peerUserId: 7 } }, identity)).toBe(false)
    expect(store.canManage({ ...binding, source: { ...binding.source, kind: 'group_chat' } }, identity)).toBe(false)
    port.identity.mockResolvedValue(profile(7, 1))
    await store.identity.refresh(account, identity)
    expect(store.canManage(binding, identity)).toBe(false)
  })
  it('retains a confirmed role during refresh but hides it at expiry and after a failed refresh', async () => {
    vi.useFakeTimers()
    const pending = deferred<ArkmeUserProfileSnapshot>()
    const { store, port } = setup()
    await store.identity.refresh(account, identity)
    port.identity.mockReturnValue(pending.promise)
    const read = store.identity.refresh(account, identity)
    expect(store.canManage(binding, identity)).toBe(true)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(store.canManage(binding, identity)).toBe(false)
    pending.resolve(profile()); await read
    port.identity.mockRejectedValue(new Error('offline'))
    await expect(store.identity.refresh(account, identity)).rejects.toThrow('offline')
    expect(store.canManage(binding, identity)).toBe(false)
  })
  it('rejects a profile for another user and old-session completions', async () => {
    const pending = deferred<ArkmeUserProfileSnapshot>()
    const { store } = setup({ identity: async () => pending.promise })
    const read = store.identity.refresh(account, identity)
    await Promise.resolve(); store.activateAccount('production:9')
    pending.resolve(profile()); await expect(read).rejects.toMatchObject({ name: 'AbortError' })
    expect(store.canManage(binding, identity)).toBe(false)
    store.activateAccount(account)
    const other = setup({ identity: async () => profile(99) }).store
    await expect(other.identity.refresh(account, identity)).rejects.toThrow('身份尚未确认')
  })
  it('uses stable chat identity with the newest opaque reference and always revalidates', async () => {
    const { store, port, key } = setup()
    await store.admission.refresh(key, binding)
    const renewed = { ...binding, source: { ...binding.source, sourceRef: 'renewed' } }
    expect(chatActionKey(renewed)).toBe(key)
    const pending = store.admission.refresh(key, renewed)
    expect(store.admission.get(key).value).toEqual(allowed)
    await pending
    expect(port.admission).toHaveBeenLastCalledWith(renewed, expect.any(AbortSignal))
    expect(port.admission).toHaveBeenCalledTimes(2)
  })
  it('does not invert the clicked default when recovery finds refusal already enabled', async () => {
    const { store, port, key } = setup({ admission: vi.fn(async () => refused) })
    const confirm = vi.fn(() => true)
    await store.setRefused(binding, true, confirm, () => true)
    expect(store.admission.get(key).value).toEqual(refused)
    expect(port.setRefused).not.toHaveBeenCalled()
    expect(confirm).not.toHaveBeenCalled()
  })
  it('requires a real revision and cancels delayed confirmation after navigation', async () => {
    const pending = deferred<ArkmeDirectMessageAdmission>()
    const { store, port } = setup({ admission: async () => pending.promise })
    const confirm = vi.fn(() => true); let active = true
    const write = store.setRefused(binding, true, confirm, () => active)
    active = false; pending.resolve(allowed)
    await expect(write).rejects.toMatchObject({ name: 'AbortError' })
    expect(port.setRefused).not.toHaveBeenCalled(); expect(confirm).not.toHaveBeenCalled()
  })
  it('rejects rollback on either revision axis, including conflict snapshots', async () => {
    const { store, port, key } = setup()
    port.admission.mockResolvedValue({ ...allowed, ownRevision: 4, counterpartRevision: 5 })
    await store.admission.refresh(key, binding)
    port.admission.mockResolvedValue({ ...refused, ownRevision: 6, counterpartRevision: 4 })
    await expect(store.admission.refresh(key, binding)).rejects.toThrow('较旧')
    expect(store.admission.get(key).value).toMatchObject({ ownRevision: 4, counterpartRevision: 5 })
    port.setRefused.mockRejectedValue(new ArkmeClientError({ code: 'DIRECT_MESSAGE_ADMISSION_CONFLICT', message: '状态已变更', retryable: false,
      directMessageAdmission: { ...refused, ownRevision: 5, counterpartRevision: 5 } }))
    await expect(store.setRefused(binding, true, () => true, () => true)).rejects.toThrow('状态已变更')
    expect(store.admission.get(key).value?.ownRefused).toBe(true)
    expect(port.setRefused).toHaveBeenCalledOnce()
  })
  it('only sends explicit ban intent after current role and user confirmation, without a status prerequisite', async () => {
    const { store, port } = setup()
    expect(await store.setBanned(binding, identity, true, () => true, () => true)).toBe(true)
    expect(port.setBanned).toHaveBeenCalledWith(binding, true, expect.any(AbortSignal))
    expect(port.banStatus).not.toHaveBeenCalled()
    await store.setBanned(binding, identity, false, () => false, () => true)
    expect(port.setBanned).toHaveBeenCalledOnce()
    port.identity.mockResolvedValue(profile(7, 1)); await store.identity.refresh(account, identity)
    await expect(store.setBanned(binding, identity, false, () => true, () => true)).rejects.toThrow('无权')
    expect(port.setBanned).toHaveBeenCalledOnce()
  })
  it('preserves an unconfirmed ban retry after read-back already says banned', async () => {
    const { store, port, key } = setup()
    port.setBanned.mockRejectedValueOnce(new Error('Redis propagation failed'))
    await expect(store.setBanned(binding, identity, true, () => true, () => true)).rejects.toBeInstanceOf(UnconfirmedBanError)
    port.banStatus.mockResolvedValue({ sourceRef: 'opaque', displayName: 'Peer', exists: true, banned: true })
    await store.ban.refresh(key, binding)
    expect(store.ban.get(key).operationError).toMatchObject({ banned: true })
    await store.setBanned(binding, identity, true, () => true, () => true)
    expect(port.setBanned.mock.calls.map(call => call[1])).toEqual([true, true])
    expect(store.ban.get(key).operationError).toBeUndefined()
  })
  it('never writes after logout during identity recovery', async () => {
    const pending = deferred<ArkmeUserProfileSnapshot>()
    const { store, port } = setup({ identity: async () => pending.promise })
    const confirm = vi.fn(() => true)
    const write = store.setBanned(binding, identity, true, confirm, () => true)
    await Promise.resolve(); store.activateAccount(undefined); pending.resolve(profile())
    await expect(write).rejects.toMatchObject({ name: 'AbortError' })
    expect(port.setBanned).not.toHaveBeenCalled(); expect(confirm).not.toHaveBeenCalled()
  })
})
