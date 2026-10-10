import { describe, expect, it, vi } from 'vitest'
import { refreshUnifiedTimelineWindow } from '../src/client/unified-timeline-window.js'
import { CHAT_TIMELINE_SOURCES, type ArkmeUnifiedTimelineEvent, type ArkmeUnifiedTimelineWindow } from '../src/unified-chat-timeline.js'
import type { ArkmeTimelinePage } from '../src/types.js'
const event = (eventId: string, text: string, source: ArkmeUnifiedTimelineEvent['source'] = 'world_public'): ArkmeUnifiedTimelineEvent => ({ eventId, text, source, kind: 'notice', orderTie: eventId, occurredAtMillis: 1, contentStatus: 'available' })
const window = (events: ArkmeUnifiedTimelineEvent[] = []): ArkmeUnifiedTimelineWindow => ({ protocolVersion: 1, events,
  sources: CHAT_TIMELINE_SOURCES.map(source => ({ source, status: 'ready', itemCount: 0 })), complete: true,
  windowTokens: ['window'], hasMore: false, olderHasMore: true, newerHasMore: false, olderCursor: 'history-frontier', newerCursor: 'tail-frontier' })
const page = (unified: ArkmeUnifiedTimelineWindow): ArkmeTimelinePage => ({ source: {} as never, items: [], unified, hasMore: unified.hasMore })
const signal = () => new AbortController().signal

describe('unified window publication', () => {
  it('drains auxiliary-only refresh pages and chases newer while preserving the history frontier', async () => {
    const old = window([event('same', 'old')])
    const first = { ...window([event('same', 'edited')]), hasMore: true, nextCursor: 'continuation' }
    const read = vi.fn().mockResolvedValueOnce(page(first)).mockResolvedValueOnce(page(window([event('late', 'late old-time event')])))
      .mockResolvedValueOnce(page({ ...window([event('new', 'new event')]), newerCursor: 'new-tail' }))
    const result = await refreshUnifiedTimelineWindow(old, read, signal(), true)
    expect(result.unified!.events.map(e => e.eventId).sort()).toEqual(['late', 'new', 'same'])
    expect(result.unified!.events.find(e => e.eventId === 'same')).toMatchObject({ text: 'edited' })
    expect(read.mock.calls.map(args => args[0])).toEqual([{ unified: { mode: 'refresh', windowTokens: ['window'] } }, { unified: { mode: 'refresh', cursor: 'continuation' } }, { unified: { mode: 'newer', cursor: 'tail-frontier' } }])
    expect(result.unified!.olderCursor).toBe('history-frontier')
    expect(result.unified!.newerCursor).toBe('new-tail')
  })
  it('never publishes a partial refresh when a continuation fails', async () => {
    const old = window([event('same', 'old')]); const original = structuredClone(old)
    const read = vi.fn().mockResolvedValueOnce(page({ ...window([event('same', 'edited')]), hasMore: true, nextCursor: 'next' })).mockRejectedValueOnce(new Error('offline'))
    await expect(refreshUnifiedTimelineWindow(old, read, signal(), false)).rejects.toThrow('offline')
    expect(old).toEqual(original)
  })
  it('keeps gap content and retires explicitly inapplicable content even during tail catch-up', async () => {
    const old = window([event('gap', 'retained', 'interwoven'), event('retire', 'gone', 'wechat_import')])
    const refresh = window(); refresh.complete = false; refresh.sources.find(s => s.source === 'interwoven')!.status = 'gap'
    const tail = window(); tail.sources.find(s => s.source === 'wechat_import')!.status = 'not_applicable'
    const read = vi.fn().mockResolvedValueOnce(page(refresh)).mockResolvedValueOnce(page(tail))
    const result = await refreshUnifiedTimelineWindow(old, read, signal(), true)
    expect(result.unified!.events.map(e => e.eventId)).toEqual(['gap'])
    expect(result.unified!.complete).toBe(false)
    expect(result.unified!.sources.find(s => s.source === 'wechat_import')!.status).toBe('not_applicable')
  })
  it('refreshes around without chasing the latest conversation tail', async () => {
    const read = vi.fn().mockResolvedValue(page(window([event('anchor', 'anchor')])))
    await refreshUnifiedTimelineWindow(window(), read, signal(), false)
    expect(read).toHaveBeenCalledTimes(1)
  })
  it('rejects repeated continuations and observes cancellation', async () => {
    const read = vi.fn().mockResolvedValue(page({ ...window(), hasMore: true, nextCursor: 'same' }))
    await expect(refreshUnifiedTimelineWindow(window(), read, signal(), false)).rejects.toThrow('未推进')
    expect(read).toHaveBeenCalledTimes(2)
    const controller = new AbortController(); controller.abort()
    await expect(refreshUnifiedTimelineWindow(window(), read, controller.signal, false)).rejects.toThrow()
    expect(read).toHaveBeenCalledTimes(2)
  })
})
