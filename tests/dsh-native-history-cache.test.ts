import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { DshNativeHistoryCache } from '../src/dsh-remote/native-history-cache.js'
import { readFiveTurns, type NativeHistoryRecord } from '../src/dsh-remote/native-history.js'

const cleanups: Array<() => void> = []
afterEach(() => cleanups.splice(0).reverse().forEach(fn => fn()))
const turns = (count: number): NativeHistoryRecord[] => Array.from({ length: count }, (_, turn) =>
  ['turn/start', 'user/message', 'assistant/message', 'tool/result', 'assistant/message', 'turn/end'].map((type, offset) => ({ type: 'event' as const, event: { type, seq: turn * 6 + offset, time: turn, data: {}, ...(type.endsWith('/message') ? { surfaceOp: 'append' } : {}) } }))).flat()
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'dsh cache '))
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }))
  const cache = new DshNativeHistoryCache(directory)
  cleanups.push(() => cache.close())
  return { cache, directory }
}
it('pages five native turns, not ten messages, and retains every tool and replacement event', async () => {
  const records = turns(12)
  records[50]!.event.surfaceOp = { op: 'replace', startSeq: 44, endSeq: 44 }
  let calls = 0
  const result = await readFiveTurns({ records: records.slice(63), hasMore: true }, async before => {
    calls++
    return { records: records.slice(Math.max(0, before - 10), before), hasMore: before > 10 }
  })
  expect(calls).toBe(3)
  expect(result.records).toEqual(records.slice(42))
  expect(result.records.filter(record => record.event.type === 'turn/start')).toHaveLength(5)
  expect(result.hasMore).toBe(true)
})
it('survives reopening, serves older pages locally, and isolates accounts, runtimes and same session ids', () => {
  const { cache, directory } = fixture(), records = turns(12)
  const key = DshNativeHistoryCache.key('3016', 'windows', { kind: 'session', sessionId: 'same' })
  const snapshot = { type: 'snapshot', cursor: 71, records: records.slice(42), projections: { asOfSeq: 71, values: {} }, hasMore: true }
  cache.write(key, snapshot.records, snapshot)
  expect(cache.page(key, 71)?.records).toEqual(records.slice(42))
  expect(cache.page(key, 71, 42)).toBeUndefined()
  cache.write(key, records.slice(12, 42))
  cache.write(key, records.slice(12, 42))
  const reopened = new DshNativeHistoryCache(directory)
  try {
    expect(reopened.page(key, 71, 42)?.records).toEqual(records.slice(12, 42))
    expect(reopened.page(key, 71, 12)).toBeUndefined()
    expect(reopened.snapshot(key)?.cursor).toBe(71)
    for (const other of [DshNativeHistoryCache.key('other', 'windows', { kind: 'session', sessionId: 'same' }), DshNativeHistoryCache.key('3016', 'mac', { kind: 'session', sessionId: 'same' })]) expect(reopened.page(other, 71)).toBeUndefined()
  } finally { reopened.close() }
})
it('does not publish a cache page with gaps, rolls back invalid batches, and resets a rewound log', () => {
  const { cache } = fixture(), records = turns(7), key = 'scope'
  cache.write(key, records.slice(12), { cursor: 41, hasMore: true })
  cache.write(key, [records[10]!])
  expect(cache.page(key, 41, 12)).toBeUndefined()
  expect(() => cache.write(key, [records[11]!, { type: 'event', event: { type: 'x', seq: -1 } }])).toThrow()
  expect(cache.page(key, 41, 12)).toBeUndefined()
  cache.write(key, records.slice(0, 6), { cursor: 5, hasMore: false })
  expect(cache.page(key, 5)).toEqual({ records: records.slice(0, 6), hasMore: false })
  expect(cache.page(key, 41)).toBeUndefined()
})
it('rejects nonadvancing source pages instead of hiding missing history', async () => {
  await expect(readFiveTurns({ records: turns(1), hasMore: true }, async () => ({ records: [], hasMore: false }))).rejects.toThrow('不连续')
})
it('evicts whole sessions at the capacity bound and never invents an empty foreign page', () => {
  const { cache } = fixture()
  for (let i = 0; i < 257; i++) cache.write(`key-${String(i).padStart(3, '0')}`, turns(1), { cursor: 5, hasMore: false })
  let retained = 0
  for (let i = 0; i < 257; i++) if (cache.snapshot(`key-${String(i).padStart(3, '0')}`)) retained++
  expect(retained).toBe(256)
  expect(cache.page('foreign', -1)).toBeUndefined()
})
