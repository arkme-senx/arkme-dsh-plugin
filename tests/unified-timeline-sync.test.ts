import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { UnifiedChatTimelineService } from '../src/services/unified-chat-timeline-service.js'
import { UnifiedTimelineCache } from '../src/unified-timeline-cache.js'
import { CHAT_TIMELINE_SOURCES } from '../src/unified-chat-timeline.js'
import type { TimelineCachePort, TimelineCacheCommand } from '../src/timeline-cache-port.js'
const cleanup: Array<() => void> = []
afterEach(() => { for (const close of cleanup.splice(0)) close() })
const response = (text = 'old', extra = {}) => ({ protocol_version: 1, chat_session_uid: 'chat',
  timeline_items: [{ event_id: 'event', kind: 'wechat_import', source: 'wechat_import', occurred_at: 10, order_tie: 'event', content_status: 'available', payload: { text_content: text } }],
  sources: CHAT_TIMELINE_SOURCES.map(source => ({ source, status: 'ready', item_count: source === 'wechat_import' ? 1 : 0 })),
  complete: true, window_token: 'window', older_has_more: false, newer_has_more: false, has_more: false, newer_cursor: 'tail', ...extra })
function setup(unavailable = false, readbackMissing = false) {
  const directory = mkdtempSync(join(tmpdir(), 'arkme timeline sync '))
  const store = new UnifiedTimelineCache(directory)
  let userId = 1
  const post = vi.fn(async (_route?: string, _body?: unknown, _session?: unknown, _signal?: AbortSignal) => response())
  const writes = vi.fn()
  const port: TimelineCachePort = { async call<T>(command: TimelineCacheCommand): Promise<T> {
    if (unavailable) throw new Error('disk failed')
    let result: unknown
    switch (command.kind) {
      case 'sync': result = store.sync(command.command); break
      case 'reserve': result = store.reserve(); break
      case 'read': result = readbackMissing ? undefined : store.read(command.scope, command.request, command.anchorId, command.latest); break
      case 'write': writes(command); result = store.write(command.scope, command.request, command.page, command.options); break
      case 'invalidate': store.invalidate(command.scope, command.timelineItemKey, command.terminal, command.refreshOnly); break
      case 'invalidate-source': store.invalidateSource(command.sourceKey, command.timelineItemKey, command.terminal, command.refreshOnly); break
    }
    return result as T
  }, close() {} }
  const owner = new UnifiedChatTimelineService({ config: { environment: 'test', fileStateDirectory: directory },
    stateStore: { uniqueCode: async () => 'secret' }, requireSession: async () => ({ userId }), authenticatedChatPost: post } as never,
    { openSourceRef: async () => ({ kind: 'private_chat', ownerRef: 'chat' }), sourceItem: async () => ({ sourceRef: 'ref', sourceKey: 'source-key', kind: 'private_chat' }) } as never,
    { projectChatTimelineItems: async () => [] } as never, {} as never, () => port)
  cleanup.push(() => { owner.dispose(); store.close(); rmSync(directory, { recursive: true, force: true }) })
  return { owner, post, writes, port, changeAccount: () => { userId = 2; owner.reset() } }
}
it('publishes only after the complete refresh and tail are committed, and restarts from that window', async () => {
  const { owner, post, writes } = setup()
  const first = await owner.read('ref')
  expect(first.cache?.persistence).toBe('committed')
  post.mockResolvedValueOnce(response('edited', { has_more: true, next_cursor: 'page-2' }))
    .mockResolvedValueOnce(response('edited')).mockResolvedValueOnce(response('edited'))
  const result = await owner.read('ref', { mode: 'refresh', windowTokens: first.unified!.windowTokens, reconcile: true, newerCursor: first.unified!.newerCursor })
  expect(post).toHaveBeenCalledTimes(4)
  expect(writes).toHaveBeenCalledTimes(2)
  expect(result.cache?.persistence).toBe('committed')
  const local = await owner.read('ref', { cacheOnly: true })
  expect(local.unified?.events[0]).toMatchObject({ text: 'edited' })
  expect(local.cache?.origin).toBe('local')
  expect(post).toHaveBeenCalledTimes(4)
})
it('failure on continuation keeps old data and a single raw refresh page is never a durable checkpoint', async () => {
  const { owner, post, writes } = setup()
  const first = await owner.read('ref')
  post.mockResolvedValueOnce(response('partial', { has_more: true, next_cursor: 'page-2' })).mockRejectedValueOnce(new Error('offline'))
  await expect(owner.read('ref', { mode: 'refresh', windowTokens: first.unified!.windowTokens, reconcile: true })).rejects.toThrow('offline')
  expect(writes).toHaveBeenCalledTimes(1)
  expect((await owner.read('ref', { cacheOnly: true })).unified?.events[0]).toMatchObject({ text: 'old' })
  post.mockResolvedValueOnce(response('partial'))
  expect((await owner.read('ref', { mode: 'refresh', windowTokens: first.unified!.windowTokens })).cache?.persistence).toBe('deferred')
  expect(writes).toHaveBeenCalledTimes(1)
})
it('keeps network data available with an explicit persistence failure', async () => {
  const { owner } = setup(true)
  const result = await owner.read('ref')
  expect(result.unified?.events[0]).toMatchObject({ text: 'old' })
  expect(result.cache).toEqual({ origin: 'network', persistence: 'unavailable', stale: false })
  await expect(owner.read('ref', { cacheOnly: true })).rejects.toMatchObject({ code: 'chat-timeline-cache-miss' })
})
it('does not claim a durable projection when readback was evicted or missing', async () => {
  const { owner, writes } = setup(false, true)
  const result = await owner.read('ref')
  expect(writes).toHaveBeenCalledTimes(1)
  expect(result.unified?.events[0]).toMatchObject({ text: 'old' })
  expect(result.cache).toEqual({ origin: 'network', persistence: 'unavailable', stale: false })
})
it('preserves the durable invalidation state reported by readback', async () => {
  const { owner, port } = setup()
  const call = port.call.bind(port)
  vi.spyOn(port, 'call').mockImplementation(async command => {
    const value = await call<any>(command)
    return command.kind === 'read' && value ? { ...value, cache: { ...value.cache, stale: true } } : value
  })
  expect((await owner.read('ref')).cache).toMatchObject({ persistence: 'committed', stale: true })
})
it('does not publish a stale response when its durable commit is rejected by a newer refresh', async () => {
  const { owner, port } = setup()
  const call = port.call.bind(port)
  vi.spyOn(port, 'call').mockImplementation(async command => command.kind === 'write' ? false : call(command))
  await expect(owner.read('ref')).rejects.toMatchObject({ code: 'chat-timeline-stale' })
})
it('keeps a completed deletion authoritative over an overlapping late network response', async () => {
  const { owner, post } = setup()
  const initial = await owner.read('ref')
  const late = Promise.withResolvers<ReturnType<typeof response>>()
  post.mockReturnValueOnce(late.promise)
  const pending = owner.read('ref', { limit: 41 })
  await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(2))
  post.mockResolvedValueOnce(response('', { timeline_items: [] }))
  const refreshed = await owner.read('ref', { mode: 'refresh', reconcile: true, windowTokens: initial.unified!.windowTokens })
  expect(refreshed.unified?.events).toEqual([])
  late.resolve(response('deleted body'))
  await expect(pending).rejects.toMatchObject({ code: 'chat-timeline-stale' })
  expect((await owner.read('ref', { cacheOnly: true })).unified?.events).toEqual([])
})
it('coalesces a sessions hint burst without flooding the storage queue and waits before local reads', async () => {
  const { owner, port } = setup()
  await owner.read('ref')
  const call = port.call.bind(port)
  let inFlight = 0, peak = 0, count = 0
  vi.spyOn(port, 'call').mockImplementation(async command => {
    if (command.kind === 'invalidate' || command.kind === 'invalidate-source') {
      count++; peak = Math.max(peak, ++inFlight)
      await new Promise(resolve => setTimeout(resolve, 1))
      try { return await call(command) } finally { inFlight-- }
    }
    return await call(command)
  })
  const hints = Array.from({ length: 120 }, (_, index) => owner.invalidate(index % 20 === 0 ? 'source-key' : `other-${index % 20}`))
  const local = owner.read('ref', { cacheOnly: true })
  await Promise.all(hints)
  expect((await local).cache).toMatchObject({ persistence: 'committed', stale: true })
  expect(count).toBe(20)
  expect(peak).toBe(1)
})
it('cancels a local read while queued storage invalidations are still draining', async () => {
  const { owner, port } = setup()
  await owner.read('ref')
  const call = port.call.bind(port)
  const gate = Promise.withResolvers<void>()
  const started = Promise.withResolvers<void>()
  vi.spyOn(port, 'call').mockImplementation(async command => {
    if (command.kind === 'invalidate') { started.resolve(); await gate.promise }
    return await call(command)
  })
  const invalidating = owner.invalidate('source-key')
  await started.promise
  const controller = new AbortController()
  const local = owner.read('ref', { cacheOnly: true }, controller.signal)
  await new Promise(resolve => setTimeout(resolve, 5))
  controller.abort(new Error('cancel storage wait'))
  await expect(local).rejects.toThrow('cancel storage wait')
  gate.resolve(); await invalidating
})
it.each(['account', 'hint', 'cancel'] as const)('rejects a response that crosses its %s fence', async fence => {
  const { owner, post, writes, changeAccount } = setup()
  await owner.read('ref')
  const deferred = Promise.withResolvers<ReturnType<typeof response>>()
  post.mockReturnValueOnce(deferred.promise)
  const controller = new AbortController()
  const pending = owner.read('ref', {}, controller.signal)
  await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(2))
  if (fence === 'account') changeAccount()
  else if (fence === 'hint') await owner.invalidate('source-key')
  else controller.abort()
  deferred.resolve(response('late'))
  await expect(pending).rejects.toThrow()
  expect(writes).toHaveBeenCalledTimes(1)
})
it('keeps a missing remote older window a cache miss instead of substituting the local tail', async () => {
  const { owner, post } = setup()
  post.mockResolvedValueOnce(response('tail', { older_has_more: true, older_cursor: 'next' }))
  const tail = await owner.read('ref')
  await expect(owner.read('ref', { cacheOnly: true, mode: 'older', cursor: tail.unified!.olderCursor }))
    .rejects.toMatchObject({ code: 'chat-timeline-cache-miss' })
  expect(post).toHaveBeenCalledTimes(1)
})

