import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { RecordThoughtStore } from '../src/client/record-thought-store.js'
import type { ArkmeRecordThoughts } from '../src/record-thought-contract.js'
const scope = 'production:42'
const thought = (uid = 'note') => ({sourceVersion:1,currentSourceVersion:1,id: uid, recordUid: uid, content: '一个想法', biz: 1 as const })
let stores: RecordThoughtStore[]
beforeEach(() => { vi.useFakeTimers(); stores = [] })
afterEach(() => { stores.forEach(store => store.dispose()); vi.useRealTimers() })
function create(read: (scope: string, uids: string[], signal: AbortSignal) => Promise<ArkmeRecordThoughts>) {
  const store = new RecordThoughtStore(scope, read); stores.push(store); store.setActive(true); return store
}
it('batches duplicate list and detail subscribers into bounded reads', async () => {
  const read = vi.fn(async (accountScope: string, uids: string[]) => ({ accountScope, items: uids.map(thought) }))
  const store = create(read), listener = vi.fn()
  for (let i = 0; i < 60; i++) store.subscribe(String(i), 1, 1, listener)
  const unsubscribe = store.subscribe('0', 1, 1, listener)
  await vi.advanceTimersByTimeAsync(64)
  expect(read).toHaveBeenCalledTimes(2)
  expect(read.mock.calls.map(([, ids]) => ids.length)).toEqual([50, 10])
  unsubscribe(); expect(store.get('0').items).toEqual([thought('0')])
})
it('discovers delayed thoughts for a recently sent note without blocking the initial empty read', async () => {
  let ready = false
  const read = vi.fn(async () => ({ accountScope: scope, items: ready ? [thought()] : [] }))
  const store = create(read); store.subscribe('note', Date.now(), 1, () => {})
  await vi.advanceTimersByTimeAsync(32); expect(store.get('note').items).toEqual([])
  ready = true; await vi.advanceTimersByTimeAsync(4_032)
  expect(store.get('note').items).toEqual([thought()]); expect(read).toHaveBeenCalledTimes(2)
})
it('retains cached results when switching topics and shares them with a newly opened detail', async () => {
  const read = vi.fn(async () => ({ accountScope: scope, items: [thought()] }))
  const store = create(read), off = store.subscribe('note', 1, 1, () => {})
  await vi.advanceTimersByTimeAsync(32); off()
  store.subscribe('note', 1, 1, () => {})
  expect(store.get('note').items).toEqual([thought()])
  await vi.advanceTimersByTimeAsync(100); expect(read).toHaveBeenCalledOnce()
})
it('aborts background reads and ignores late responses while inactive', async () => {
  let finish!: (result: ArkmeRecordThoughts) => void
  const read = vi.fn((_scope: string, _uids: string[], _signal: AbortSignal) => new Promise<ArkmeRecordThoughts>(resolve => { finish = resolve }))
  const store = create(read); store.subscribe('note', 1, 1, () => {})
  await vi.advanceTimersByTimeAsync(32); store.setActive(false)
  expect(read.mock.calls[0]![2].aborted).toBe(true)
  finish({ accountScope: scope, items: [thought()] }); await Promise.resolve()
  expect(store.get('note').items).toEqual([])
  await vi.advanceTimersByTimeAsync(60_000); expect(read).toHaveBeenCalledOnce()
})
it('keeps existing results on failure and retries without clearing the current account cache', async () => {
  const read = vi.fn(async () => ({ accountScope: scope, items: [thought()] }))
  const store = create(read); store.subscribe('note', 1, 1, () => {})
  await vi.advanceTimersByTimeAsync(32)
  read.mockRejectedValueOnce(new TypeError('Failed to fetch')); store.refresh('note'); await vi.advanceTimersByTimeAsync(32)
  expect(store.get('note').items).toEqual([thought()]); expect(store.get('note').error).toBeTruthy()
  store.refresh('note'); await vi.advanceTimersByTimeAsync(32)
  expect(store.get('note').error).toBe('')
})
it('rejects a response for another account and preserves a one-time detail focus request', async () => {
  const store = create(async () => ({ accountScope: 'production:7', items: [thought()] }))
  store.subscribe('note', 1, 1, () => {}); await vi.advanceTimersByTimeAsync(32)
  expect(store.get('note').items).toEqual([]); expect(store.get('note').error).toBeTruthy()
  store.requestFocus('note'); expect(store.takeFocus('other')).toBe(false)
  expect(store.takeFocus('note')).toBe(true); expect(store.takeFocus('note')).toBe(false)
})
it('refreshes an edited record even when its previous version is cached in another topic', async () => {
  const read = vi.fn(async () => ({ accountScope: scope, items: [thought()] }))
  const store = create(read), off = store.subscribe('note', 1, 1, () => {})
  await vi.advanceTimersByTimeAsync(32); off()
  store.subscribe('note', 1, 2, () => {}); await vi.advanceTimersByTimeAsync(32)
  expect(read).toHaveBeenCalledTimes(2)
})
it('cancels an obsolete binding read while retaining the shared cache and one active request', async () => {
  const pending: Array<{ signal: AbortSignal; finish(value: ArkmeRecordThoughts): void }> = []
  const read = vi.fn((_scope: string, _uids: string[], signal: AbortSignal) => new Promise<ArkmeRecordThoughts>(finish => pending.push({ signal, finish })))
  const store = create(read); store.subscribe('note', 1, 1, () => {})
  await vi.advanceTimersByTimeAsync(32); pending[0]!.finish({ accountScope: scope, items: [thought()] }); await Promise.resolve()
  store.refresh(); await vi.advanceTimersByTimeAsync(32)
  store.rebind()
  expect(pending[1]!.signal.aborted).toBe(true)
  expect(store.get('note').items).toEqual([thought()])
  await vi.advanceTimersByTimeAsync(32)
  expect(pending.slice(1).filter(item => !item.signal.aborted)).toHaveLength(1)
  pending[2]!.finish({ accountScope: scope, items: [{ ...thought(), content: '新引用结果' }] }); await Promise.resolve()
  pending[1]!.finish({ accountScope: scope, items: [{ ...thought(), content: '旧引用晚到' }] }); await Promise.resolve()
  expect(store.get('note').items[0]?.content).toBe('新引用结果')
  store.dispose()
  await vi.advanceTimersByTimeAsync(60_000); expect(read).toHaveBeenCalledTimes(3)
})
it.each(['denied', 'account-mismatch'] as const)('clears cached and streamed content after %s until a fresh owner read succeeds', async mode => {
  const read = vi.fn(async () => ({ accountScope: scope, items: [thought()] }))
  const store = create(read); store.subscribe('note', 1, 1, () => {}); await vi.advanceTimersByTimeAsync(32)
  const delta = { sourceVersion: 1, recordUid: 'note', streamId: 'stream', biz: 2 as const, delta: '旧', contentBytes: 3, phase: 'generating' as const }
  store.applyStream(delta)
  if (mode === 'denied') read.mockRejectedValueOnce(Object.assign(new TypeError('Failed to fetch'), { body: { retryable: false } }))
  else read.mockResolvedValueOnce({ accountScope: 'production:7', items: [thought()] })
  store.refresh(); await vi.advanceTimersByTimeAsync(32)
  expect(store.get('note').items).toEqual([])
  store.applyStream({ ...delta, delta: '内容', contentBytes: 9 })
  expect(store.get('note').items).toEqual([])
  read.mockRejectedValueOnce(new TypeError('Failed to fetch')); store.refresh(); await vi.advanceTimersByTimeAsync(32)
  expect(store.get('note').items).toEqual([])
  read.mockResolvedValueOnce({ accountScope: scope, items: [] }); store.refresh(); await vi.advanceTimersByTimeAsync(32)
  expect(store.get('note').items).toEqual([])
  store.applyStream({ ...delta, streamId: 'new-stream', delta: '新' })
  expect(store.get('note').items[0]?.content).toBe('新')
})

