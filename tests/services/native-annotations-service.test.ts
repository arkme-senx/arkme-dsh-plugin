import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, expect, it, vi } from 'vitest'
import { NativeAnnotationsService } from '../../src/services/native-annotations-service.js'
import { ServiceRuntime, ArkmePluginError, type ArkmeServiceConfig, type StateStore } from '../../src/services/service.js'
import { LocalMessageMarkStore } from '../../src/local-message-marks.js'
import { quoteSourceContent } from '../../src/message-quote.js'
import type { NativeAnnotationSnapshot } from '../../src/native-annotations.js'
const cleanup: (() => void)[] = []
afterEach(() => cleanup.splice(0).forEach(fn => fn()))
const messageRef = `dsha_${'a'.repeat(64)}`
const canonical = '前😀重点后'
const digest = createHash('sha256').update(quoteSourceContent({ textContent: canonical, textFormat: 'plain' })).digest('hex')
const anchor = { version: 1 as const, projection: 'arkme-text-v1' as const, sourceDigest: digest, start: 3, end: 5, text: '重点', prefix: '前😀', suffix: '后' }
function fixture(path = ':memory:') {
  const db = new DatabaseSync(path); cleanup.push(() => db.close())
  const marks = new LocalMessageMarkStore(db, work => { db.exec('BEGIN IMMEDIATE'); try { work(); db.exec('COMMIT') } catch (error) { db.exec('ROLLBACK'); throw error } })
  const runtime = new ServiceRuntime({ environment: 'test' } as ArkmeServiceConfig, {} as never, { messageMarks: marks } as StateStore)
  const session = { userId: 42, accessToken: 'local-test', refreshToken: 'local-refresh' }
  vi.spyOn(runtime, 'requireSession').mockResolvedValue(session); vi.spyOn(runtime, 'accountScopedSession').mockResolvedValue(session)
  const post = vi.spyOn(runtime, 'authenticatedDshRemotePost')
  const service = new NativeAnnotationsService(runtime)
  return { service, runtime, marks, post, session }
}
function wire(revision: number, annotations: unknown[] = []) { return { message_ref: messageRef, revision, complete: true, accessible: true, annotations } }
function wireMark() { return { annotation_uid: 'mark-1', actor_user_id: 42, actor_name: '你', anchor, state: 'available' } }
it('persists unknown writes, reuses the same operation after restart, and isolates account scopes', async () => {
  const f = fixture(); const calls: unknown[] = []
  f.post.mockRejectedValueOnce(new ArkmePluginError('arkme-network', 'offline', true, 503))
  await expect(f.service.execute({ action: 'add', messageRef, operationId: 'stable', anchor })).rejects.toThrow('offline')
  expect(f.marks.cloudOperations(JSON.stringify(['test',42]))).toHaveLength(1)
  const restarted = new NativeAnnotationsService(f.runtime)
  f.post.mockImplementation(async (path, body) => {
    calls.push([path, body]); return path.endsWith('/create') ? wire(1,[wireMark()]) : { items: [wire(1,[wireMark()])] }
  })
  const rows = await restarted.execute({ action: 'list', messageRefs: [messageRef] }) as NativeAnnotationSnapshot[]
  expect(rows[0]!.items[0]!.anchor).toEqual(anchor)
  expect(calls[0]).toEqual(['/api/v1/dsh-remote/annotations/create', expect.objectContaining({ operation_id: 'stable' })])
  expect(f.marks.cloudOperations(JSON.stringify(['test',42]))).toEqual([])
  expect(f.marks.cloudOperations(JSON.stringify(['prod',42]))).toEqual([])
})
it('keeps a complete confirmed offline snapshot but never serves it after access loss', async () => {
  const f=fixture(); f.post.mockResolvedValueOnce({ items:[wire(2,[wireMark()])] })
  await f.service.execute({action:'list',messageRefs:[messageRef]})
  f.post.mockRejectedValueOnce(new ArkmePluginError('arkme-network','offline',true,503))
  const cached=await f.service.execute({action:'list',messageRefs:[messageRef]}) as NativeAnnotationSnapshot[]
  expect(cached[0]).toMatchObject({syncState:'cached',revision:2});expect(cached[0]!.items).toHaveLength(1)
  f.post.mockRejectedValueOnce(new ArkmePluginError('REMOTE_NOT_FOUND','gone',false,502))
  await expect(f.service.execute({action:'list',messageRefs:[messageRef]})).rejects.toMatchObject({httpStatus:403})
})
it('checks exact remote context, rejects account swaps and bounds durable pending writes', async()=>{
 const f=fixture(); f.post.mockResolvedValueOnce({items:[{message_ref:messageRef,runtime_ref:'source',session_ref:'session',event_seq:3,role:'user',canonical_text:canonical,source_digest:digest,projection:'dsh-selection-v1'}]})
 expect(await f.service.execute({action:'contexts',targets:[{runtimeRef:'source',sessionRef:'session',eventSeq:3,role:'user'}]})).toEqual([expect.objectContaining({messageRef,canonicalText:canonical})])
 vi.mocked(f.runtime.accountScopedSession).mockResolvedValue({...f.session,userId:99})
 await expect(f.service.execute({action:'list',messageRefs:[messageRef]})).rejects.toMatchObject({httpStatus:403})
 for(let i=0;i<200;i++)f.marks.stageCloudOperation('bounded',String(i),{path:'annotations/remove',body:{message_ref:messageRef,operation_id:String(i)}})
 expect(()=>f.marks.stageCloudOperation('bounded','overflow',{path:'annotations/remove',body:{}})).toThrow('上限')
})
it('does not let one rejected operation block other messages and removes definite rejections',async()=>{
 const f=fixture(); const other=`dsha_${'b'.repeat(64)}`
 f.marks.stageCloudOperation(JSON.stringify(['test',42]),'other',{path:'annotations/remove',body:{message_ref:other,operation_id:'other'}})
 f.post.mockResolvedValueOnce({items:[wire(0)]})
 await f.service.execute({action:'list',messageRefs:[messageRef]});expect(f.post).toHaveBeenCalledTimes(1)
 f.post.mockRejectedValueOnce(new ArkmePluginError('REMOTE_PROJECTION_CONFLICT','changed',false,409))
 await expect(f.service.execute({action:'add',messageRef,operationId:'rejected',anchor})).rejects.toThrow('changed')
 expect(f.marks.cloudOperations(JSON.stringify(['test',42]))).toHaveLength(1)
})
it('revalidates cached contexts and never returns one after source permission loss', async () => {
 const f=fixture(); const target={runtimeRef:'source',sessionRef:'session',eventSeq:3,role:'user' as const}
 f.post.mockResolvedValueOnce({items:[{message_ref:messageRef,runtime_ref:'source',session_ref:'session',event_seq:3,role:'user',canonical_text:canonical,source_digest:digest,projection:'dsh-selection-v1'}]})
 await f.service.execute({action:'contexts',targets:[target]})
 f.post.mockRejectedValueOnce(new ArkmePluginError('REMOTE_NOT_FOUND','gone',false,502))
 await expect(f.service.execute({action:'contexts',targets:[target]})).rejects.toMatchObject({httpStatus:403})
 expect(f.post).toHaveBeenCalledTimes(2)
})
it('reports an old backend as unsupported while preserving local fallback', async () => {
 const f=fixture(); f.post.mockRejectedValueOnce(new ArkmePluginError('arkme-http-error','missing',false,502,{upstreamStatus:404}))
 expect(await f.service.execute({action:'capabilities'})).toMatchObject({supported:false})
})
it('makes retained unknown outcomes explicit to every consumer', async () => {
 const f=fixture(); f.post.mockRejectedValueOnce(new ArkmePluginError('arkme-network-error','offline',true,503))
 await expect(f.service.execute({action:'add',messageRef,operationId:'unknown-ui',anchor})).rejects.toMatchObject({code:'native-annotation-pending',writeOutcomeUnknown:true,message:expect.stringContaining('标记操作已保留')})
 expect(f.marks.cloudOperations(JSON.stringify(['test',42]))).toHaveLength(1)
})
