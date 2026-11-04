import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { ArkmeLocalDatabase } from '../src/local-database.js'
import { ArkmeStateStore } from '../src/state-store.js'
import { publicPersonSnapshot, PUBLIC_PERSON_MAX_ENTRIES } from '../src/public-person-cache.js'
import { ProfileService } from '../src/services/profile-service.js'
import { MediaService } from '../src/services/media-service.js'
import { ServiceRuntime, type ArkmeServiceConfig } from '../src/services/service.js'

const session = { userId: 42, accessToken: 'isolated', refreshToken: 'isolated' }
const avatar = (name: string) => `https://jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com/${name}.png?x-oss-signature=fixture`
const profile = (name: string, id = 7) => ({ user_id: id, nick_name: name, head_img: avatar(name) })
const snapshot = (id: number, at = Date.now()) => ({ profile: { userId: id, displayName: '甲', nickname: '甲' }, updatedAtMillis: at })
async function databaseTest(run: (db: ArkmeLocalDatabase) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'arkme-person-review-'))
  const db = new ArkmeLocalDatabase(directory, new ArkmeStateStore(directory))
  try { await run(db) } finally { db.close(); await rm(directory, { recursive: true, force: true }) }
}
function service(read: ReturnType<typeof vi.fn>, db?: ArkmeLocalDatabase) {
  return new ProfileService({ config: { environment: 'test' }, stateStore: db, authenticatedAuthPost: read } as unknown as ServiceRuntime)
}

it('refreshes an invalidated avatar without restoring its old persisted URL', async () => databaseTest(async db => {
  const read = vi.fn().mockResolvedValueOnce({ items: [profile('old')] }).mockResolvedValueOnce({ items: [profile('new')] })
  const target = service(read, db)
  await target.publicProfileSummariesByUserIds([7], session)
  await target.invalidatePublicProfile(42, 7)
  expect((await target.publicProfileSummariesByUserIds([7], session)).get(7)?.avatarUrl).toBe(avatar('new'))
  expect(read).toHaveBeenCalledTimes(2)
}))

it('keeps both profile and avatar newer when an older overlapping request finishes last', async () => {
  let finish!: (value: unknown) => void
  const read = vi.fn().mockImplementationOnce(() => new Promise(done => { finish = done }))
    .mockResolvedValueOnce({ items: [profile('new')] })
  const target = service(read)
  const old = target.publicProfileSummariesByUserIds([7, 8], session, undefined, 0)
  await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1))
  await target.publicProfileSummariesByUserIds([7], session, undefined, 0)
  finish({ items: [profile('old')] })
  expect((await old).get(7)?.nickname).toBe('new')
  expect(target.cachedPublicProfileAvatar(42, 7)).toBe(avatar('new'))
})

it.each([[null], [{ user_id: '7' }], [profile('bad', 99)], [profile('one'), profile('two')], [{ user_id: 7, nick_name: 42 }], [{ user_id: 7, nick_name: 'x'.repeat(513) }]].map(items => ({ items })))('rejects malformed rows without replacing or removing retained data: %j', async ({ items }) => databaseTest(async db => {
  await db.cachePublicPeople('test', 42, [snapshot(7)], [], Date.now())
  const target = service(vi.fn().mockResolvedValue({ items }), db)
  await expect(target.publicProfileSummariesByUserIds([7], session, undefined, 0)).rejects.toMatchObject({ code: 'public-profile-contract-invalid' })
  expect((await db.cachedPublicPerson('test', 42, 7))?.profile.nickname).toBe('甲')
}))

it('treats corrupt fallback values as cache misses without throwing', () => {
  for (const avatarFallback of [null, false, 1, 'bad', [], { kind: 'phone_default', label: '甲', colorIndex: -1 }]) {
    expect(publicPersonSnapshot({ ...snapshot(7), profile: { ...snapshot(7).profile, avatarFallback } }, 7)).toBeUndefined()
  }
})

