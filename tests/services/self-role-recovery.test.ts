import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ArkmeLocalDatabase } from '../../src/local-database.js'
import { ArkmeStateStore } from '../../src/state-store.js'
import { SelfRoleService } from '../../src/services/self-role-service.js'
import { RecordService } from '../../src/services/record-service.js'
import { ArkmeUpstreamResponseError } from '../../src/services/service.js'

let root: string, db: ArkmeLocalDatabase
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'role-retry-')); db = new ArkmeLocalDatabase(root, new ArkmeStateStore(root)) })
afterEach(async () => { vi.restoreAllMocks(); db.close(); await rm(root, { recursive: true, force: true }) })
const refusal = () => new ArkmeUpstreamResponseError('arkme-code-40001', 'invalid self role', true, 400, {})
function fixture() {
  let userId = 7, status = 2, version = 1
  let fillError: Error | undefined, receiptOverride: Record<string,unknown> | undefined
  const session = () => ({ userId, accessToken: 'synthetic', refreshToken: 'synthetic' })
  const post = vi.fn(async (path: string, body: Record<string, unknown>) => {
    if (path.endsWith('/self-roles/list')) return { items: [], next_cursor: '' }
    if (path.endsWith('/self-roles/apply')) return { ...body, version: 1, deleted: false, update_at: 1 }
    if (path.endsWith('/self-role/fill')) { if(fillError)throw fillError; if (status !== 1) throw refusal(); return {} }
    if (path.endsWith('/receipt/get')) return receiptOverride ?? { record_uid: body.record_uid, record_exists: true, record_status: status, current_version: version, accepted: true }
    return {}
  })
  const runtime = { requireSession: async () => session(), authenticatedPost: post }
  const media = { uploadLocalFile: vi.fn(async () => ({ fileAssetUid: 'avatar-asset' })) }
  const avatars = { read: vi.fn(async () => ({ data: Buffer.from('image'), mediaType: 'image/png' })), uploadPath: () => '/synthetic/avatar' }
  const owner = new SelfRoleService(runtime as never, db, avatars as never, media as never)
  return { owner, runtime, post, media, avatars, session, setFillError:(value:Error|undefined)=>{fillError=value}, setReceipt:(value:Record<string,unknown>)=>{receiptOverride=value}, setVersion:(value:number)=>{version=value}, setUser: (value: number) => { userId = value }, setStatus: (value: number) => { status = value } }
}
it('suspends three inactive bindings instead of filling them again on every refresh', async () => {
  const role = await db.createSelfRole(7, 'frozen')
  for (const uid of ['a', 'b', 'c']) await db.bindSelfRole(7, uid, role.roleId)
  const f = fixture()
  await f.owner.refresh(); await f.owner.refresh(); await f.owner.refresh()
  expect(f.post.mock.calls.filter(([path]) => path.endsWith('/self-role/fill'))).toHaveLength(3)
  expect(f.post.mock.calls.filter(([path]) => path.endsWith('/receipt/get'))).toHaveLength(3)
  expect(db.selfRoleSync.pendingBindings(7)).toHaveLength(3)
})

