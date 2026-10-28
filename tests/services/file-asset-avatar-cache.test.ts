import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ArkmeLocalDatabase } from '../../src/local-database.js'
import { ArkmeStateStore } from '../../src/state-store.js'
import { SelfRoleAvatarStore } from '../../src/self-role-avatar-store.js'
import { MediaService } from '../../src/services/media-service.js'
import { ProfileService } from '../../src/services/profile-service.js'
import { ServiceRuntime, type ArkmeServiceConfig } from '../../src/services/service.js'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64')
const ref = 'file_asset://avatar-asset-1'
let root: string, db: ArkmeLocalDatabase
const services: MediaService[] = []
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'avatar cache ')); db = new ArkmeLocalDatabase(root, new ArkmeStateStore(root)) })
afterEach(async () => { for (const service of services.splice(0)) service.dispose(); db.close(); await rm(root, { recursive: true, force: true }) })

function fixture(environment: 'test' | 'prod' = 'test') {
  let userId = 42
  const fetch = vi.fn(async () => new Response(png, { headers: { 'Content-Type': 'image/png' } }))
  const runtime = new ServiceRuntime({ environment, requestTimeoutMs: 5000 } as ArkmeServiceConfig,
    { read: async () => ({ userId, accessToken: 'fixture', refreshToken: 'fixture' }), write: async () => {}, delete: async () => {} }, db, fetch)
  const query = vi.spyOn(runtime, 'authenticatedPost').mockImplementation(async (_path, body) => ({ items: ((body as { file_asset_uids: string[] }).file_asset_uids).map(uid => ({
    file_asset_uid: uid, status: 'ready', preview_url: `https://jotmo-userfiles${environment === 'test' ? '-test' : ''}.oss-cn-hangzhou.aliyuncs.com/${uid}.png?x-oss-signature=fixture`,
  })) }))
  const originals = new SelfRoleAvatarStore(join(root, 'local avatars'))
  const media = new MediaService(runtime, new ProfileService(runtime), {} as never, { recordUid: () => '' }, undefined, originals)
  services.push(media)
  return { media, query, fetch, originals, setUser: (value: number) => { userId = value } }
}

it('reads an asset from SQLite offline after closing and reopening the database, including explicit revalidation', async () => {
  const first = fixture()
  const diskRead = vi.spyOn(db, 'readAvatarCache')
  await Promise.all(Array.from({ length: 20 }, () => first.media.readImage(ref)))
  expect(first.query).toHaveBeenCalledTimes(1)
  expect(first.fetch).toHaveBeenCalledTimes(1)
  expect(diskRead).toHaveBeenCalledTimes(1)
  first.media.dispose(); db.close(); db = new ArkmeLocalDatabase(root, new ArkmeStateStore(root))
  const restarted = fixture()
  restarted.query.mockRejectedValue(new Error('offline'))
  restarted.fetch.mockRejectedValue(new Error('offline'))
  expect(Buffer.from((await restarted.media.readImage(ref, { refresh: true })).data)).toEqual(png)
  expect(restarted.query).not.toHaveBeenCalled()
  expect(restarted.fetch).not.toHaveBeenCalled()
})

it('uses the original upload receipt after restart without fetching and preserves it when the role is deleted', async () => {
  const first = fixture()
  const localRef = await first.originals.save(42, png, 'image/png')
  const role = await db.createSelfRole(42, '角色', localRef)
  db.selfRoleSync.saveAsset(42, localRef, 'avatar-asset-1')
  await db.deleteSelfRole(42, role.roleId)
  first.media.dispose(); db.close(); db = new ArkmeLocalDatabase(root, new ArkmeStateStore(root))
  const restarted = fixture()
  restarted.query.mockRejectedValue(new Error('offline'))
  expect(Buffer.from((await restarted.media.readImage(ref)).data)).toEqual(png)
  expect(restarted.query).not.toHaveBeenCalled()
  expect(restarted.fetch).not.toHaveBeenCalled()
  expect(await db.selfRoleAvatarLocalRef(43, 'avatar-asset-1')).toBeUndefined()
})