it('bounds real SQLite rows per account and environment without pruning other accounts', async () => databaseTest(async db => {
  const at = Date.now()
  await db.cachePublicPeople('prod', 42, [snapshot(1, at)], [], at)
  await db.cachePublicPeople('test', 99, [snapshot(1, at)], [], at)
  for (let start = 1; start <= PUBLIC_PERSON_MAX_ENTRIES + 1; start += 50) {
    const entries = Array.from({ length: Math.min(50, PUBLIC_PERSON_MAX_ENTRIES + 2 - start) }, (_, i) => snapshot(start + i, at + start + i))
    await db.cachePublicPeople('test', 42, entries, [], at)
  }
  expect(await db.cachedPublicPerson('test', 42, 1)).toBeUndefined()
  expect(await db.cachedPublicPerson('test', 42, PUBLIC_PERSON_MAX_ENTRIES + 1)).toBeDefined()
  expect(await db.cachedPublicPerson('prod', 42, 1)).toBeDefined()
  expect(await db.cachedPublicPerson('test', 99, 1)).toBeDefined()
}))


it('rejects invalidated in-flight data while allowing unrelated people to finish', async () => databaseTest(async db => {
  const replies = new Map<number, (value: unknown) => void>()
  const read = vi.fn(async (_path: string, body: { user_ids: number[] }) => new Promise(done => { replies.set(body.user_ids[0]!, done) }))
  const target = service(read, db)
  const old = target.publicProfileSummariesByUserIds([7], session, undefined, 0)
  const unrelated = target.publicProfileSummariesByUserIds([8], session, undefined, 0)
  const obsolete = expect(old).rejects.toMatchObject({ code: 'public-profile-obsolete' })
  await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2))
  await target.invalidatePublicProfile(42, 7)
  replies.get(7)!({ items: [profile('old')] })
  replies.get(8)!({ items: [profile('unrelated', 8)] })
  await obsolete
  expect((await unrelated).get(8)?.nickname).toBe('unrelated')
  expect(await db.cachedPublicPerson('test', 42, 7)).toBeUndefined()
  expect((await db.cachedPublicPerson('test', 42, 8))?.profile.nickname).toBe('unrelated')
}))

it('does not revive a newer confirmed absence from an older positive response', async () => databaseTest(async db => {
  let finish!: (value: unknown) => void
  const read = vi.fn().mockImplementationOnce(() => new Promise(done => { finish = done })).mockResolvedValueOnce({ items: [] })
  const target = service(read, db)
  const old = target.publicProfileSummariesByUserIds([7, 8], session, undefined, 0)
  await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1))
  await target.publicProfileSummariesByUserIds([7], session, undefined, 0)
  finish({ items: [profile('old')] })
  expect((await old).has(7)).toBe(false)
  expect(target.cachedPublicProfileAvatar(42, 7)).toBeUndefined()
  expect(await target.cachedPublicPerson(42, 7)).toBeUndefined()
  expect(await db.cachedPublicPerson('test', 42, 7)).toBeUndefined()
}))

it('waits for a targeted disk invalidation before restoring a snapshot', async () => databaseTest(async db => {
  await db.cachePublicPeople('test', 42, [snapshot(7)], [], Date.now())
  let release!: () => void
  const gate = new Promise<void>(done => { release = done })
  const clear = db.clearPublicPeople.bind(db)
  vi.spyOn(db, 'clearPublicPeople').mockImplementation(async (...args) => { await gate; await clear(...args) })
  const read = vi.fn().mockResolvedValue({ items: [profile('new')] })
  const target = service(read, db)
  const invalidating = target.invalidatePublicProfile(42, 7)
  const loading = target.publicProfileSummariesByUserIds([7], session)
  await Promise.resolve()
  expect(read).not.toHaveBeenCalled()
  release(); await invalidating
  expect((await loading).get(7)?.nickname).toBe('new')
}))

