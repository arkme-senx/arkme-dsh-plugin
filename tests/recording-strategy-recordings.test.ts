import { expect, it, vi } from 'vitest'
import { RecordingService, type RecordingServiceDependencies } from '../src/services/recording-service.js'
import type { ServiceRuntime } from '../src/services/service.js'
import type { RecordingStrategyRecordings } from '../src/recording-strategy-contract.js'
import { createArkmeSdk } from '../src/sdk/index.js'
import { recordingStrategyTools } from '../src/tools/business/recordings/strategies.js'
const start = new Date(2026, 9, 14).getTime(), end = start + 86400_000
const id = '100000000000000000000001', foreign = '100000000000000000000002'
function fixture() {
  let userId = 42
  const post = vi.fn(async (_path: string, body: any) => body.page_cursor ? { items: [], has_more: false } : {
    items: [{ recording_uid: id, status: 'available', uploader_user_id: 42, start_at: start, end_at: end },
      { recording_uid: foreign, status: 'available', uploader_user_id: 43, start_at: start, end_at: end }], has_more: true, next_page_cursor: 'next-owner-page',
  })
  const runtime = { config: {}, subscribeAccountScope: () => () => {}, requireSession: async () => ({ userId }), authenticatedAudioPost: post, stateStore: { uniqueCode: async () => 'test-only-key' } } as unknown as ServiceRuntime
  return { service: new RecordingService(runtime, {} as RecordingServiceDependencies), post, setUser: (next: number) => { userId = next } }
}
it('pages only owned recording metadata and seals owner/cursor identity without reading transcripts or OSS', async () => {
  const f = fixture(), signal = new AbortController().signal
  const page = await f.service.recordingStrategies({ action: 'recordings', startAtMillis: start, endAtMillis: end }, signal) as RecordingStrategyRecordings
  expect(page.items).toHaveLength(1); expect(page.items[0]).toMatchObject({ startAtMillis: start, endAtMillis: end })
  expect(JSON.stringify(page)).not.toContain(id); expect(JSON.stringify(page)).not.toContain('next-owner-page')
  expect(f.post).toHaveBeenCalledWith('/api/v1/audio/recordings/query', { start_at: start, end_at: end, order: 'asc', limit: 50 }, expect.objectContaining({ userId: 42 }), signal, expect.objectContaining({ bypassCache: true }))
  await f.service.recordingStrategies({ action: 'recordings', startAtMillis: start, endAtMillis: end, cursor: page.nextCursor })
  expect(f.post.mock.calls[1]![1].page_cursor).toBe('next-owner-page')
  await expect(f.service.recordingStrategies({ action: 'recordings', startAtMillis: start + 1, endAtMillis: end, cursor: page.nextCursor })).rejects.toThrow('日期')
  f.setUser(43)
  await expect(f.service.recordingStrategies({ action: 'recordings', startAtMillis: start, endAtMillis: end, cursor: page.nextCursor })).rejects.toThrow()
  expect(f.post).toHaveBeenCalledTimes(2)
})
it('rejects unbounded ranges and stale account responses before exposing references', async () => {
  const f = fixture()
  for (const range of [[NaN, end], [start, Infinity], [start, start], [start, start + 28 * 3600_000]]) {
    await expect(f.service.recordingStrategies({ action: 'recordings', startAtMillis: range[0], endAtMillis: range[1] })).rejects.toThrow()
  }
  expect(f.post).not.toHaveBeenCalled()
  f.post.mockImplementationOnce(async () => { f.setUser(43); return { items: [], has_more: false } })
  await expect(f.service.recordingStrategies({ action: 'recordings', startAtMillis: start, endAtMillis: end })).rejects.toThrow()
})
it('allows empty owner pages to continue and does not invent ownership', async () => {
  const f = fixture()
  f.post.mockResolvedValueOnce({ items: [{ recording_uid: foreign, status: 'available', uploader_user_id: 43, start_at: start, end_at: end }], has_more: true, next_page_cursor: 'next' })
  const page = await f.service.recordingStrategies({ action: 'recordings', startAtMillis: start, endAtMillis: end }) as RecordingStrategyRecordings
  expect(page.items).toEqual([]); expect(page.nextCursor).toBeTruthy()
  f.post.mockResolvedValueOnce({ items: [{ recording_uid: id, status: 'available', start_at: start, end_at: end }], has_more: false } as any)
  await expect(f.service.recordingStrategies({ action: 'recordings', startAtMillis: start, endAtMillis: end })).rejects.toThrow()
})
it('SDK advertises and gates the date lookup, and Tools use the same read owner', async () => {
  const calls: any[] = []
  const sdk = createArkmeSdk({ fetchImpl: async (_url, init) => { const input = JSON.parse(String(init?.body)); calls.push(input); return new Response(JSON.stringify({ ok: true, value: input.operation === 'provider.capabilities' ? { contractVersion: 1, features: { recordingStrategyRecordingsV1: true } } : { items: [] } }), { headers: { 'Content-Type': 'application/json' } }) } })
  const result: RecordingStrategyRecordings = await sdk.recordingStrategies({ action: 'recordings', startAtMillis: start, endAtMillis: end })
  expect(result.items).toEqual([]); expect(calls.at(-1)).toMatchObject({ operation: 'recordings.strategies', params: { action: 'recordings', startAtMillis: start, endAtMillis: end } })
  const old = createArkmeSdk({ fetchImpl: async () => new Response(JSON.stringify({ ok: true, value: { contractVersion: 1, features: { recordingStrategiesV1: true } } }), { headers: { 'Content-Type': 'application/json' } }) })
  await expect(old.recordingStrategies({ action: 'recordings', startAtMillis: start, endAtMillis: end })).rejects.toThrow('不支持')
  const recordingStrategies = vi.fn(async () => ({ items: [] }))
  const tool = recordingStrategyTools[0]!.create({ recordingStrategies } as any) as any
  await tool.execute({ action: 'recordings', start_at_millis: start, end_at_millis: end }, { signal: undefined })
  expect(recordingStrategies).toHaveBeenCalledWith(expect.objectContaining({ action: 'recordings', startAtMillis: start, endAtMillis: end }), undefined)
})