const count = (f: ReturnType<typeof fixture>, suffix: string) => f.post.mock.calls.filter(([path]) => path.endsWith(suffix)).length
async function bind(uid = 'record', avatar?: string) {
  const role = await db.createSelfRole(7, 'frozen', avatar)
  await db.bindSelfRole(7, uid, role.roleId)
  return role
}
for (const status of [2, 3]) it(`persists inactive ${status} across restart and fills only after a due Active receipt`, async () => {
  let now = 1_000; vi.spyOn(Date, 'now').mockImplementation(() => now)
  await bind(); const first = fixture(); first.setStatus(status)
  await first.owner.refresh()
  expect(db.selfRoleSync.pendingBindings(7)).toHaveLength(1) // accepted=true is NOT fill ACK
  first.owner.dispose(); db.close(); db = new ArkmeLocalDatabase(root, new ArkmeStateStore(root))
  const second = fixture(); second.setStatus(1)
  now += 299_999; await second.owner.refresh()
  expect(count(second, '/receipt/get')).toBe(0); expect(count(second, '/self-role/fill')).toBe(0)
  now++; await second.owner.refresh()
  expect(count(second, '/receipt/get')).toBe(1); expect(count(second, '/self-role/fill')).toBe(1)
  expect(db.selfRoleSync.pendingBindings(7)).toEqual([])
})
it('only an authoritative exact-UID Purged receipt stops automatic recovery without ACK or deletion', async () => {
  let now = 1_000; vi.spyOn(Date, 'now').mockImplementation(() => now)
  await bind(); const f = fixture(); f.setStatus(4); await f.owner.refresh()
  now += 100 * 24 * 3600_000; f.setStatus(1); await f.owner.refresh()
  expect(count(f, '/self-role/fill')).toBe(1); expect(count(f, '/receipt/get')).toBe(1)
  expect(db.selfRoleSync.pendingBindings(7)).toHaveLength(1)
  expect((await db.selfRoleSnapshots(7, ['record'])).get('record')?.name).toBe('frozen')
})
for (const mode of ['missing', 'active', 'network'] as const) it(`backs off ${mode} without losing pending work`, async () => {
  let now = 1_000; vi.spyOn(Date, 'now').mockImplementation(() => now)
  await bind(); const f = fixture()
  if(mode === 'missing') f.setReceipt({record_uid:'record',record_exists:false,accepted:false})
  if(mode === 'active') f.setStatus(1)
  f.setFillError(mode === 'network' ? new Error('offline') : refusal())
  const run=async()=>{if(mode==='network')await expect(f.owner.refresh()).rejects.toThrow('offline');else await f.owner.refresh()}
  await run(); now += 59_999; await f.owner.refresh(); expect(count(f, '/self-role/fill')).toBe(1)
  now++; await run(); now += 119_999; await f.owner.refresh(); expect(count(f, '/self-role/fill')).toBe(2)
  now++; await run(); expect(count(f, '/self-role/fill')).toBe(3)
  expect(count(f, '/receipt/get')).toBe(mode==='network'?0:3)
  expect(db.selfRoleSync.pendingBindings(7)).toHaveLength(1)
})
for (const bad of [
  {record_uid:'other',record_exists:true,accepted:true,record_status:4,current_version:1},
  {record_uid:'record',record_exists:'true',accepted:true,record_status:4,current_version:1},
  {record_uid:'record',record_exists:true,accepted:1,record_status:4,current_version:1},
  {record_uid:'record',record_exists:true,accepted:true,record_status:5,current_version:1},
  {record_uid:'record',record_exists:true,accepted:true,record_status:4,current_version:0},
]) it(`rejects malformed or mismatched receipt ${JSON.stringify(bad)}`,async()=>{
  let now=1_000;vi.spyOn(Date,'now').mockImplementation(()=>now)
  await bind(); const f=fixture();f.setReceipt(bad)
  await expect(f.owner.refresh()).rejects.toThrow('invalid self-role receipt')
  now+=60_000;expect(db.selfRoleSync.dueBindings(7,now)).toEqual(['record'])
  expect(db.selfRoleSync.pendingBindings(7)).toHaveLength(1)
})
it('rejects an older Active receipt while preserving inactive metadata polling',async()=>{
  let now=1_000;vi.spyOn(Date,'now').mockImplementation(()=>now)
  await bind();const f=fixture();f.setVersion(3);await f.owner.refresh()
  now+=300_000;f.setStatus(1);f.setVersion(2)
  await expect(f.owner.refresh()).rejects.toThrow('invalid self-role receipt')
  expect(count(f,'/self-role/fill')).toBe(1)
  now+=300_000;f.setVersion(4);await f.owner.refresh()
  expect(count(f,'/self-role/fill')).toBe(2);expect(db.selfRoleSync.pendingBindings(7)).toEqual([])
})
it('does not read lifecycle metadata for avatar failure or a successful fill',async()=>{
  await bind('bad','arkme-self-role-image-v1.abcdefgh');await bind('healthy')
  const f=fixture();f.setStatus(1);f.media.uploadLocalFile.mockRejectedValue(refusal())
  await expect(f.owner.refresh()).rejects.toThrow('invalid self role')
  expect(count(f,'/receipt/get')).toBe(0);expect(count(f,'/self-role/fill')).toBe(1)
  expect(db.selfRoleSync.pendingBindings(7).map(r=>r.recordUid)).toEqual(['bad'])
})
it('never ACKs a same-millisecond delete/rebind when the old atomic create returns late',async()=>{
  vi.spyOn(Date,'now').mockReturnValue(1_000)
  const role=await bind();const f=fixture()
  let start!:()=>void,release!:()=>void
  const started=new Promise<void>(r=>{start=r}),gate=new Promise<void>(r=>{release=r})
  const original=f.post.getMockImplementation()!
  f.post.mockImplementation(async(path,body)=>{if(path.endsWith('/records/create')){start();await gate;return {}}return original(path,body)})
  const records=new RecordService(f.runtime as never,f.media as never,{} as never);records.selfRoles=f.owner
  const sending=records.createPersonalRecord('/api/v1/records/create',{record_uid:'record'})
  await started;await db.unbindSelfRole(7,'record',role.roleId);await db.bindSelfRole(7,'record',role.roleId)
  release();await sending
  expect(db.selfRoleSync.pendingBindings(7)).toHaveLength(1)
})
it('does not ACK a fill response after account switch',async()=>{
  await bind();const f=fixture();f.setStatus(1)
  const original=f.post.getMockImplementation()!
  f.post.mockImplementation(async(path,body)=>{const value=await original(path,body);if(path.endsWith('/self-role/fill'))f.setUser(8);return value})
  await expect(f.owner.refresh()).rejects.toMatchObject({code:'self-role-account-changed'})
  expect(db.selfRoleSync.pendingBindings(7)).toHaveLength(1);expect(count(f,'/receipt/get')).toBe(0)
})
it('does not postpone a replacement binding when the old receipt returns late',async()=>{
  vi.spyOn(Date,'now').mockReturnValue(1_000)
  const role=await bind();const f=fixture();const original=f.post.getMockImplementation()!
  f.post.mockImplementation(async(path,body)=>{
    if(path.endsWith('/receipt/get')){await db.unbindSelfRole(7,'record',role.roleId);await db.bindSelfRole(7,'record',role.roleId)}
    return original(path,body)
  })
  await f.owner.refresh();expect(db.selfRoleSync.dueBindings(7,1_000)).toEqual(['record'])
})
it('processes one page and yields at its time budget; later healthy work is not starved',async()=>{
  let now=1_000;vi.spyOn(Date,'now').mockImplementation(()=>now)
  const role=await db.createSelfRole(7,'frozen')
  for(let i=0;i<105;i++)await db.bindSelfRole(7,`record-${String(i).padStart(3,'0')}`,role.roleId)
  const f=fixture();f.setStatus(1);await f.owner.refresh()
  expect(count(f,'/self-role/fill')).toBe(100);expect(count(f,'/receipt/get')).toBe(0)
  const original=f.post.getMockImplementation()!
  f.post.mockImplementation(async(path,body)=>{if(path.endsWith('/self-role/fill')){now+=30_001;throw new Error('timeout')}return original(path,body)})
  await expect(f.owner.refresh()).rejects.toThrow('timeout')
  expect(count(f,'/self-role/fill')).toBe(101)
  f.post.mockImplementation(original);await f.owner.refresh()
  expect(count(f,'/self-role/fill')).toBe(105);expect(db.selfRoleSync.pendingBindings(7)).toHaveLength(1)
})
it('shares refresh flight and allows foreground avatar preparation while fill transport is pending',async()=>{
  await bind();const f=fixture();f.setStatus(1)
  let start!:()=>void,release!:()=>void
  const started=new Promise<void>(r=>{start=r}),gate=new Promise<void>(r=>{release=r})
  const original=f.post.getMockImplementation()!
  f.post.mockImplementation(async(path,body)=>{if(path.endsWith('/self-role/fill')){start();await gate}return original(path,body)})
  const a=f.owner.refresh(),b=f.owner.refresh();await started
  await bind('foreground','arkme-self-role-image-v1.abcdefgh')
  let timeout:ReturnType<typeof setTimeout>|undefined
  try{
    await Promise.race([f.owner.prepare(f.session(),'foreground'),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('blocked by background fill')),500)})])
    expect(f.media.uploadLocalFile).toHaveBeenCalledTimes(1)
  }finally{clearTimeout(timeout);release();await Promise.all([a,b])}
  expect(count(f,'/self-role/fill')).toBe(1)
})
for(const transition of ['account','dispose'] as const)it(`keeps a confirmed create successful when ${transition} changes before local ACK`,async()=>{
  await bind();const f=fixture();const original=f.post.getMockImplementation()!
  f.post.mockImplementation(async(path,body)=>{
    if(path.endsWith('/records/create')){if(transition==='account')f.setUser(8);else f.owner.dispose();return {accepted:true}}
    return original(path,body)
  })
  const records=new RecordService(f.runtime as never,f.media as never,{} as never);records.selfRoles=f.owner
  await expect(records.createPersonalRecord('/api/v1/records/create',{record_uid:'record'})).resolves.toEqual({accepted:true})
  expect(db.selfRoleSync.pendingBindings(7)).toHaveLength(1)
})
it('concurrent foreground sends retain their frozen snapshot and share the binding generation',async()=>{
  await bind();const f=fixture()
  const snapshots=await Promise.all([f.owner.prepare(f.session(),'record'),f.owner.prepare(f.session(),'record')])
  expect(snapshots[0]).toEqual(snapshots[1])
  await f.owner.acknowledge(f.session(),'record',snapshots[0]!)
  expect(db.selfRoleSync.pendingBindings(7)).toEqual([])
  await f.owner.acknowledge(f.session(),'record',snapshots[1]!)
  expect(db.selfRoleSync.pendingBindings(7)).toEqual([])
})
it('background and foreground preparation share one avatar upload owner',async()=>{
  const role=await bind('background','arkme-self-role-image-v1.abcdefgh')
  await db.bindSelfRole(7,'foreground',role.roleId);await db.deleteSelfRole(7,role.roleId)
  const f=fixture();f.setStatus(1)
  let start!:()=>void,release!:()=>void
  const started=new Promise<void>(r=>{start=r}),gate=new Promise<void>(r=>{release=r})
  let active=0,maxActive=0
  f.media.uploadLocalFile.mockImplementation(async()=>{active++;maxActive=Math.max(maxActive,active);start();await gate;active--;return {fileAssetUid:'avatar-asset'}})
  const refresh=f.owner.refresh();await started
  const prepare=f.owner.prepare(f.session(),'foreground');release()
  await Promise.all([refresh,prepare])
  expect(f.media.uploadLocalFile).toHaveBeenCalledTimes(1);expect(maxActive).toBe(1)
  expect(f.media.uploadLocalFile.mock.calls[0]?.[2]).toHaveProperty('signal')
})
it('does not read receipts for ambiguous write outcomes even with a 40001 code',async()=>{
  await bind();const f=fixture()
  f.setFillError(new ArkmeUpstreamResponseError('arkme-code-40001','invalid self role',true,400,{}, {writeOutcomeUnknown:true}))
  await expect(f.owner.refresh()).rejects.toThrow('invalid self role')
  expect(count(f,'/receipt/get')).toBe(0);expect(db.selfRoleSync.pendingBindings(7)).toHaveLength(1)
})
