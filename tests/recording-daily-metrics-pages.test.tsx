import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import type { ArkmeRecordingTranscriptPage } from '../src/types.js'
import { recordingTextCount } from '../src/recording-daily-metrics.js'
const calls = vi.hoisted(() => ({ read: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: calls.read }))
import { readRecordingDailyMetrics, useRecordingDailyMetrics } from '../src/client/recordings/useRecordingDailyMetrics.js'
import { readRecordingDayOverview, recordingDayOverviewKey } from '../src/client/recordings/recording-day-overview.js'

function page(text: string, cursor = '', viewRef = 'view'): ArkmeRecordingTranscriptPage {
  return { viewRef, nextCursor: cursor, dateStamp: 0, transcriptSource: 'system', state: 'ready', message: '', totalDurationMillis: 1000, processingCount: 0,
    dailyMetrics: { archiveBytes: 123456, archiveState: 'ready', confirmedCount: 1, pendingCount: 0, unknownCount: 0, textCount: recordingTextCount(text) },
    items: [{ itemId: text, itemRef: `ref-${text}`, sessionKey: 'session', transcriptSource: 'system', startAtMillis: text.codePointAt(0)!, endAtMillis: 200000,
      speakerNumber: 1, speakerKey: 'speaker', speakerColorIndex: 1, speakerLabel: '我', canBindSpeaker: true, isSelf: true, isBackground: false,
      text, textStartOffset: 0, textEndOffset: Array.from(text).length, textTotalLength: Array.from(text).length }],
  }
}
function overview() { return { viewRef: 'view', items: [], metrics: { ...page('中文').dailyMetrics!, textCount: 3, speakerTextCounts: { speaker: 3 } } } }
let result: ReturnType<typeof useRecordingDailyMetrics>, renderer: ReactTestRenderer
function Harness({ first, scope = '42', active = true }: { first?: ArkmeRecordingTranscriptPage; scope?: string; active?: boolean }) {
  result = useRecordingDailyMetrics(first, scope, active)
  return <div>正文可用</div>
}
afterEach(async () => { await act(async () => { renderer?.unmount() }); calls.read.mockReset() })

it('sums all Unicode text pages but counts storage once, without touching main page items', async () => {
  const first = page('a 🙂', 'one'), last = page('中文')
  const value = await readRecordingDailyMetrics(first, async () => last, new AbortController().signal)
  expect(value).toMatchObject({ archiveBytes: 123456, confirmedCount: 1, textCount: 4, speakerTextCounts: { speaker: 4 } })
  expect(first.items).toHaveLength(1)
})

it('keeps a sentence spanning three pages continuous without counting its prefix twice', async () => {
  const full = 'a汉🙂尾'
  const fragment = (start: number, end: number, cursor: string) => {
    const p = page(Array.from(full).slice(start,end).join(''),cursor)
    p.items[0] = { ...page(full).items[0]!, text: p.items[0]!.text, textStartOffset: start, textEndOffset: end }
    return p
  }
  const read = vi.fn().mockResolvedValueOnce(fragment(1,3,'two')).mockResolvedValueOnce(fragment(3,4,''))
  expect(await readRecordingDailyMetrics(fragment(0,1,'one'),read,new AbortController().signal)).toMatchObject({textCount:4,archiveBytes:123456})
})

it('includes background text in the day total but not a person count', async () => {
  const first=page('a','one'), last=page('背景')
  last.items[0]!.isBackground=true
  const value=await readRecordingDailyMetrics(first,async()=>last,new AbortController().signal)
  expect(value).toMatchObject({textCount:3,speakerTextCounts:{speaker:1}})
})

it('does not publish a partial total or delay rendering while a statistics page is pending', async () => {
  const pending = Promise.withResolvers<ReturnType<typeof overview>>()
  calls.read.mockReturnValueOnce(pending.promise)
  await act(async () => { renderer = create(<Harness first={page('a','one')}/>) })
  expect(renderer.toJSON()).toMatchObject({children:['正文可用']})
  expect(result).toBeUndefined()
  await act(async () => { pending.resolve(overview()) })
  expect(result).toMatchObject({textCount:3,archiveBytes:123456})
})

it.each(['account','date','revision','hidden','unmount'] as const)('cancels and discards late totals on %s change', async kind => {
  const pending = Promise.withResolvers<ReturnType<typeof overview>>()
  calls.read.mockReturnValueOnce(pending.promise)
  await act(async () => { renderer = create(<Harness first={page('a','one')}/>) })
  const signal = calls.read.mock.calls[0]![2] as AbortSignal
  await act(async () => {
    if (kind === 'unmount') renderer.unmount()
    else renderer.update(<Harness first={kind === 'hidden' ? page('a','one') : undefined} active={kind !== 'hidden'} scope={kind}/>)
  })
  expect(signal.aborted).toBe(true)
  await act(async () => { pending.resolve(overview()) })
  expect(result).toBeUndefined()
})