it.each([true, false])('limits persisted avatar recovery to one refresh and one retry (recovery succeeds: %s)', async succeeds => databaseTest(async db => {
  await db.cachePublicPeople('test', 42, [{ profile: { ...snapshot(7).profile, avatarUrl: avatar('expired') }, updatedAtMillis: Date.now() }], [], Date.now())
  const paths: string[] = []
  const fetchImpl: typeof fetch = async input => {
    const url = new URL(String(input)); paths.push(url.pathname)
    if (url.pathname.endsWith('/get-public-users-by-ids')) return new Response(JSON.stringify({ code: 200, data: { items: [profile('fresh')] } }))
    if (url.pathname === '/expired.png') return new Response('', { status: 403 })
    if (url.pathname === '/fresh.png' && !succeeds) return new Response('', { status: 403 })
    if (url.pathname === '/fresh.png') return new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), { headers: { 'Content-Type': 'image/png' } })
    throw new Error(`Unexpected isolated endpoint ${url.pathname}`)
  }
  const runtime = new ServiceRuntime({ environment: 'test', authBaseUrl: 'https://auth.test', requestTimeoutMs: 1000 } as ArkmeServiceConfig,
    { read: async () => session, write: async () => {}, delete: async () => {} }, db, fetchImpl)
  vi.spyOn(runtime, 'requireSession').mockResolvedValue(session)
  const profiles = new ProfileService(runtime), media = new MediaService(runtime, profiles, {} as never, { recordUid: () => '' })
  const loading = media.readImage(await profiles.sealProfileImageRef(42, 7))
  if (succeeds) await expect(loading).resolves.toMatchObject({ mediaType: 'image/png', bytes: 8 })
  else await expect(loading).rejects.toMatchObject({ code: 'image-download-failed' })
  expect(paths).toEqual(['/expired.png', '/api/v1/auth/get-public-users-by-ids', '/fresh.png'])
  expect((await db.cachedPublicPerson('test', 42, 7))?.profile.avatarUrl).toBe(avatar('fresh'))
}))

it('never starts avatar recovery after cancellation', async () => {
  const controller = new AbortController()
  const runtime = new ServiceRuntime({ environment: 'test', requestTimeoutMs: 1000 } as ArkmeServiceConfig,
    { read: async () => session, write: async () => {}, delete: async () => {} }, { uniqueCode: async () => 'isolated' } as never,
    async () => { controller.abort(); throw controller.signal.reason })
  vi.spyOn(runtime, 'requireSession').mockResolvedValue(session)
  const profiles = new ProfileService(runtime)
  vi.spyOn(profiles, 'publicProfilesByUserIds').mockResolvedValue(new Map([[7, { ...snapshot(7).profile, avatarUrl: avatar('cancel') }]]))
  const invalidate = vi.spyOn(profiles, 'invalidatePublicProfile')
  const refresh = vi.spyOn(profiles, 'publicProfileSummariesByUserIds')
  const media = new MediaService(runtime, profiles, {} as never, { recordUid: () => '' })
  await expect(media.readImage(await profiles.sealProfileImageRef(42, 7), { signal: controller.signal })).rejects.toThrow()
  expect(invalidate).not.toHaveBeenCalled(); expect(refresh).not.toHaveBeenCalled()
})

it.each(['cache-only', 'freshness-restore'] as const)('does not let a delayed disk read replace a newer network result: %s', async mode => databaseTest(async db => {
  await db.cachePublicPeople('test', 42, [snapshot(7)], [], Date.now())
  const actualRead = db.cachedPublicPerson.bind(db)
  let release!: () => void, entered!: () => void
  const gate = new Promise<void>(done => { release = done }), started = new Promise<void>(done => { entered = done })
  const hold = vi.spyOn(db, 'cachedPublicPerson').mockImplementationOnce(async (...args) => { const old = await actualRead(...args); entered(); await gate; return old })
  const target = service(vi.fn().mockResolvedValue({ items: [profile('new')] }), db)
  const restoring = mode === 'cache-only' ? target.cachedPublicPerson(42, 7) : target.publicProfileSummariesByUserIds([7], session)
  await started
  await target.publicProfileSummariesByUserIds([7], session, undefined, 0)
  release()
  const value = await restoring
  expect(value instanceof Map ? value.get(7)?.nickname : value?.profile.nickname).toBe('new')
  hold.mockRestore()
  expect((await target.cachedPublicPerson(42, 7))?.profile.nickname).toBe('new')
}))

