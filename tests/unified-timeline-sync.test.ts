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
      case 'reserve': result = store.reserve(); break
      case 'read': result = readbackMissing ? undefined : store.read(command.scope, command.request, command.anchorId, command.latest); break
      case 'write': writes(command); result = store.write(command.scope, command.request, command.page, command.options); break
      case 'invalidate': store.invalidate(command.scope, command.timelineItemKey, command.terminal); break
      case 'invalidate-source': store.invalidateSource(command.sourceKey, command.timelineItemKey, command.terminal); break
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
