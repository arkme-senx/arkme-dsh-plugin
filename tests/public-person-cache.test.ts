import { createHmac } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { ArkmeLocalDatabase } from '../src/local-database.js'
import { ArkmeStateStore } from '../src/state-store.js'
import { ServiceRuntime, type ArkmeServiceConfig } from '../src/services/service.js'
import { SourceService } from '../src/services/source-service.js'
import { ProfileService } from '../src/services/profile-service.js'
import { ChatService } from '../src/services/chat-service.js'
import { IdentityShareService } from '../src/services/identity-share-service.js'
import { dispatchArkmeHostOperation } from '../src/host-api.js'
import { publicPersonSnapshot } from '../src/public-person-cache.js'

it('shares public data across groups and restarts while keeping account, group authority and refreshes separate', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'arkme-public-person-'))
  let db = new ArkmeLocalDatabase(directory, new ArkmeStateStore(directory))
  let session = { userId: 42, accessToken: 'isolated', refreshToken: 'isolated' }, name = '甲的公开昵称'
  let profileMissing = false, active = true, failed = false
  let delay: Promise<void> | undefined, release: (() => void) | undefined
  const calls: { path: string; body: Record<string, unknown> }[] = []
  const fetchImpl: typeof fetch = async (input, init) => {
    const path = new URL(String(input)).pathname, body = JSON.parse(String(init?.body)); calls.push({ path, body })
    let data: unknown
    if (path.endsWith('/get-public-users-by-ids')) {
      if (delay) await delay
      if (failed) throw new Error('isolated offline')
      data = { items: profileMissing ? [] : [{ user_id: 7, nick_name: name, jotmo_id: 'public_jia', remark: '绝不能进公开缓存的私人备注' }] }
    } else if (path.endsWith('/members/page')) data = { chat_session_uid: body.chat_session_uid, self_role: 3,
      items: [{ user_id: 7, role: 3, status: 1, display_name_snapshot: `${body.chat_session_uid}群昵称`, join_at: 1 }], has_more: false }
    else if (path.endsWith('/members/by-user-ids')) data = { chat_session_uid: body.chat_session_uid,
      items: active ? [{ user_id: 7, role: 3, status: 1, display_name_snapshot: `${body.chat_session_uid}群昵称`, remark: '群中私人备注', join_at: 1, extra: { record_count: 4, mention_count: 1 } }] : [] }
    else throw new Error(`Unexpected isolated endpoint ${path}`)
    return new Response(JSON.stringify({ code: 200, data }))
  }
  const boot = () => {
    const runtime = new ServiceRuntime({ environment: 'test', authBaseUrl: 'https://auth.test', chatBaseUrl: 'https://chat.test', requestTimeoutMs: 1000 } as ArkmeServiceConfig,
      { read: async () => session, write: async () => {}, delete: async () => {} }, db, fetchImpl)
    vi.spyOn(runtime, 'requireSession').mockImplementation(async () => session)
    const profiles = new ProfileService(runtime), source = new SourceService(runtime, profiles, {} as never)
    const chat = new ChatService(runtime, source, profiles, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never)
    const identity = new IdentityShareService(runtime, profiles, source, {} as never, {} as never, chat, {} as never)
    return { runtime, profiles, source, chat, identity }
  }
  let app = boot()
  const signedMember = async (viewer: number, group: string) => {
    const payload = Buffer.from(JSON.stringify({ version: 1, viewerUserId: viewer, chatSessionUid: group, targetUserId: 7 })).toString('base64url')
    return `arkme-chat-member-v1.${payload}.${createHmac('sha256', await db.uniqueCode()).update(payload).digest('base64url')}`
  }
  try {
    const a = await app.source.sourceItem({ version: 1, userId: 42, kind: 'group_chat', ownerRef: 'A', displayName: 'A群' })
    const b = await app.source.sourceItem({ version: 1, userId: 42, kind: 'group_chat', ownerRef: 'B', displayName: 'B群' })
    const memberA = (await app.chat.pageSourceMembers(a.sourceRef)).items[0]!
    const loaded = await app.chat.sourceMembersPresentation(a.sourceRef, [memberA.memberRef])
    expect(loaded.items[0]!.displayName).toBe('群中私人备注')
    const targetB = { kind: 'member' as const, sourceRef: b.sourceRef, memberRef: await signedMember(42, 'B') }
    let count = calls.length
    const cached = await app.identity.person('test:42', targetB, undefined, { cacheOnly: true })
    expect(cached).toMatchObject({ userId: 7, publicDisplayName: name, accountName: 'public_jia', cachedAtMillis: expect.any(Number) })
    expect(calls).toHaveLength(count)
    const stored = await db.cachedPublicPerson('test', 42, 7)
    expect(JSON.stringify(stored)).not.toContain('群中私人备注'); expect(JSON.stringify(stored)).not.toContain('群昵称')
    expect(stored?.profile).not.toHaveProperty('role'); expect(stored?.profile).not.toHaveProperty('remark')
    active = false
    await expect(app.chat.memberWorldTarget(b.sourceRef, targetB.memberRef)).rejects.toMatchObject({ code: 'chat-member-ref-stale' })
    expect(await app.identity.person('test:42', targetB, undefined, { cacheOnly: true })).toMatchObject({ accountName: 'public_jia' })
    active = true
    db.close(); db = new ArkmeLocalDatabase(directory, new ArkmeStateStore(directory)); app = boot()
    count = calls.length
    expect(await app.identity.person('test:42', targetB, undefined, { cacheOnly: true })).toMatchObject({ accountName: 'public_jia' })
    expect(calls).toHaveLength(count)
    expect(await app.profiles.publicProfileSummariesByUserIds([7], session)).toHaveProperty('size', 1)
    expect(calls).toHaveLength(count)
    session = { ...session, userId: 99 }
    const c = await app.source.sourceItem({ version: 1, userId: 99, kind: 'group_chat', ownerRef: 'B', displayName: 'B群' })
    expect(await app.identity.person('test:99', { kind: 'member', sourceRef: c.sourceRef, memberRef: await signedMember(99, 'B') }, undefined, { cacheOnly: true })).toBeNull()
    await expect(app.identity.person('test:99', targetB, undefined, { cacheOnly: true })).rejects.toThrow()
    expect(await db.cachedPublicPerson('prod', 42, 7)).toBeUndefined()
    session = { ...session, userId: 42 }; name = '已更新的公开昵称'
    const fresh = await app.identity.person('test:42', targetB, undefined, { forceRefresh: true })
    expect(fresh?.publicDisplayName).toBe(name)
    failed = true
    expect(await app.identity.person('test:42', targetB, undefined, { forceRefresh: true })).toMatchObject({ publicDisplayName: name, refreshFailed: true })
    failed = false; profileMissing = true
    await app.identity.person('test:42', targetB, undefined, { forceRefresh: true })
    expect(await db.cachedPublicPerson('test', 42, 7)).toBeUndefined()
    expect(await app.identity.person('test:42', targetB, undefined, { cacheOnly: true })).toBeNull()
    profileMissing = false; app.profiles.invalidate(42)
    delay = new Promise(done => { release = done })
    const before = calls.filter(c => c.path.endsWith('/get-public-users-by-ids')).length
    const controller = new AbortController()
    const one = app.profiles.publicProfileSummariesByUserIds([7], session, controller.signal), two = app.profiles.publicProfileSummariesByUserIds([7], session)
    const cancelled = expect(one).rejects.toThrow()
    await vi.waitFor(() => expect(calls.filter(c => c.path.endsWith('/get-public-users-by-ids'))).toHaveLength(before + 1))
    controller.abort(); release!(); await cancelled; expect((await two).get(7)?.displayName).toBe(name); delay = undefined
    app.profiles.invalidate(42)
    const nowForRestore = Date.now()
    await db.cachePublicPeople('test', 42, [{ profile: { userId: 7, displayName: '失效前的资料', nickname: '甲' }, updatedAtMillis: nowForRestore }], [], nowForRestore)
    const actualRead = db.cachedPublicPerson.bind(db)
    let resumeRestore!: () => void
    const restoring = new Promise<void>(done => { resumeRestore = done })
    const hold = vi.spyOn(db, 'cachedPublicPerson').mockImplementation(async (...args) => { const value = await actualRead(...args); await restoring; return value })
    const staleRead = app.profiles.publicProfileSummariesByUserIds([7], session)
    const obsolete = expect(staleRead).rejects.toMatchObject({ code: 'public-profile-obsolete' })
    await vi.waitFor(() => expect(hold).toHaveBeenCalled())
    app.profiles.invalidate(42); resumeRestore(); await obsolete; hold.mockRestore()
    expect(await app.profiles.cachedPublicPerson(42, 7)).toBeUndefined()
    const now = Date.now(), newer = { profile: { userId: 7, displayName: '较新', nickname: '较新' }, updatedAtMillis: now }
    await db.cachePublicPeople('test', 42, [newer], [], now)
    await db.cachePublicPeople('test', 42, [{ ...newer, profile: { ...newer.profile, displayName: '较旧' }, updatedAtMillis: now - 5000 }], [], now - 5000)
    await db.cachePublicPeople('test', 42, [], [7], now - 5000)
    expect((await db.cachedPublicPerson('test', 42, 7))?.profile.displayName).toBe('较新')
  } finally { release?.(); vi.restoreAllMocks(); db.close(); await rm(directory, { recursive: true, force: true }) }
})