it('always bypasses memory for forced reads even within one system clock millisecond', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(100000)
  try {
    const read = vi.fn().mockResolvedValue({ items: [profile('fresh')] })
    const target = service(read)
    for (let i = 0; i < 4; i++) await target.publicProfileSummariesByUserIds([7], session, undefined, 0)
    expect(read).toHaveBeenCalledTimes(4)
  } finally { clock.mockRestore() }
})

it('bounds restored memory across accounts as well as network-populated memory', async () => {
  const stored = vi.fn(async (_env: string, _viewer: number, id: number) => snapshot(id))
  const read = vi.fn()
  const target = new ProfileService({ config: { environment: 'test' }, stateStore: { cachedPublicPerson: stored }, authenticatedAuthPost: read } as unknown as ServiceRuntime)
  await target.publicProfileSummariesByUserIds(Array.from({ length: PUBLIC_PERSON_MAX_ENTRIES }, (_, i) => i + 1), session)
  await target.publicProfileSummariesByUserIds([1], { ...session, userId: 99 })
  const before = stored.mock.calls.length
  await target.publicProfileSummariesByUserIds([1], session)
  expect(stored).toHaveBeenCalledTimes(before + 1)
  expect(read).not.toHaveBeenCalled()
})

it('continues a normal public-profile read if both local cache reads and writes fail', async () => {
  const target = new ProfileService({ config: { environment: 'test' }, stateStore: {
    cachedPublicPerson: async () => { throw new Error('isolated cache read failure') },
    cachePublicPeople: async () => { throw new Error('isolated cache write failure') },
  }, authenticatedAuthPost: vi.fn().mockResolvedValue({ items: [profile('fresh')] }) } as unknown as ServiceRuntime)
  expect((await target.publicProfileSummariesByUserIds([7], session)).get(7)?.nickname).toBe('fresh')
  expect((await target.cachedPublicPerson(42, 7))?.profile.nickname).toBe('fresh')
})

it('a forced read advances beyond a persisted logical timestamp after service restart', async () => databaseTest(async db => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(100000)
  try {
    await db.cachePublicPeople('test', 42, [snapshot(7, 100005)], [], 100005)
    const target = service(vi.fn().mockResolvedValue({ items: [profile('new')] }), db)
    expect((await target.publicProfileSummariesByUserIds([7], session, undefined, 0)).get(7)?.nickname).toBe('new')
    expect((await db.cachedPublicPerson('test', 42, 7))?.profile.nickname).toBe('new')
  } finally { clock.mockRestore() }
}))

it.each(['main', 'projection'])('does not join a pre-refresh coordinated request in the %s pool', async pool => databaseTest(async db => {
  const replies: ((value: Response) => void)[] = []
  const fetchImpl: typeof fetch = async () => new Promise(done => { replies.push(done) })
  const runtime = new ServiceRuntime({ environment: 'test', authBaseUrl: 'https://auth.test', requestTimeoutMs: 1000 } as ArkmeServiceConfig,
    { read: async () => session, write: async () => {}, delete: async () => {} }, db, fetchImpl)
  const coordinated = vi.spyOn(runtime, 'authenticatedAuthPost'), target = new ProfileService(runtime)
  const load = (maxAge?: number) => pool === 'projection'
    ? runtime.runBackgroundMessageProjection(() => target.publicProfileSummariesByUserIds([7], session, undefined, maxAge))
    : target.publicProfileSummariesByUserIds([7], session, undefined, maxAge)
  const old = load()
  await vi.waitFor(() => expect(replies).toHaveLength(1))
  const fresh = load(0)
  await vi.waitFor(() => expect(coordinated).toHaveBeenCalledTimes(2))
  replies[0]!(new Response(JSON.stringify({ code: 200, data: { items: [profile('old')] } })))
  await old
  await vi.waitFor(() => expect(replies).toHaveLength(2))
  replies[1]!(new Response(JSON.stringify({ code: 200, data: { items: [profile('new')] } })))
  expect((await fresh).get(7)?.nickname).toBe('new')
  expect((await db.cachedPublicPerson('test', 42, 7))?.profile.nickname).toBe('new')
}))

