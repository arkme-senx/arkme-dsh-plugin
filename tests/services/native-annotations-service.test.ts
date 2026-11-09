import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
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

it('does not fabricate an excerpt source when the local history resolver has no verified source', async () => {
  const { service } = fixture()
  service.sourceRuntime = () => 'current-runtime'
  service.source = vi.fn(async () => undefined)
  await expect(service.excerptSource({ sessionRef: 'old-session', eventSeq: 8, role: 'user' })).resolves.toBeUndefined()
  expect(service.source).toHaveBeenCalledOnce()
})

it('resolves a local alias to its original cloud identity without requiring an executor', async () => {
  const f = fixture(), target = { sessionRef: 'old-session', eventSeq: 8, role: 'user' as const }
  f.service.resolveTarget = async value => ({ ...value, runtimeRef: 'old-runtime' })
  f.service.source = vi.fn()
  f.post.mockResolvedValueOnce({ items: [{ runtime_ref: 'old-runtime', session_ref: target.sessionRef, event_seq: 8, role: 'user', projection: 'dsh-selection-v1', canonical_text: canonical, source_digest: digest, message_ref: messageRef }] })
  expect(await f.service.execute({ action: 'contexts', targets: [target] })).toEqual([expect.objectContaining({ runtimeRef: 'old-runtime', messageRef })])
  expect(f.post.mock.calls[0]![0]).toContain('messages/selection-context')
  expect(f.post.mock.calls[0]![1]).toEqual({ prefer_format_version: 4, targets: [{ runtime_ref: 'old-runtime', session_ref: 'old-session', event_seq: 8, role: 'user' }] })
  expect(f.service.source).not.toHaveBeenCalled()
})

it('keeps verified local marks durable before cloud repair and resumes the same operation after service restart', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'arkme-mark-restart-')), path = join(directory, 'marks.db')
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }))
  let f = fixture(path)
  const target = { sessionRef: 'old-session', eventSeq: 8, role: 'user' as const }
  const configure = (service: NativeAnnotationsService) => {
    service.resolveTarget = async value => ({ ...value, runtimeRef: 'old-runtime' })
    service.source = async () => ({ runtimeRef: 'old-runtime', hostGeneration: 1, writable: false,
      entry: { event: { type: 'user/message', seq: 8, time: 1, data: { content: [{ type: 'text', text: canonical }] } } } as never, canonical })
    service.historySync = vi.fn(async () => ({ state: 'pending', nextSeq: 0, throughSeq: 8 }))
  }
  configure(f.service)
  f.post.mockRejectedValue(new ArkmePluginError('ANNOTATION_SOURCE_NOT_READY', 'pending', true, 409))
  const [context] = await f.service.execute({ action: 'contexts', targets: [target] }) as any[]
  expect(context.syncState).toBe('pending')
  const pending = await f.service.execute({ action: 'add', messageRef: context.messageRef, operationId: 'durable-add', anchor }) as NativeAnnotationSnapshot
  expect(pending.items).toEqual([expect.objectContaining({ pending: true, anchor })])
  expect(f.marks.cloudOperations(JSON.stringify(['test',42]))).toHaveLength(1)
  // Seed a full cache in one disk write, then exercise eviction through the store.
  const scope = JSON.stringify(['test', 42])
  f.db.prepare(`
    WITH RECURSIVE entries(i) AS (VALUES(1) UNION ALL SELECT i + 1 FROM entries WHERE i < 500)
    INSERT INTO native_annotation_cache(scope, key, payload, updated_at)
    SELECT ?, 'evict:' || i, '{}', ? FROM entries
  `).run(scope, Date.now())
  f.marks.writeCloudCache(scope, 'evict:501', {})
  expect(f.marks.readCloudCache(scope, 'evict:1')).toBeUndefined()
  f.close(); f = fixture(path)
  f.post.mockRejectedValue(new ArkmePluginError('ANNOTATION_SOURCE_NOT_READY', 'pending', true, 409))
  const restarted = f.service; configure(restarted)
  expect(await restarted.execute({ action: 'list', messageRefs: [context.messageRef] })).toEqual([pending])
  f.post.mockReset()
  f.post.mockResolvedValueOnce({ items: [{ runtime_ref: 'old-runtime', session_ref: 'old-session', event_seq: 8, role: 'user', projection: 'dsh-selection-v1', canonical_text: canonical, source_digest: digest, message_ref: context.messageRef }] })
  await restarted.execute({ action: 'contexts', targets: [target] })
  const complete = { message_ref: context.messageRef, revision: 1, complete: true, accessible: true, annotations: [{ annotation_uid: pending.items[0]!.id, actor_user_id: 42, actor_name: '你', anchor, state: 'available' }] }
  f.post.mockResolvedValueOnce(complete).mockResolvedValueOnce({ items: [complete] })
  const synced = await restarted.execute({ action: 'list', messageRefs: [context.messageRef] }) as NativeAnnotationSnapshot[]
  expect(synced[0]!.items[0]!.pending).toBeUndefined()
  expect(f.post.mock.calls[1]![1]).toMatchObject({ operation_id: 'durable-add', message_ref: context.messageRef })
  expect(f.marks.cloudOperations(JSON.stringify(['test',42]))).toHaveLength(0)
})

