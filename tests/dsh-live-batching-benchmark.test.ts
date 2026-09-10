import { afterEach, expect, it, vi } from 'vitest'
import { DshLiveEventBatcher } from '../src/dsh-remote/live-event-batcher.js'
import type { DshRemoteHistoryEntry } from '../src/dsh-remote/dsh-event-contract.js'

afterEach(() => { vi.useRealTimers() })

// Same generated stream and simulated local-write/ACK workload for both schedules.
// The baseline mirrors the former 40ms producer-side sealing + immutable Promise tail.
async function run(coalesced: boolean) {
  vi.useFakeTimers({ now: 0 })
  const ages: number[] = []; const delivered: number[] = []; let batches = 0
  const publish = async (entries: DshRemoteHistoryEntry[]) => {
    batches++
    await new Promise(resolve => setTimeout(resolve, 4 + 80))
    for (const entry of entries) { ages.push(Date.now() - (entry.event.time - 1)); delivered.push(entry.event.seq) }
  }
  const queue = new DshLiveEventBatcher({ now: Date.now,
    publish: async batch => { await publish(batch.entries) },
    replay: async () => { throw new Error('benchmark should fit memory bounds') },
    onError: error => { throw error },
  })
  let buffer: DshRemoteHistoryEntry[] = []
  let timer: ReturnType<typeof setTimeout> | undefined
  let tail = Promise.resolve()
  const flush = () => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    if (buffer.length === 0) return
    const entries = buffer; buffer = []
    tail = tail.then(async () => { await publish(entries) })
  }
  for (let seq = 0; seq <= 1500; seq++) {
    setTimeout(() => {
      const type = seq === 1500 ? 'turn/end' : seq % 120 === 0 ? 'tool/result' : 'assistant/chunk'
      const entry = { event: { seq, type, time: Date.now() + 1, data: { text: 'token' } } }
      if (coalesced) queue.enqueue('session', entry, entry.event.time)
      else {
        buffer.push(entry)
        if (type !== 'assistant/chunk' || buffer.length >= 50) flush()
        else timer ??= setTimeout(flush, 40)
      }
    }, seq * 1000 / 150)
  }
  await vi.advanceTimersByTimeAsync(30_000)
  if (coalesced) await queue.flush()
  else await tail
  expect(delivered).toEqual(Array.from({ length: 1501 }, (_, i) => i))
  ages.sort((a, b) => a - b)
  queue.close()
  return { batches, p95Ms: ages[Math.floor(ages.length * 0.95)]!, maxMs: ages.at(-1)! }
}

it('does not accumulate seconds of queue age under the recorded-class event rate', async () => {
  const baseline = await run(false)
  const coalesced = await run(true)
  console.info('DSH_BATCHING_BENCHMARK', JSON.stringify({ eventsPerSecond: 150, localCaptureMs: 4, ackMs: 80, baseline, coalesced }))
  expect(coalesced.batches).toBeLessThan(baseline.batches * 0.6)
  expect(coalesced.p95Ms).toBeLessThan(250)
  expect(coalesced.maxMs).toBeLessThan(300)
})