it('batches different missing assets while deduplicating equal assets', async () => {
  const f = fixture()
  await Promise.all([1, 2, 3, 1].map(n => f.media.readImage(`file_asset://avatar-asset-${n}`)))
  expect(f.query).toHaveBeenCalledTimes(1)
  expect(f.query.mock.calls[0]?.[1]).toEqual({ file_asset_uids: ['avatar-asset-1', 'avatar-asset-2', 'avatar-asset-3'] })
  expect(f.fetch).toHaveBeenCalledTimes(3)
})

it('bounds metadata batches at 50 and allows retry after failure', async () => {
  const f = fixture()
  f.query.mockRejectedValue(new Error('temporarily offline'))
  const failures = await Promise.allSettled(Array.from({ length: 51 }, (_, n) => f.media.readImage(`file_asset://avatar-asset-${n}`)))
  expect(failures.every(item => item.status === 'rejected')).toBe(true)
  expect(f.query.mock.calls.map(call => (call[1] as { file_asset_uids: string[] }).file_asset_uids.length)).toEqual([50, 1])
  f.query.mockResolvedValue({ items: [{ file_asset_uid: 'avatar-asset-1', preview_url: 'https://jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com/a.png?x-oss-signature=fixture' }] })
  await expect(f.media.readImage(ref)).resolves.toMatchObject({ bytes: png.length })
})

it('isolates persisted assets by account and environment and rejects account changes during resolution', async () => {
  const f = fixture(); await f.media.readImage(ref)
  f.setUser(43); await f.media.readImage(ref)
  expect(f.query).toHaveBeenCalledTimes(2)
  const prod = fixture('prod'); await prod.media.readImage(ref)
  expect(prod.query).toHaveBeenCalledTimes(1)
  const changed = fixture()
  changed.setUser(44)
  changed.query.mockImplementation(async () => { changed.setUser(45); return { items: [{ file_asset_uid: 'avatar-asset-1', preview_url: 'https://jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com/a.png?x-oss-signature=fixture' }] } })
  await expect(changed.media.readImage(ref)).rejects.toMatchObject({ code: 'image-account-changed' })
  expect(changed.fetch).not.toHaveBeenCalled()
})

it('replaces invalid cached bytes and keeps a shared read alive when one subscriber aborts', async () => {
  const f = fixture()
  await db.writeAvatarCache(42, 'asset:test:avatar-asset-1', { data: new Uint8Array([1, 2]), mediaType: 'image/png', bytes: 2 })
  const abort = new AbortController()
  const cancelled = f.media.readImage(ref, { signal: abort.signal })
  const active = f.media.readImage(ref)
  const rejected = expect(cancelled).rejects.toThrow()
  abort.abort()
  await rejected
  expect(Buffer.from((await active).data)).toEqual(png)
  expect(f.fetch).toHaveBeenCalledTimes(1)
})

it('does not start an asset query after disposal during a disk read', async () => {
  const f = fixture()
  let release!: () => void
  let entered!: () => void
  const diskRead = new Promise<void>(resolve => { entered = resolve })
  const gate = new Promise<void>(resolve => { release = resolve })
  vi.spyOn(db, 'readAvatarCache').mockImplementationOnce(async () => {
    entered(); await gate; return undefined
  })
  const read = f.media.readImage(ref)
  const rejected = expect(read).rejects.toMatchObject({ code: 'image-account-changed' })
  await diskRead
  f.media.dispose()
  release()
  await rejected
  expect(f.query).not.toHaveBeenCalled()
  expect(f.fetch).not.toHaveBeenCalled()
})

