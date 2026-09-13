import { describe, expect, it, vi } from 'vitest'
import { appendRecordingTranscriptPage, readCompleteRecordingTranscript, refreshRecordingTranscriptPage } from '../src/recording-transcript-page.js'
import type { ArkmeRecordingTranscriptPage, ArkmeRecordingWorkbenchItem } from '../src/types.js'
const item = (start = 0, end = 2): ArkmeRecordingWorkbenchItem => ({
  itemId: 'one', itemRef: 'sealed-one', sessionKey: 'session', transcriptSource: 'system', startAtMillis: 1000, endAtMillis: 2000,
  speakerNumber: 1, speakerKey: 'speaker', speakerColorIndex: 1, speakerLabel: '我', canBindSpeaker: true, isSelf: true, isBackground: false,
  text: Array.from('汉🎙 尾').slice(start,end).join(''), textStartOffset: start, textEndOffset: end, textTotalLength: 4,
})
export function page(items = [item()], nextCursor = 'next'): ArkmeRecordingTranscriptPage {
  return { dateStamp: 0, transcriptSource: 'system', viewRef: 'snapshot', nextCursor, state: 'ready', message: '', items, totalDurationMillis: 1000, processingCount: 0 }
}
describe('recording page consumers', () => {
  it('joins unicode code points without changing the original sentence time or identity', async () => {
    const first = page(), last = page([item(2,4)], '')
    const result = appendRecordingTranscriptPage(first, last)
    expect(result.items).toEqual([{ ...item(0,4), text: '汉🎙 尾' }])
    expect(first.items[0]?.text).toBe('汉🎙')
    await expect(readCompleteRecordingTranscript(first, async () => last)).resolves.toEqual(result)
  })
  it.each(['revision','source','date','offset','length','identity','duplicate','tail','cursor'] as const)('rejects %s mixing before a partial export can escape', async kind => {
    const first = page(), last = page([item(2,4)], '')
    if (kind === 'revision') last.viewRef = 'changed'
    if (kind === 'source') last.transcriptSource = 'doubao'
    if (kind === 'date') last.dateStamp = 86_400_000
    if (kind === 'offset') last.items[0]!.textStartOffset = 0
    if (kind === 'length') last.items[0]!.text = 'broken'
    if (kind === 'identity') last.items[0]!.speakerKey = 'other'
    if (kind === 'duplicate') last.items.push(item(2,4))
    if (kind === 'tail') last.items[0]!.textTotalLength = 5
    if (kind === 'cursor') last.nextCursor = first.nextCursor
    await expect(readCompleteRecordingTranscript(first, async () => last)).rejects.toThrow()
    expect(first.items[0]?.text).toBe('汉🎙')
  })
  it('keeps the loaded prefix on an identical refresh and resets on a changed view', () => {
    const first = page(), complete = appendRecordingTranscriptPage(first, page([item(2,4)], ''))
    expect(refreshRecordingTranscriptPage(complete, first).items).toEqual(complete.items)
    expect(refreshRecordingTranscriptPage(complete, first).nextCursor).toBe('')
    expect(refreshRecordingTranscriptPage(complete, { ...first, viewRef: 'changed' }).items).toEqual(first.items)
  })
  it('does not call another page after cancellation', async () => {
    const abort = new AbortController(); abort.abort()
    const read = vi.fn()
    await expect(readCompleteRecordingTranscript(page(), read, abort.signal)).rejects.toThrow()
    expect(read).not.toHaveBeenCalled()
  })
})
