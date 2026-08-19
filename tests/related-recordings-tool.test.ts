import { describe, expect, it, vi } from 'vitest'
import { relatedRecordingsToolModule } from '../src/tools/business/conversation/related-recordings.js'
import type { ArkmeRelatedRecordingItem, ArkmeRelatedRecordingPage } from '../src/types.js'

function item(index: number): ArkmeRelatedRecordingItem {
  return {
    recordingRef: `recording-${String(index)}`,
    startAtMillis: index,
    endAtMillis: index + 1,
    timeRangeText: '10:00 - 10:01',
    title: `录音 ${String(index)}`,
    summary: '摘要',
    summaryStatus: 2,
    transcript: '原'.repeat(5_000),
    transcriptAvailable: true,
    speakers: [],
    participants: [],
    isSharedByOther: false,
  }
}

function page(items: ArkmeRelatedRecordingItem[]): ArkmeRelatedRecordingPage {
  return {
    state: 'success', stateCode: 3, stateMessage: '', hasEntry: true, items,
    hasMore: false, partial: false, timeIndexComplete: false, legacyTimeIndexFallback: false,
  }
}

describe('arkme_related_recordings_read', () => {
  it('omits transcripts by default and remains read-only', async () => {
    const relatedRecordings = vi.fn(async () => page([item(1)]))
    const recordEvent = vi.fn()
    const tool = relatedRecordingsToolModule.create({
      relatedRecordings,
      recordRelatedRecordingsToolEvent: recordEvent,
    } as never)
    const signal = new AbortController().signal
    const output = await tool.execute({ source_ref: 'source-ref' }, { signal } as never) as string

    expect(relatedRecordings).toHaveBeenCalledWith('source-ref', expect.objectContaining({
      limit: 10, includeTimeIndex: true, consumer: 'tool', signal,
    }))
    expect(output).not.toContain('"transcript":')
    expect(output).toContain('"transcriptIncluded": false')
    expect(recordEvent).toHaveBeenCalledWith(expect.objectContaining({ result: 'success', transcriptRequested: false }))
    expect(relatedRecordingsToolModule.meta).toMatchObject({ effect: 'read', toolName: 'arkme_related_recordings_read' })
  })

  it('caps explicit transcript reads and marks truncation', async () => {
    const relatedRecordings = vi.fn(async () => page(Array.from({ length: 5 }, (_, index) => item(index))))
    const tool = relatedRecordingsToolModule.create({ relatedRecordings } as never)
    const output = await tool.execute(
      { source_ref: 'source-ref', limit: 20, include_transcript: true },
      { signal: new AbortController().signal } as never,
    ) as string

    expect(relatedRecordings).toHaveBeenCalledWith('source-ref', expect.objectContaining({ limit: 5 }))
    expect(output).toContain('"transcriptIncluded": true')
    expect(output).toContain('"transcriptOutputTruncated": true')
    expect(output).toContain('"transcriptTruncated": true')
    expect(output.length).toBeLessThan(15_000)
  })
})
