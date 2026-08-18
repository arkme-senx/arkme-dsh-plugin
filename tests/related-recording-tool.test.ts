import { describe, expect, it, vi } from 'vitest'
import { createJotmoRelatedRecordingToolDefinition, JOTMO_RELATED_RECORDING_TOOL_PROMPT } from '../src/related-recording-tool.js'

describe('related recording tool', () => {
  it('reads bounded private-chat recordings and omits transcript by default', async () => {
    const relatedRecordings = vi.fn(async () => ({
      state: 'success' as const,
      stateCode: 3,
      stateMessage: '已找到相关录音',
      hasEntry: true,
      items: [{
        recordingRef: 'moment-1', momentId: 'moment-1', sessionId: 'session-1',
        startAtMillis: 1_785_000_000_000, endAtMillis: 1_785_000_120_000,
        timeRangeText: '14:00 - 14:02', title: '版本讨论', summary: '讨论版本计划。',
        summaryStatus: 3, transcript: '原文'.repeat(3_000), transcriptAvailable: true,
        speakers: [], participants: [{ speakerId: 'speaker-1', displayName: '小林', role: 1 }],
        isSharedByOther: false,
      }],
      hasMore: true,
      nextCursor: 'opaque-next',
      partial: false,
      timeIndexComplete: true,
      monthBuckets: [{ monthKey: '2026-08', itemCount: 1 }],
      legacyTimeIndexFallback: false,
    }))
    const recordRelatedRecordingsToolEvent = vi.fn()
    const tool = createJotmoRelatedRecordingToolDefinition({
      relatedRecordings,
      recordRelatedRecordingsToolEvent,
    })
    const signal = new AbortController().signal

    const summaryOnly = await tool.execute({ source_ref: 'private-source' }, { signal } as never) as string
    expect(relatedRecordings).toHaveBeenCalledWith('private-source', expect.objectContaining({
      limit: 10, includeTimeIndex: true, signal,
    }))
    expect(summaryOnly).toContain('版本讨论')
    expect(summaryOnly).not.toContain('原文原文')
    expect(summaryOnly).toContain('"transcriptIncluded": false')

    const withTranscript = await tool.execute(
      { source_ref: 'private-source', include_transcript: true, limit: 20, cursor: 'opaque-next' },
      { signal } as never,
    ) as string
    expect(relatedRecordings).toHaveBeenLastCalledWith('private-source', expect.objectContaining({
      limit: 5, cursor: 'opaque-next', includeTimeIndex: false,
    }))
    expect(withTranscript).toContain('"transcriptTruncated": true')
    expect(withTranscript).toContain('"transcriptOutputTruncated": true')
    expect(withTranscript.length).toBeLessThan(20_000)
    expect(recordRelatedRecordingsToolEvent).toHaveBeenLastCalledWith(expect.objectContaining({
      result: 'success', transcriptRequested: true, transcriptTruncated: true,
    }))
    expect(JOTMO_RELATED_RECORDING_TOOL_PROMPT).toContain('include_transcript=true')
  })
})
