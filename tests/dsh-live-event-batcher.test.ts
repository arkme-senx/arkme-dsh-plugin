import { afterEach, describe, expect, it, vi } from 'vitest'
import { DshLiveEventBatcher, LIVE_BATCH_BYTES, LIVE_BATCH_ITEMS, type LiveEventBatch } from '../src/dsh-remote/live-event-batcher.js'
import type { DshRemoteHistoryEntry } from '../src/dsh-remote/dsh-event-contract.js'

const entry = (seq: number, type = 'assistant/chunk', size = 8): DshRemoteHistoryEntry => ({
  event: { seq, time: seq + 1, type, data: { text: 'x'.repeat(size) } },
})
const replay = async (_ref: string, _after: number, throughSeq: number) => ({ entries: [], throughSeq })
afterEach(() => { vi.useRealTimers() })

describe('consumer-formed live event batches', () => {
  it('coalesces events behind a slow ACK and keeps tool/turn events in sequence', async () => {
    vi.useFakeTimers()
    const gate = Promise.withResolvers<void>()
    const sent: LiveEventBatch[] = []
    let active = 0; let maxActive = 0
    const queue = new DshLiveEventBatcher({ now: Date.now, replay, onError: error => { throw error },
      publish: async batch => {
        active++; maxActive = Math.max(maxActive, active); sent.push(batch)
        if (sent.length === 1) await gate.promise
        active--
      } })
    queue.enqueue('session', entry(0, 'turn/start'), 1)
    await vi.advanceTimersByTimeAsync(0)
    for (let seq = 1; seq <= 201; seq++) queue.enqueue('session', entry(seq, seq === 100 ? 'tool/result' : seq === 201 ? 'turn/end' : 'assistant/chunk'), seq + 1)
    expect(sent).toHaveLength(1)
    gate.resolve()
    await queue.flush()
    expect(sent).toHaveLength(6)
    expect(sent.flatMap(batch => batch.entries.map(e => e.event.seq))).toEqual(Array.from({ length: 202 }, (_, i) => i))
    expect(sent.every(batch => batch.entries.length <= LIVE_BATCH_ITEMS && batch.bytes <= LIVE_BATCH_BYTES)).toBe(true)
    expect(maxActive).toBe(1)
    expect(queue.stats()).toEqual({ bufferedBytes: 0, bufferedEntries: 0, pendingSessions: 0 })
    queue.close(); expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps the short idle chunk delay but flushes a following critical event immediately', async () => {
    vi.useFakeTimers()
    const publish = vi.fn(async (_batch: LiveEventBatch) => undefined)
    const queue = new DshLiveEventBatcher({ now: Date.now, publish, replay, onError: vi.fn() })
    queue.enqueue('s', entry(1), 1)
    await vi.advanceTimersByTimeAsync(39)
    expect(publish).not.toHaveBeenCalled()
    queue.enqueue('s', entry(2, 'tool/call'), 2)
    await vi.advanceTimersByTimeAsync(0)
    expect(publish.mock.calls[0]![0].entries.map(e => e.event.seq)).toEqual([1, 2])
    queue.close()
  })

  it('caps resident entries and replays overflow through canonical history without losing capture order', async () => {
    vi.useFakeTimers()
    const source = Array.from({ length: 151 }, (_, seq) => entry(seq, seq === 0 ? 'turn/start' : 'assistant/chunk'))
    const gate = Promise.withResolvers<void>(); const sent: LiveEventBatch[] = []
    const read = vi.fn(async (_ref: string, after: number, throughSeq: number) => ({ entries: source.filter(e => e.event.seq > after && e.event.seq <= throughSeq), throughSeq }))
    const queue = new DshLiveEventBatcher({ now: Date.now, maxBufferEntries: 3, maxBufferBytes: 1000, replay: read, onError: vi.fn(),
      publish: async batch => { sent.push(batch); if (sent.length === 1) await gate.promise } })
    queue.enqueue('s', source[0]!, 1); await vi.advanceTimersByTimeAsync(0)
    for (const e of source.slice(1)) queue.enqueue('s', e, e.event.time)
    expect(queue.stats().bufferedEntries).toBeLessThanOrEqual(3)
    expect(queue.stats().bufferedBytes).toBeLessThanOrEqual(1000)
    gate.resolve(); await queue.flush()
    expect(read).toHaveBeenCalled()
    expect(sent.flatMap(batch => batch.entries.map(e => e.event.seq))).toEqual(source.map(e => e.event.seq))
    expect(sent.some(batch => batch.replayed)).toBe(true)
    queue.close()
  })

  it('honors the byte ceiling while retaining the existing oversized-single-event path', async () => {
    vi.useFakeTimers()
    const sent: LiveEventBatch[] = []; const gate = Promise.withResolvers<void>()
    const queue = new DshLiveEventBatcher({ now: Date.now, replay, onError: vi.fn(), publish: async batch => { sent.push(batch); if (sent.length === 1) await gate.promise } })
    queue.enqueue('s', entry(0, 'turn/start'), 1); await vi.advanceTimersByTimeAsync(0)
    for (let i = 1; i <= 6; i++) queue.enqueue('s', entry(i, 'assistant/chunk', 12 * 1024), i + 1)
    queue.enqueue('s', entry(7, 'tool/result', 40 * 1024), 8)
    gate.resolve(); await queue.flush()
    expect(sent.map(batch => batch.entries.length)).toEqual([1, 2, 2, 2, 1])
    expect(sent.filter(batch => batch.entries.length > 1).every(batch => batch.bytes <= LIVE_BATCH_BYTES)).toBe(true)
    queue.close()
  })

  it('does not advance through unavailable history or spin when new events arrive during backoff', async () => {
    vi.useFakeTimers()
    const read = vi.fn().mockRejectedValueOnce(new Error('not yet available')).mockImplementation(async (_ref, after, throughSeq) => ({ entries: Array.from({ length: throughSeq - after }, (_, i) => entry(after + i + 1)), throughSeq }))
    const errors = vi.fn(); const sent: LiveEventBatch[] = []
    const queue = new DshLiveEventBatcher({ now: Date.now, maxBufferEntries: 0, replay: read, onError: errors, publish: async batch => { sent.push(batch) } })
    queue.enqueue('s', entry(0, 'turn/start'), 1); await vi.advanceTimersByTimeAsync(0)
    queue.enqueue('s', entry(1, 'turn/end'), 2); await vi.advanceTimersByTimeAsync(1000)
    expect(read).toHaveBeenCalledTimes(1); expect(sent).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1000)
    expect(sent.flatMap(batch => batch.entries.map(e => e.event.seq))).toEqual([0, 1])
    queue.close()
  })

  it('close discards old-scope work and leaves no timer or later publication', async () => {
    vi.useFakeTimers()
    const gate = Promise.withResolvers<void>(); const publish = vi.fn(async () => { await gate.promise })
    const queue = new DshLiveEventBatcher({ now: Date.now, replay, onError: vi.fn(), publish })
    queue.enqueue('s', entry(0, 'turn/start'), 1); await vi.advanceTimersByTimeAsync(0)
    queue.enqueue('s', entry(1), 2); queue.close(); gate.resolve(); await vi.advanceTimersByTimeAsync(100)
    expect(publish).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0)
    expect(queue.stats().pendingSessions).toBe(0)
  })
})