it.each(['main', 'projection'].flatMap(pool => ['target', 'viewer', 'all'].map(invalidation => ({ pool, invalidation }))))('starts a fresh coordinated request after $invalidation invalidation in $pool pool', async ({ pool, invalidation }) => databaseTest(async db => {
  const replies: ((value: Response) => void)[] = []
  const fetchImpl: typeof fetch = async () => new Promise(done => { replies.push(done) })
  const runtime = new ServiceRuntime({ environment: 'test', authBaseUrl: 'https://auth.test', requestTimeoutMs: 1000 } as ArkmeServiceConfig,
    { read: async () => session, write: async () => {}, delete: async () => {} }, db, fetchImpl)
  const coordinated = vi.spyOn(runtime, 'authenticatedAuthPost')
  const target = new ProfileService(runtime)
  const load = () => pool === 'projection' ? runtime.runBackgroundMessageProjection(() => target.publicProfileSummariesByUserIds([7], session, undefined, 0)) : target.publicProfileSummariesByUserIds([7], session, undefined, 0)
  const old = load()
  const obsolete = expect(old).rejects.toMatchObject({ code: 'public-profile-obsolete' })
  await vi.waitFor(() => expect(replies).toHaveLength(1))
  if (invalidation === 'target') await target.invalidatePublicProfile(42, 7)
  else target.invalidate(invalidation === 'viewer' ? 42 : undefined)
  const fresh = load()
  await vi.waitFor(() => expect(coordinated).toHaveBeenCalledTimes(2))
  replies[0]!(new Response(JSON.stringify({ code: 200, data: { items: [profile('old')] } })))
  await obsolete
  await vi.waitFor(() => expect(replies).toHaveLength(2))
  replies[1]!(new Response(JSON.stringify({ code: 200, data: { items: [profile('new')] } })))
  expect((await fresh).get(7)?.nickname).toBe('new')
  expect((await db.cachedPublicPerson('test', 42, 7))?.profile.nickname).toBe('new')
}))


it.each(['oversized', 'unsupported'] as const)('does not amplify a terminal image validation failure with refresh/retry: %s', async failure => {
  const fetchImpl = vi.fn(async () => new Response(failure === 'unsupported' ? '<html>invalid image</html>' : 'large',
    { headers: failure === 'oversized' ? { 'Content-Length': '1000000000' } : {} }))
  const runtime = new ServiceRuntime({ environment: 'test', requestTimeoutMs: 1000 } as ArkmeServiceConfig,
    { read: async () => session, write: async () => {}, delete: async () => {} }, { uniqueCode: async () => 'isolated' } as never, fetchImpl)
  vi.spyOn(runtime, 'requireSession').mockResolvedValue(session)
  const profiles = new ProfileService(runtime)
  vi.spyOn(profiles, 'publicProfilesByUserIds').mockResolvedValue(new Map([[7, { ...snapshot(7).profile, avatarUrl: avatar('bad') }]]))
  const invalidate = vi.spyOn(profiles, 'invalidatePublicProfile'), refresh = vi.spyOn(profiles, 'publicProfileSummariesByUserIds')
  const media = new MediaService(runtime, profiles, {} as never, { recordUid: () => '' })
  await expect(media.readImage(await profiles.sealProfileImageRef(42, 7))).rejects.toMatchObject({ code: failure === 'oversized' ? 'image-too-large' : 'image-type-unsupported' })
  expect(fetchImpl).toHaveBeenCalledTimes(1)
  expect(invalidate).not.toHaveBeenCalled(); expect(refresh).not.toHaveBeenCalled()
})
