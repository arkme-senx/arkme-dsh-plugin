import { describe, expect, it, vi } from 'vitest'
import { projectCommittedChatMessage, projectCommittedChatWindow, UnifiedTimelineLiveTail } from '../src/client/unified-timeline-live-tail.js'
import { ArkmeChatTimelineDeltaStore } from '../src/client/chat-directory-store.js'
import { ConversationReadAckQueue } from '../src/client/conversation-read-ack-queue.js'
import { CHAT_TIMELINE_SOURCES, type ArkmeUnifiedTimelineWindow } from '../src/unified-chat-timeline.js'
import type { ArkmeTimelineItem } from '../src/types.js'

const item = (sequence: number): ArkmeTimelineItem => ({ itemUid: `record-${sequence}`, timelineEventId: `event-${sequence}`,
  timelineItemKey: `relation-${sequence}`, timelineOrderTie: String(sequence).padStart(8, '0'), sequence,
  senderName: '同事', isMe: false, status: 1, sendAtMillis: sequence, title: '', textContent: `message ${sequence}` })
const window = (sequences: number[]): ArkmeUnifiedTimelineWindow => ({ protocolVersion: 2, complete: true,
  events: sequences.map(sequence => ({ eventId: item(sequence).timelineEventId!, kind: 'message', source: 'messages',
    occurredAtMillis: sequence, orderTie: item(sequence).timelineOrderTie!, contentStatus: 'available', item: item(sequence), windowToken: 'confirmed' })),
  sources: CHAT_TIMELINE_SOURCES.map(source => ({ source, status: 'ready', itemCount: 0 })),
  windowTokens: ['confirmed'], olderHasMore: true, newerHasMore: false, hasMore: true, olderCursor: 'older' })