it('drops cached content immediately on edit and waits for a matching canonical source version', async () => {
  let content = '一个想法', version=1
  const store = create(async () => ({ accountScope: scope, items: [{ ...thought(), sourceVersion:version,currentSourceVersion:version,content }] }))
  const off = store.subscribe('note', 1, 1, () => {}); await vi.advanceTimersByTimeAsync(32); off()
  store.subscribe('note', 1, 2, () => {}); expect(store.get('note').items).toEqual([])
  await vi.advanceTimersByTimeAsync(32); expect(store.get('note').items).toEqual([])
  version=2;content = '根据新版生成的想法'; store.refresh(); await vi.advanceTimersByTimeAsync(32)
  expect(store.get('note').items[0]?.content).toBe('根据新版生成的想法')
})
it('deduplicates Unicode stream deltas, drops broken ranges and reconciles a completed result', async () => {
  let ready = false
  const store = create(async () => ({ accountScope: scope, items: ready ? [{ ...thought(), biz: 2 as const, content: '你好' }] : [] }))
  store.subscribe('note', 1, 1, () => {}); await vi.advanceTimersByTimeAsync(32)
  const delta = {sourceVersion:1,recordUid: 'note', streamId: 'one', biz: 2 as const, delta: '你', contentBytes: 3, phase: 'generating' as const }
  store.applyStream(delta); store.applyStream(delta)
  expect(store.get('note').items[0]?.content).toBe('你')
  store.applyStream({ ...delta, delta: '坏片段', contentBytes: 99 }); expect(store.get('note').items[0]?.content).toBe('你')
  store.applyStream({ ...delta, delta: '好', contentBytes: 6 }); expect(store.get('note').items[0]?.content).toBe('你好')
  ready = true; store.applyStream({ ...delta, delta: '', contentBytes: 6, phase: 'ready' }); await vi.advanceTimersByTimeAsync(64)
  expect(store.get('note').items).toEqual([{ ...thought(), biz: 2, content: '你好' }])
})
it('clears an invalidated message and ignores a read that was already in flight', async () => {
  let finish!: (value: ArkmeRecordThoughts) => void
  const read = vi.fn(() => new Promise<ArkmeRecordThoughts>(resolve => { finish = resolve }))
  const store = create(read); store.subscribe('note', 1, 1, () => {}, 'signed', 'opaque-key')
  await vi.advanceTimersByTimeAsync(32); store.invalidate('opaque-key')
  finish({ accountScope: scope, items: [thought()] }); await Promise.resolve(); await Promise.resolve()
  expect(store.get('note').items).toEqual([])
  await vi.advanceTimersByTimeAsync(32); expect(read).toHaveBeenCalledTimes(2)
})