it('rejects stale snapshots and repeated cursors instead of publishing mixed totals', async () => {
  const signal = new AbortController().signal
  await expect(readRecordingDailyMetrics(page('a','one'),async()=>page('b','','new'),signal)).rejects.toThrow()
  await expect(readRecordingDailyMetrics(page('a','one'),async()=>page('b','one'),signal)).rejects.toThrow()
})

it('builds the whole timeline and later speakers without retaining transcript text', async () => {
  const first = page('a', 'one'), last = page('后半天')
  last.items[0]!.speakerKey = 'late-speaker'
  last.items[0]!.speakerLabel = '下午才出现的人'
  const value = await readRecordingDayOverview(first, async () => last, new AbortController().signal)
  expect(value.items.map(item => item.speakerKey)).toEqual(['speaker', 'late-speaker'])
  expect(value.items.every(item => !('text' in item))).toBe(true)
  expect(value.metrics).toMatchObject({ textCount: 4, speakerTextCounts: { speaker: 1, 'late-speaker': 3 } })
})

it('coalesces a split utterance into one timeline segment while counting every fragment', async () => {
  const first = page('a', 'one'), last = page('b')
  first.items[0]!.textTotalLength = 2
  last.items[0] = { ...first.items[0]!, text: 'b', textStartOffset: 1, textEndOffset: 2 }
  const value = await readRecordingDayOverview(first, async () => last, new AbortController().signal)
  expect(value.items).toHaveLength(1)
  expect(value.items[0]?.textCount).toBe(2)
  expect(value.metrics?.speakerTextCounts.speaker).toBe(2)
})

it('does not restart a completed overview when the visible transcript gains a page', async () => {
  const first = page('a', 'one'), last = page('中文')
  calls.read.mockResolvedValue(overview())
  await act(async () => { renderer = create(<Harness first={first} />) })
  expect(result?.textCount).toBe(3)
  const merged = { ...last, items: [...first.items, ...last.items], dailyMetrics: { ...last.dailyMetrics!, textCount: 3 } }
  await act(async () => { renderer.update(<Harness first={merged} />) })
  expect(calls.read).toHaveBeenCalledTimes(1)
  expect(result?.textCount).toBe(3)
  expect(recordingDayOverviewKey(first, '42')).toBe(recordingDayOverviewKey(merged, '42'))
})

it('does not cancel an in-flight overview when a visible-prefix count changes', async () => {
  const pending = Promise.withResolvers<ReturnType<typeof overview>>()
  calls.read.mockReturnValue(pending.promise)
  const first = page('a', 'one')
  await act(async () => { renderer = create(<Harness first={first} />) })
  const signal = calls.read.mock.calls[0]![2] as AbortSignal
  await act(async () => { renderer.update(<Harness first={{ ...first, dailyMetrics: { ...first.dailyMetrics!, textCount: 222 } }} />) })
  expect(signal.aborted).toBe(false)
  expect(calls.read).toHaveBeenCalledTimes(1)
  await act(async () => { pending.resolve(overview()) })
  expect(result?.textCount).toBe(3)
})

it('keeps an explicit notification window and cancels before collecting a late page', async () => {
  const first = page('a', 'one')
  first.window = { dateStamp: 0, endStamp: 86400000, date: '1970-01-01', timeZone: 'UTC' }
  calls.read.mockResolvedValue(overview())
  await act(async () => { renderer = create(<Harness first={first} />) })
  expect(calls.read.mock.calls[0]?.[1]).toMatchObject({ dateStamp: first.dateStamp, viewRef: first.viewRef, cursor: first.nextCursor })
  const controller = new AbortController()
  await expect(readRecordingDayOverview(first, async () => { controller.abort(); return page('中文') }, controller.signal)).rejects.toThrow()
})

it('refreshes whole-window storage counters without rescanning an unchanged transcript view', async () => {
  calls.read.mockResolvedValue(overview())
  const first = page('a', 'one')
  await act(async () => { renderer = create(<Harness first={first} />) })
  await act(async () => { renderer.update(<Harness first={{ ...first, dailyMetrics: { ...first.dailyMetrics!, archiveBytes: 999, textCount: 100 } }} />) })
  expect(calls.read).toHaveBeenCalledTimes(1)
  expect(result).toMatchObject({ archiveBytes: 999, textCount: 3 })
})

it('keeps the last complete same-day overview visible while replacing its revision', async () => {
  calls.read.mockResolvedValueOnce(overview())
  await act(async () => { renderer = create(<Harness first={page('a', 'one')} />) })
  const pending = Promise.withResolvers<ReturnType<typeof overview>>()
  calls.read.mockReturnValueOnce(pending.promise)
  await act(async () => { renderer.update(<Harness first={page('a', 'one', 'new-view')} />) })
  expect(result?.textCount).toBe(3)
  await act(async () => { pending.resolve({ ...overview(), viewRef: 'new-view', metrics: { ...overview().metrics, textCount: 9 } }) })
  expect(result?.textCount).toBe(9)
})