it('keeps the invalidation fence when a content change races a pending refresh', async () => {
  const { owner, post } = setup()
  const initial = await owner.read('ref')
  const gate = Promise.withResolvers<ReturnType<typeof response>>()
  post.mockReturnValueOnce(gate.promise)
  const pending = owner.read('ref', { mode:'refresh',windowTokens:initial.unified!.windowTokens,reconcile:true })
  const checked = expect(pending).rejects.toMatchObject({code:'chat-timeline-stale',retryable:true})
  await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(2))
  await owner.invalidate('source-key')
  gate.resolve(response('new content'))
  await checked
  expect((await owner.read('ref',{cacheOnly:true})).unified!.events[0]).toMatchObject({text:'old'})
})

it('commits progress through continuous arrival hints while retaining durable stale state', async () => {
  const { owner, post, writes } = setup()
  let current = await owner.read('ref')
  for (let round = 0; round < 4; round++) {
    const gate = Promise.withResolvers<ReturnType<typeof response>>()
    post.mockReturnValueOnce(gate.promise)
    const pending = owner.read('ref', { mode: 'refresh', windowTokens: current.unified!.windowTokens, reconcile: true })
    await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(round + 2))
    await Promise.all(Array.from({length: 100}, () => owner.refreshHint('source-key')))
    gate.resolve(response(`progress-${round}`))
    current = await pending
    expect(current.cache).toMatchObject({persistence:'committed',stale:true})
    expect(current.unified!.events[0]).toMatchObject({text:`progress-${round}`})
    expect((await owner.read('ref',{cacheOnly:true})).cache).toMatchObject({stale:true})
  }
  expect(writes).toHaveBeenCalledTimes(5)
  expect((await owner.read('ref')).cache).toMatchObject({persistence:'committed',stale:false})
})
it('a hard change still rejects a read after arrival hints', async () => {
  const { owner, post } = setup()
  const gate = Promise.withResolvers<ReturnType<typeof response>>()
  post.mockReturnValueOnce(gate.promise)
  const pending = owner.read('ref')
  const checked = expect(pending).rejects.toMatchObject({code:'chat-timeline-stale'})
  await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(1))
  await owner.refreshHint('source-key')
  await owner.invalidate('source-key')
  gate.resolve(response('revoked'))
  await checked
})
it('reads committed unread bodies without invented coverage, seals local pagination and restores a saved anchor offline', async () => {
  const {owner,post,changeAccount}=setup()
  const {epoch}=await owner.sync<import('../src/chat-message-sync.js').ChatSyncPlan>({action:'begin',account:'test:1'})
  const work=Array.from({length:80},(_,i)=>({id:String(i+1),revision:1,version:1,state:'available' as const,sequence:i+1,unread:true,eventId:`event:${i+1}`,itemKey:`key:${i+1}`}))
  const session={uid:'chat',kind:1,membership:1,accessible:true,complete:true,position:{cursor:80,initialized:true,membership_version:1},cacheRequired:false,scope:JSON.stringify(['test',1,'chat']),sourceKey:'source-key',work}
  const page={manifest:true,checkpoint:'private-checkpoint',hasMore:false,retry:false,sessions:[session]}
  await owner.sync({action:'manifest',account:'test:1',epoch,expectedCheckpoint:'',page,ticket:await owner.syncTicket(),now:0})
  await owner.sync({action:'freeze',account:'test:1',epoch})
  await owner.sync({action:'commit',account:'test:1',epoch,expectedCheckpoint:page.checkpoint,ticket:await owner.syncTicket(),now:0,
    page:{...page,manifest:false,sessions:[{...session,work:work.map(item=>({...item,event:{eventId:item.eventId,kind:'message' as const,source:'messages' as const,occurredAtMillis:item.sequence,orderTie:item.id,contentStatus:'available' as const,
      item:{itemUid:item.id,recordOwnerUserId:2,recordVersion:1,timelineItemKey:item.itemKey,textContent:'body'} as never}}))}]}})
  const latest=await owner.read('ref',{cacheOnly:true,limit:40})
  expect(latest.items.map(item=>item.itemUid)).toEqual(work.slice(40).map(item=>item.id))
  expect(latest.unified).toMatchObject({complete:false,windowTokens:[]})
  expect(latest.nextCursor?.unified).toMatchObject({cacheOnly:true,mode:'older'})
  expect(JSON.stringify(latest)).not.toContain('private-checkpoint')
  const older=await owner.read('ref',latest.nextCursor!.unified)
  expect(older.items).toHaveLength(40);expect(older.items[0]?.itemUid).toBe('1')
  const anchor=await owner.read('ref',{cacheOnly:true,anchorId:'message:key:20',limit:20})
  expect(anchor.items.some(item=>item.itemUid==='20')).toBe(true)
  const around=await owner.read('ref',{cacheOnly:true,mode:'around',itemUid:'20',recordOwnerUserId:2,limit:20})
  expect(around.items.some(item=>item.itemUid==='20')).toBe(true)
  await expect(owner.read('ref',{cacheOnly:true,mode:'around',itemUid:'missing',recordOwnerUserId:2})).rejects.toMatchObject({code:'chat-timeline-cache-miss'})
  await expect(owner.read('ref',{cacheOnly:true,mode:'newer',cursor:latest.unified!.olderCursor})).rejects.toMatchObject({code:'chat-timeline-cache-miss'})
  expect(post).not.toHaveBeenCalled()
  changeAccount();await expect(owner.read('ref',{cacheOnly:true})).rejects.toMatchObject({code:'chat-timeline-cache-miss'})
})