it('does not query later batches after disposal in the first batch', async () => {
  const f = fixture()
  f.query.mockImplementation(async () => { f.media.dispose(); return { items: [] } })
  const results = await Promise.allSettled(Array.from({ length: 51 }, (_, i) =>
    f.media.readImage(`file_asset://avatar-asset-${i}`)))
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(results.every(result => result.status === 'rejected')).toBe(true)
  expect(f.query).toHaveBeenCalledTimes(1)
  expect(f.fetch).not.toHaveBeenCalled()
})


it('replaces a truncated PNG even when its signature remains intact', async () => {
 const f = fixture()
 const truncated = png.subarray(0, 8)
 await db.writeAvatarCache(42, 'asset:test:avatar-asset-1', { data: truncated, mediaType: 'image/png', bytes: truncated.length })
 await expect(f.media.readImage(ref, { cacheOnly: true })).rejects.toMatchObject({code:'image-cache-miss'})
 expect(f.query).not.toHaveBeenCalled()
 expect(f.fetch).not.toHaveBeenCalled()
 expect(Buffer.from((await f.media.readImage(ref)).data)).toEqual(png)
 expect(f.fetch).toHaveBeenCalledTimes(1)
})

it('a cache-only read does not join a pending remote read and returns a local hit while downloads wait', async () => {
 const f = fixture()
 let release!: () => void
 let entered!: () => void
 const gate = new Promise<void>(resolve => { release=resolve })
 const downloading = new Promise<void>(resolve => { entered=resolve })
 f.fetch.mockImplementationOnce(async () => { entered(); await gate; return new Response(png) })
 const remote = f.media.readImage('file_asset://not-local-asset')
 await downloading
 try {
  await expect(f.media.readImage('file_asset://not-local-asset', { cacheOnly:true })).rejects.toMatchObject({code:'image-cache-miss'})
  await db.writeAvatarCache(42, 'asset:test:avatar-asset-1', { data:png, mediaType:'image/png', bytes:png.length })
  expect(Buffer.from((await f.media.readImage(ref,{cacheOnly:true})).data)).toEqual(png)
  expect(f.query).toHaveBeenCalledTimes(1)
 } finally {release();await remote}
})

it('does not persist a damaged download and can retry it', async () => {
 const f=fixture()
 f.fetch.mockResolvedValueOnce(new Response(png.subarray(0,8)))
 await expect(f.media.readImage(ref)).rejects.toMatchObject({code:'image-bytes-invalid'})
 expect(await db.readAvatarCache(42,'asset:test:avatar-asset-1')).toBeUndefined()
 expect(Buffer.from((await f.media.readImage(ref)).data)).toEqual(png)
})

it('browser-to-Host local probes bypass two slow file-asset downloads', async () => {
 const {InMemoryArkmeAvatarImageStore}=await import('../../src/client/avatar-image-store.js')
 const f=fixture()
 await db.writeAvatarCache(42,'asset:test:avatar-asset-1',{data:png,mediaType:'image/png',bytes:png.length})
 let release!:()=>void
 const gate=new Promise<void>(resolve=>{release=resolve})
 f.fetch.mockImplementation(async()=>{await gate;return new Response(png)})
 const payload=(image: {mediaType:string;data:Uint8Array})=>({mediaType:image.mediaType,dataBase64:Buffer.from(image.data).toString('base64')})
 const store=new InMemoryArkmeAvatarImageStore({
  reader:async ref=>payload(await f.media.readImage(ref)),
  cachedReader:async ref=>{try{return payload(await f.media.readImage(ref,{cacheOnly:true}))}catch(error){if((error as {code?:string}).code==='image-cache-miss')return undefined;throw error}},
 })
 store.activateScope('test:42')
 const pending=['file_asset://cold-avatar-one','file_asset://cold-avatar-two'].map(ref=>store.load(ref))
 await vi.waitFor(()=>expect(f.fetch).toHaveBeenCalledTimes(2))
 try {await expect(store.load(ref)).resolves.toBe(`data:image/png;base64,${png.toString('base64')}`)}
 finally {release();await Promise.all(pending)}
})
