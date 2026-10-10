import { describe, expect, it, vi } from 'vitest'
import { refreshUnifiedTimelineWindow } from '../src/client/unified-timeline-window.js'
import { reconcileUnifiedTimeline } from '../src/unified-timeline-reconcile.js'
import { CHAT_TIMELINE_SOURCES, type ArkmeUnifiedTimelineEvent, type ArkmeUnifiedTimelineWindow } from '../src/unified-chat-timeline.js'
import type { ArkmeTimelinePage } from '../src/types.js'
const event = (eventId: string, text = eventId, source: ArkmeUnifiedTimelineEvent['source'] = 'world_public'): ArkmeUnifiedTimelineEvent => ({ eventId, text, source, kind: 'notice', orderTie: eventId, occurredAtMillis: 1, contentStatus: 'available' })
const window = (events: ArkmeUnifiedTimelineEvent[] = []): ArkmeUnifiedTimelineWindow => ({ protocolVersion: 1, events,
  sources: CHAT_TIMELINE_SOURCES.map(source => ({ source, status: 'ready', itemCount: 0 })), complete: true,
  windowTokens: ['window'], hasMore: false, olderHasMore: true, newerHasMore: false, olderCursor: 'history-frontier', newerCursor: 'tail-frontier' })
const page = (unified: ArkmeUnifiedTimelineWindow): ArkmeTimelinePage => ({ source: {} as never, items: [], unified, hasMore: unified.hasMore })
const signal = () => new AbortController().signal

describe('unified window publication', () => {
  it('makes one Host reconciliation call and preserves the reading frontier', async () => {
    const read = vi.fn().mockResolvedValue(page({ ...window([event('same', 'edited'), event('new')]), newerCursor: 'new-tail' }))
    const result = await refreshUnifiedTimelineWindow(window([event('same', 'old')]), read, signal(), true)
    expect(read).toHaveBeenCalledExactlyOnceWith({ unified: { mode: 'refresh', windowTokens: ['window'], reconcile: true, newerCursor: 'tail-frontier' } })
    expect(result.unified?.events.find(event => event.eventId === 'same')).toMatchObject({ text: 'edited' })
    expect(result.unified?.olderCursor).toBe('history-frontier')
    expect(result.unified?.newerCursor).toBe('new-tail')
  })
  it('never publishes a failed refresh or mutates the previous window', async () => {
    const previous = window([event('same', 'old')]); const original = structuredClone(previous)
    await expect(refreshUnifiedTimelineWindow(previous, vi.fn().mockRejectedValue(new Error('offline')), signal(), false)).rejects.toThrow('offline')
    expect(previous).toEqual(original)
  })
  it('keeps gap content and retires explicitly inapplicable content', async () => {
    const previous = window([event('gap', 'retained', 'interwoven'), event('retire', 'gone', 'wechat_import')])
    const next = window(); next.complete = false; next.sources.find(s => s.source === 'interwoven')!.status = 'gap'
    next.sources.find(s => s.source === 'wechat_import')!.status = 'not_applicable'
    const result = await refreshUnifiedTimelineWindow(previous, vi.fn().mockResolvedValue(page(next)), signal(), true)
    expect(result.unified?.events.map(e => e.eventId)).toEqual(['gap'])
    expect(result.unified?.complete).toBe(false)
  })
  it('never follows the tail while restoring an around window; cancellation suppresses publication', async () => {
    const read = vi.fn().mockResolvedValue(page(window([event('anchor')])))
    await refreshUnifiedTimelineWindow(window(), read, signal(), false)
    expect(read.mock.calls[0]?.[0].unified.newerCursor).toBeUndefined()
    const controller = new AbortController(); controller.abort()
    await expect(refreshUnifiedTimelineWindow(window(), read, controller.signal, false)).rejects.toThrow()
    expect(read).toHaveBeenCalledTimes(1)
  })
})

describe('Host reconciliation bounds', () => {
  it('drains empty filtered pages, auxiliary pages and the tail before returning', async () => {
    const read = vi.fn().mockResolvedValueOnce(page({ ...window(), hasMore: true, nextCursor: 'next' }))
      .mockResolvedValueOnce(page(window([event('old', 'edited')]))).mockResolvedValueOnce(page(window([event('new')])))
    const result = await reconcileUnifiedTimeline({ mode: 'refresh', windowTokens: ['covered'], newerCursor: 'tail' }, read, signal())
    expect(result.unified?.events.map(event => event.eventId).sort()).toEqual(['new', 'old'])
    expect(read.mock.calls.map(args => args[0])).toEqual([
      { mode: 'refresh', windowTokens: ['covered'], limit: undefined },
      { mode: 'refresh', cursor: 'next', limit: undefined },
      { mode: 'newer', cursor: 'tail', limit: undefined },
    ])
  })
  it('rejects repeated continuation, overflow and failures without returning partial data', async () => {
    const repeated = vi.fn().mockResolvedValue(page({ ...window(), hasMore: true, nextCursor: 'repeat' }))
    await expect(reconcileUnifiedTimeline({ windowTokens: ['w'] }, repeated, signal())).rejects.toThrow('未推进')
    expect(repeated).toHaveBeenCalledTimes(2)
    await expect(reconcileUnifiedTimeline({ windowTokens: ['w'] }, async () => page(window([event('large', 'x'.repeat(4 * 1024 * 1024))])), signal())).rejects.toThrow('容量')
    const failed = vi.fn().mockResolvedValueOnce(page({ ...window([event('partial')]), hasMore: true, nextCursor: 'next' })).mockRejectedValueOnce(new Error('offline'))
    await expect(reconcileUnifiedTimeline({ windowTokens: ['w'] }, failed, signal())).rejects.toThrow('offline')
  })
})