it('rejects expired, oversized or mismatched snapshots and strips unrelated fields', () => {
  const now = Date.now(), profile = { userId: 7, displayName: '甲', nickname: '甲', role: 'owner', remark: '私人备注' }
  expect(publicPersonSnapshot({ profile, updatedAtMillis: now }, 7)?.profile).toEqual({ userId: 7, displayName: '甲', nickname: '甲' })
  expect(publicPersonSnapshot({ profile, updatedAtMillis: now - 15 * 24 * 60 * 60_000 }, 7)).toBeUndefined()
  expect(publicPersonSnapshot({ profile, updatedAtMillis: now + 120_000 }, 7)).toBeUndefined()
  expect(publicPersonSnapshot({ profile, updatedAtMillis: now }, 8)).toBeUndefined()
  expect(publicPersonSnapshot({ profile: { ...profile, accountName: 'x'.repeat(513) }, updatedAtMillis: now }, 7)).toBeUndefined()
})


it('keeps the original Host call contract and validates optional cache controls', async () => {
  const read = vi.fn(async () => null), service = { identityPersonProfile: read } as never
  const signal = new AbortController().signal, base = { accountScope: 'test:42', kind: 'person', userId: 7 }
  await dispatchArkmeHostOperation(service, 'identity.person.read', base, undefined, undefined, undefined, undefined, signal)
  expect(read).toHaveBeenLastCalledWith('test:42', { kind: 'person', userId: 7 }, signal)
  await expect(dispatchArkmeHostOperation(service, 'identity.person.read', { ...base, cacheOnly: true }, undefined, undefined, undefined, undefined, signal)).resolves.toBeNull()
  expect(read).toHaveBeenLastCalledWith('test:42', { kind: 'person', userId: 7 }, signal, { cacheOnly: true, forceRefresh: false })
  read.mockClear()
  for (const options of [{ cacheOnly: 1 }, { forceRefresh: 'true' }, { cacheOnly: true, forceRefresh: true }]) {
    await expect(dispatchArkmeHostOperation(service, 'identity.person.read', { ...base, ...options }, undefined, undefined, undefined, undefined, signal)).rejects.toMatchObject({ code: 'identity-profile-options-invalid' })
  }
  expect(read).not.toHaveBeenCalled()
})