it('rotates sessions after each batch and ignores repeated canonical sequence numbers', async () => {
  vi.useFakeTimers()
  const gate = Promise.withResolvers<void>(); const sent: LiveEventBatch[] = []
  const queue = new DshLiveEventBatcher({ now: Date.now, replay, onError: vi.fn(),
    publish: async batch => { sent.push(batch); if (sent.length === 1) await gate.promise } })
  queue.enqueue('a', entry(0, 'turn/start'), 1); await vi.advanceTimersByTimeAsync(0)
  for (let seq = 1; seq <= 120; seq++) {
    queue.enqueue('a', entry(seq), seq); queue.enqueue('a', entry(seq), seq)
  }
  queue.enqueue('b', entry(8, 'turn/start'), 1)
  gate.resolve(); await queue.flush()
  expect(sent[1]?.sessionRef).toBe('b')
  expect(sent.filter(batch => batch.sessionRef === 'a').flatMap(batch => batch.entries.map(e => e.event.seq)))
    .toEqual(Array.from({ length: 121 }, (_, i) => i))
  queue.close()
})

it('retains replay position on invalid ranges or unordered history', async () => {
  vi.useFakeTimers()
  const read = vi.fn().mockResolvedValueOnce({ entries: [entry(2), entry(1)], throughSeq: 2 })
    .mockResolvedValueOnce({ entries: [entry(0), entry(1), entry(2)], throughSeq: 2 })
  const publish = vi.fn(async () => undefined)
  const queue = new DshLiveEventBatcher({ now: Date.now, maxBufferEntries: 0, replay: read, publish, onError: vi.fn() })
  for (let i = 0; i < 3; i++) queue.enqueue('s', entry(i, 'turn/start'), 1)
  await vi.advanceTimersByTimeAsync(0)
  expect(publish).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(2000)
  expect(read.mock.calls[1]?.slice(1)).toEqual([-1, 2])
  expect(publish).toHaveBeenCalledOnce()
  queue.close()
})

it('rejects admission beyond 256 pending sessions without allocating another queue', () => {
  vi.useFakeTimers()
  const queue = new DshLiveEventBatcher({ now: Date.now, replay, publish: async () => undefined, onError: vi.fn() })
  for (let i = 0; i < 256; i++) queue.enqueue(`s${i}`, entry(0), 1)
  expect(() => queue.enqueue('overflow', entry(0), 1)).toThrow('pending-session limit')
  expect(queue.stats().pendingSessions).toBe(256)
  queue.close(); expect(vi.getTimerCount()).toBe(0)
})