it('treats only a verified pending local source as not-yet-synced and refreshes after repair acknowledgement', async () => {
  const f = fixture(), target = { runtimeRef: 'old-runtime', sessionRef: 'old-session', eventSeq: 0, role: 'user' as const }
  f.service.historySync = vi.fn(async () => ({ state: 'pending', nextSeq: 0, throughSeq: 32 }))
  f.post.mockRejectedValueOnce(new ArkmePluginError('REMOTE_NOT_FOUND', 'missing', false, 404))
  await expect(f.service.execute({ action: 'contexts', targets: [target] })).rejects.toMatchObject({ code: 'native-annotation-source-not-ready', httpStatus: 409 })
  f.post.mockResolvedValueOnce({ items: [{ runtime_ref: target.runtimeRef, session_ref: target.sessionRef, event_seq: 0, role: 'user', projection: 'dsh-selection-v1', canonical_text: canonical, source_digest: digest, message_ref: messageRef }] })
  expect(await f.service.execute({ action: 'contexts', targets: [target] })).toEqual([expect.objectContaining({ messageRef })])
  f.post.mockRejectedValueOnce(new ArkmePluginError('forbidden', 'denied', false, 403))
  await expect(f.service.execute({ action: 'contexts', targets: [target] })).rejects.toMatchObject({ code: 'forbidden', httpStatus: 403 })
  expect(f.service.historySync).toHaveBeenCalledOnce()
})
function fixture(path = ':memory:') {
  const db = new DatabaseSync(path); let closed = false
  const close = () => { if (!closed) { db.close(); closed = true } }; cleanup.unshift(close)
  const marks = new LocalMessageMarkStore(db, work => { db.exec('BEGIN IMMEDIATE'); try { work(); db.exec('COMMIT') } catch (error) { db.exec('ROLLBACK'); throw error } })
  const runtime = new ServiceRuntime({ environment: 'test' } as ArkmeServiceConfig, {} as never, { messageMarks: marks } as StateStore)
  const session = { userId: 42, accessToken: 'local-test', refreshToken: 'local-refresh' }
  vi.spyOn(runtime, 'requireSession').mockResolvedValue(session); vi.spyOn(runtime, 'accountScopedSession').mockResolvedValue(session)
  const post = vi.spyOn(runtime, 'authenticatedDshRemotePost')
  const service = new NativeAnnotationsService(runtime)
  return { service, runtime, marks, post, session, close, db }
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

it('never hides permission loss behind verified local history and batches ready mark reads', async () => {
  const f = fixture(), targets = [0, 1].map(eventSeq => ({ runtimeRef: 'origin', sessionRef: 'old', eventSeq, role: 'user' as const }))
  f.service.resolveTarget = async target => target
  f.service.source = vi.fn()
  f.post.mockRejectedValueOnce(new ArkmePluginError('REMOTE_NOT_FOUND', 'denied', false, 404))
  await expect(f.service.execute({ action: 'contexts', targets })).rejects.toMatchObject({ httpStatus: 403 })
  expect(f.service.source).not.toHaveBeenCalled()
  const refs = [messageRef, `dsha_${'b'.repeat(64)}`]
  f.post.mockResolvedValueOnce({ items: refs.map(message_ref => ({ ...wire(0), message_ref })) })
  await f.service.execute({ action: 'list', messageRefs: refs })
  expect(f.post).toHaveBeenLastCalledWith('/api/v1/dsh-remote/annotations/list', { message_refs: refs }, f.session, expect.any(AbortSignal))
  expect(f.post).toHaveBeenCalledTimes(2)
})

it('removes the actual deduplicated mark after an offline add and freezes that target across an uncertain retry', async () => {
  const f = fixture(), scope = JSON.stringify(['test',42])
  f.marks.stageCloudOperation(scope, 'add', { path: 'annotations/create', body: { message_ref: messageRef, operation_id: 'offline-add', anchor } })
  f.marks.stageCloudOperation(scope, 'remove', { path: 'annotations/remove', body: { message_ref: messageRef, operation_id: 'offline-remove', annotation_id: 'provisional' }, pendingAnchor: anchor })
  const actual = wire(1, [wireMark()])
  f.post.mockResolvedValueOnce(actual).mockResolvedValueOnce({ items: [actual] }).mockRejectedValueOnce(new ArkmePluginError('offline', 'lost ack', true, 503))
  expect(await f.service.execute({ action: 'list', messageRefs: [messageRef] })).toEqual([expect.objectContaining({ syncState: 'cached' })])
  expect(f.post.mock.calls[2]![1]).toMatchObject({ annotation_id: 'mark-1', operation_id: 'offline-remove' })
  expect(f.marks.cloudOperations(scope)[0]!.value).toMatchObject({ prepared: true, body: { annotation_id: 'mark-1' } })
  f.post.mockReset(); f.post.mockResolvedValueOnce(wire(2)).mockResolvedValueOnce({ items: [wire(2)] })
  await new NativeAnnotationsService(f.runtime).execute({ action: 'list', messageRefs: [messageRef] })
  expect(f.post.mock.calls[0]![1]).toMatchObject({ annotation_id: 'mark-1', operation_id: 'offline-remove' })
  expect(f.marks.cloudOperations(scope)).toEqual([])
})
