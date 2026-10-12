import { describe, expect, it, vi } from 'vitest'
import { UnifiedTimelineLiveTail } from '../src/client/unified-timeline-live-tail.js'
import { ConversationReadAckQueue } from '../src/client/conversation-read-ack-queue.js'
import { CHAT_TIMELINE_SOURCES, type ArkmeUnifiedTimelineWindow } from '../src/unified-chat-timeline.js'
import type { ArkmeTimelineItem } from '../src/types.js'

const item = (sequence: number): ArkmeTimelineItem => ({ itemUid: `record-${sequence}`, timelineEventId: `event-${sequence}`,
  timelineItemKey: `relation-${sequence}`, timelineOrderTie: String(sequence).padStart(8, '0'), sequence,
  senderName: '同事', isMe: false, status: 1, sendAtMillis: sequence, title: '', textContent: `message ${sequence}` })
const window = (sequences: number[]): ArkmeUnifiedTimelineWindow => ({ protocolVersion: 1, complete: true,
  events: sequences.map(sequence => ({ eventId: item(sequence).timelineEventId!, kind: 'message', source: 'messages',
    occurredAtMillis: sequence, orderTie: item(sequence).timelineOrderTie!, contentStatus: 'available', item: item(sequence), windowToken: 'confirmed' })),
  sources: CHAT_TIMELINE_SOURCES.map(source => ({ source, status: 'ready', itemCount: 0 })),
  windowTokens: ['confirmed'], olderHasMore: true, newerHasMore: false, hasMore: true, olderCursor: 'older' })

describe('confirmed live tail', () => {
  it('displays every continuous arrival before an in-flight page, retaining identities and bounded coverage', () => {
    const owner = new UnifiedTimelineLiveTail()
    let live = window([1])
    const before = owner.readRevision
    for (let n = 2; n <= 101; n++) {
      live = owner.receive(live, [item(n)])
      expect(live.events.at(-1)?.eventId).toBe(`event-${n}`)
      expect(live.events).toHaveLength(n)
    }
    const raced = owner.reconcile(window([1]), before)
    expect(raced.events).toHaveLength(101)
    expect(raced.windowTokens).toEqual(['confirmed'])
    expect(raced.olderCursor).toBe('older')
    expect(owner.reconcile(window(Array.from({ length: 40 }, (_, i) => i + 62)), owner.readRevision).events).toHaveLength(40)
    expect(owner.hasPending).toBe(false)
  })
  it('falls back on gaps, unavailable content, partial sources and historical windows', () => {
    for (const base of [window([1]), { ...window([1]), complete: false }, { ...window([1]), newerHasMore: true }]) {
      const owner = new UnifiedTimelineLiveTail()
      expect(owner.receive(base, [item(3)])).toBe(base)
      expect(owner.receive(base, [{ ...item(2), status: 0 }])).toBe(base)
      expect(owner.receive(base, [{ ...item(2), timelineEventId: undefined }])).toBe(base)
      if (!base.complete || base.newerHasMore) expect(owner.receive(base, [item(2)])).toBe(base)
    }
  })
  it('never revives a deleted arrival or retains an omission confirmed by a later read', () => {
    const owner = new UnifiedTimelineLiveTail()
    owner.receive(window([1]), [item(2)])
    owner.remove(new Set(['relation-2']))
    expect(owner.reconcile(window([1]), 0).events).toHaveLength(1)
    owner.receive(window([1]), [item(2)])
    expect(owner.reconcile(window([1]), owner.readRevision).events).toHaveLength(1)
  })
  it('caps the active window and keeps same-record occurrences distinct', () => {
    const owner = new UnifiedTimelineLiveTail()
    const base = window(Array.from({ length: 1999 }, (_, i) => i + 1))
    const live = owner.receive(base, [{ ...item(2000), itemUid: 'record-1' }, item(2001)])
    expect(live.events).toHaveLength(2000)
    expect(live.events.at(-1)?.eventId).toBe('event-2000')
  })
  it('coalesces acknowledgements to one in flight plus the newest pending cursor', async () => {
    const queue = new ConversationReadAckQueue(0)
    const blocked = Promise.withResolvers<void>()
    const run = vi.fn(async (_sequence: number) => {})
    const first = queue.enqueue(1, async () => { await blocked.promise })
    await Promise.resolve()
    for (let n = 2; n <= 101; n++) queue.enqueue(n, async () => { await run(n) })
    expect(run).not.toHaveBeenCalled()
    blocked.resolve()
    await first
    expect(run).toHaveBeenCalledExactlyOnceWith(101)
  })
})


it('bounds acknowledgement starts and flushes only the latest observed cursor on leaving', async () => {
  vi.useFakeTimers()
  try {
    const queue = new ConversationReadAckQueue()
    const calls: number[] = []
    const enqueue = (n: number) => queue.enqueue(n, async () => { calls.push(n) })
    await enqueue(1)
    for (let n = 2; n <= 101; n++) {
      void enqueue(n)
      await vi.advanceTimersByTimeAsync(5)
    }
    expect(calls).toEqual([1])
    await vi.advanceTimersByTimeAsync(500)
    expect(calls).toEqual([1, 101])
    const last = enqueue(102)
    await vi.advanceTimersByTimeAsync(10)
    expect(calls).toEqual([1, 101])
    queue.close()
    await last
    expect(calls).toEqual([1, 101, 102])
    expect(vi.getTimerCount()).toBe(0)
  } finally { vi.useRealTimers() }
})
