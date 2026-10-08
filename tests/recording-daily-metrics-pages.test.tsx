import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import type { ArkmeRecordingTranscriptPage } from '../src/types.js'
import { recordingTextCount } from '../src/recording-daily-metrics.js'
const calls = vi.hoisted(() => ({ read: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: calls.read }))
import { readRecordingDailyMetrics, useRecordingDailyMetrics } from '../src/client/recordings/useRecordingDailyMetrics.js'

function page(text: string, cursor = '', viewRef = 'view'): ArkmeRecordingTranscriptPage {
  return { viewRef, nextCursor: cursor, dateStamp: 0, transcriptSource: 'system', state: 'ready', message: '', totalDurationMillis: 1000, processingCount: 0,
    dailyMetrics: { archiveBytes: 123456, archiveState: 'ready', confirmedCount: 1, pendingCount: 0, unknownCount: 0, textCount: recordingTextCount(text) },
    items: [{ itemId: text, itemRef: `ref-${text}`, sessionKey: 'session', transcriptSource: 'system', startAtMillis: text.codePointAt(0)!, endAtMillis: 200000,
      speakerNumber: 1, speakerKey: 'speaker', speakerColorIndex: 1, speakerLabel: '我', canBindSpeaker: true, isSelf: true, isBackground: false,
      text, textStartOffset: 0, textEndOffset: Array.from(text).length, textTotalLength: Array.from(text).length }],
  }
}
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
  const pending = Promise.withResolvers<ArkmeRecordingTranscriptPage>()
  calls.read.mockReturnValueOnce(pending.promise)
  await act(async () => { renderer = create(<Harness first={page('a','one')}/>) })
  expect(renderer.toJSON()).toMatchObject({children:['正文可用']})
  expect(result).toBeUndefined()
  await act(async () => { pending.resolve(page('中文')) })
  expect(result).toMatchObject({textCount:3,archiveBytes:123456})
})

it.each(['account','date','revision','hidden','unmount'] as const)('cancels and discards late totals on %s change', async kind => {
  const pending = Promise.withResolvers<ArkmeRecordingTranscriptPage>()
  calls.read.mockReturnValueOnce(pending.promise)
  await act(async () => { renderer = create(<Harness first={page('a','one')}/>) })
  const signal = calls.read.mock.calls[0]![2] as AbortSignal
  await act(async () => {
    if (kind === 'unmount') renderer.unmount()
    else renderer.update(<Harness first={kind === 'hidden' ? page('a','one') : undefined} active={kind !== 'hidden'} scope={kind}/>)
  })
  expect(signal.aborted).toBe(true)
  await act(async () => { pending.resolve(page('中文')) })
  expect(result).toBeUndefined()
})

it('rejects stale snapshots and repeated cursors instead of publishing mixed totals', async () => {
  const signal = new AbortController().signal
  await expect(readRecordingDailyMetrics(page('a','one'),async()=>page('b','','new'),signal)).rejects.toThrow()
  await expect(readRecordingDailyMetrics(page('a','one'),async()=>page('b','one'),signal)).rejects.toThrow()
})