describe('confirmed live tail', () => {
  it.each([2, 3])('recovers an existing image at version %s without advancing the sequence or replacing history', version => {
    const owner = new UnifiedTimelineLiveTail()
    const base = window([1, 2])
    const event = base.events[1]!
    if (event.kind !== 'message') throw new Error('expected message')
    event.item = { ...event.item, recordVersion: 2, mediaUnavailable: true, contentBlocks: [], messageActionsV2: true }
    const recovered = { ...item(2), recordVersion: version, contentBlocks: [{ kind: 'image' as const,
      fileAssetUid: 'image', mediaRef: 'opaque-media', fileName: 'photo.jpg', mimeType: 'image/jpeg', size: 100, sortOrder: 0 }] }
    const result = owner.receive(base, [recovered])
    expect(result.events[1]).toMatchObject({ item: { ...recovered, messageActionsV2: true } })
    expect(result.events[1]?.kind === 'message' && result.events[1].item.mediaUnavailable).not.toBe(true)
    expect(result.events[0]).toBe(base.events[0])
    expect(result.windowTokens).toBe(base.windowTokens)
    expect(result.olderCursor).toBe(base.olderCursor)
    expect(owner.hasPending).toBe(false)
    expect(owner.receive(result, [recovered])).toBe(result)
  })
  it.each(['older', 'unknown', 'deleted', 'other-occurrence'] as const)('does not recover cached media across %s boundaries', boundary => {
    const owner = new UnifiedTimelineLiveTail()
    const base = window([1])
    const event = base.events[0]!
    if (event.kind !== 'message') throw new Error('expected message')
    event.item = { ...event.item, recordVersion: 2, mediaUnavailable: true, status: boundary === 'deleted' ? 2 : 1 }
    const incoming = { ...item(1), recordVersion: boundary === 'older' ? 1 : boundary === 'unknown' ? 0 : 2,
      ...(boundary === 'other-occurrence' ? { timelineEventId: 'another-event', timelineItemKey: 'another-relation' } : {}), contentBlocks: [] }
    expect(owner.receive(base, [incoming])).toBe(base)
  })
  it('retains a recovered live attachment when an older in-flight page returns', () => {
    const owner = new UnifiedTimelineLiveTail()
    const base = window([1])
    const readRevision = owner.readRevision
    const live = owner.receive(base, [{ ...item(2), recordVersion: 1, mediaUnavailable: true }])
    const recovered = { ...item(2), recordVersion: 2, textContent: 'attachment ready' }
    owner.receive(live, [recovered])
    expect(owner.reconcile(base, readRevision).events.at(-1)).toMatchObject({ item: recovered })
  })
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
  it('requires sequence coverage or an explicit deletion to retire a delivered body', () => {
    const owner = new UnifiedTimelineLiveTail()
    owner.receive(window([1]), [item(2)])
    owner.remove(new Set(['relation-2']))
    expect(owner.reconcile(window([1]), 0).events).toHaveLength(1)
    owner.receive(window([1]), [item(2)])
    expect(owner.reconcile(window([1]), owner.readRevision).events).toHaveLength(2)
    expect(owner.reconcile(window([1, 3]), owner.readRevision).events).toHaveLength(2)
    expect(owner.hasPending).toBe(false)
  })
  it('does not infer deletion from partial or historical sequence frontiers', () => {
    for (const partial of [{ ...window([1, 3]), complete: false }, { ...window([1, 3]), newerHasMore: true }]) {
      const owner = new UnifiedTimelineLiveTail()
      owner.receive(window([1]), [item(2)])
      owner.reconcile(partial, owner.readRevision)
      expect(owner.hasPending).toBe(true)
      expect(owner.reconcile(window([1]), owner.readRevision).events.map(event => event.eventId)).toEqual(['event-1', 'event-2'])
    }
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

it('projects committed edits and removals in a historical window without changing its coverage', () => {
  const history = { ...window([5, 6, 7]), newerHasMore: true }
  const changes = new Map([
    ['relation-5', { itemKey: 'relation-5', revision: 10, version: 2, item: { ...item(5), recordVersion: 2, textContent: 'edited' } }],
    ['relation-6', { itemKey: 'relation-6', revision: 11, version: 0 }],
  ])
  const projected = projectCommittedChatWindow(history, changes)
  expect(projected.events).toMatchObject([{ eventId: 'event-5', item: { sequence: 5, textContent: 'edited' } }, { eventId: 'event-7' }])
  expect(projected).toMatchObject({ newerHasMore: true, windowTokens: ['confirmed'], olderCursor: 'older' })
  expect(projectCommittedChatWindow(history, changes).events).toEqual(projected.events)
})

it('preserves the confirmed recall capability when a synced body replaces the same message', () => {
  const canonical = { ...item(5), isMe: true, messageActionRef: 'confirmed-ref', messageActionsV2: true }
  const synced = { ...item(5), isMe: true, messageActionRef: 'synced-ref', recordVersion: 2 }
  const change = { itemKey: 'relation-5', revision: 10, version: 2, item: synced }
  expect(projectCommittedChatMessage(canonical, new Map([['relation-5', change]])))
    .toMatchObject({ messageActionsV2: true, messageActionRef: 'synced-ref', recordVersion: 2 })
  expect(projectCommittedChatMessage(canonical, new Map([['relation-5', { ...change, item: undefined }]]))).toBeUndefined()
  expect(projectCommittedChatMessage(canonical, new Map([['relation-5', { ...change, item: { ...synced, messageActionsV2: false } }]])))
    .toMatchObject({ messageActionsV2: false })
})

it('keeps an entire manifest page of removals available to a mounted window', () => {
  const store = new ArkmeChatTimelineDeltaStore()
  store.applySyncProjections([{ sourceKey: 'chat', changes: Array.from({ length: 1000 }, (_, i) => ({
    itemKey: `relation-${i + 1}`, revision: i + 1, version: 1,
  })) }])
  const changes = store.getSnapshotForSource('chat').syncChanges!
  expect(projectCommittedChatWindow(window([1, 1000, 1001]), changes).events.map(row => row.eventId)).toEqual(['event-1001'])
})

it('stabilizes committed projections with inherited capabilities across repeated layout commits', () => {
  const history = window([5])
  const event = history.events[0]!
  if (event.kind !== 'message') throw new Error('expected message fixture')
  event.item = { ...event.item, messageActionsV2: true }
  const synced = { ...item(5), recordVersion: 2, textContent: 'edited' }
  const changes = new Map([['relation-5', { itemKey: 'relation-5', revision: 10, version: 2, item: synced }]])
  const projected = projectCommittedChatWindow(history, changes)
  expect(projected.events[0]).toMatchObject({ item: { textContent: 'edited', messageActionsV2: true } })
  expect(projectCommittedChatWindow(projected, changes)).toBe(projected)
  expect(synced).not.toHaveProperty('messageActionsV2')
  const next = { ...synced, recordVersion: 3, textContent: 'edited again' }
  changes.set('relation-5', { itemKey: 'relation-5', revision: 11, version: 3, item: next })
  const updated = projectCommittedChatWindow(projected, changes)
  expect(updated.events[0]).toMatchObject({ item: { textContent: 'edited again', recordVersion: 3, messageActionsV2: true } })
  expect(projectCommittedChatWindow(updated, changes)).toBe(updated)
})
