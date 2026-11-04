// Late source generations must never attach to an edited message.
import { afterEach, expect, it, vi } from 'vitest'
import { RecordThoughtStore } from '../src/client/record-thought-store.js'

afterEach(() => vi.useRealTimers())

it('does not attach an old stream to the edited source version', async () => {
  vi.useFakeTimers()
  const store = new RecordThoughtStore('prod:42', async () => ({ accountScope: 'prod:42', items: [] }))
  store.setActive(true)
  const stopOld = store.subscribe('note', Date.now(), 1, () => {})
  store.applyStream({ sourceVersion:1, recordUid: 'note', streamId: 'version-1-stream', biz: 2, delta: '旧正文的回应', contentBytes: 0, phase: 'generating' })
  stopOld()
  const stopNew = store.subscribe('note', Date.now(), 2, () => {})
  store.applyStream({ sourceVersion:1, recordUid: 'note', streamId: 'version-1-stream', biz: 2, delta: '旧任务迟到的片段', contentBytes: 0, phase: 'ready' })
  const result = store.get('note').items
  stopNew(); store.dispose()
  expect(result, 'version-1 stream must not become a version-2 reply').toEqual([])
})

it('does not certify an unversioned historical result after a fresh application start', async () => {
  vi.useFakeTimers()
  const store = new RecordThoughtStore('prod:42', async () => ({ accountScope: 'prod:42', items: [{ id: 'old-result', recordUid: 'note', content: '旧正文的历史回应', biz: 2 }] }))
  store.setActive(true)
  const stop = store.subscribe('note', Date.now(), 2, () => {})
  await vi.advanceTimersByTimeAsync(40)
  const result = store.get('note').items
  stop(); store.dispose()
  expect(result, 'fresh memory has no evidence this historical result belongs to version 2').toEqual([])
})
