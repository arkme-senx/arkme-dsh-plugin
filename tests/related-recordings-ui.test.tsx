import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  groupRelatedRecordings,
  isCurrentRelatedRecordingRequest,
  mergeRelatedRecordingItems,
  RelatedRecordingDetail,
  RelatedRecordingsPanel,
  shouldShowRelatedRecordingsEntry,
} from '../src/client/related-recordings.js'
import type { ArkmeRelatedRecordingItem } from '../src/types.js'

function recording(
  recordingRef: string,
  isSharedByOther = false,
  patch: Partial<ArkmeRelatedRecordingItem> = {},
): ArkmeRelatedRecordingItem {
  return {
    recordingRef,
    startAtMillis: new Date('2026-08-05T06:46:00.000Z').getTime(),
    endAtMillis: new Date('2026-08-05T07:20:00.000Z').getTime(),
    timeRangeText: '14:46 - 15:20',
    title: 'IOS模拟器环境治理与磁盘空间优化',
    summary: '讨论模拟器缓存清理与磁盘空间优化。',
    summaryStatus: 2,
    transcript: '这是完整录音原文',
    transcriptAvailable: true,
    speakers: [],
    participants: [{ speakerId: 'speaker-1', displayName: '我', role: 1 }],
    isSharedByOther,
    ...patch,
  }
}

function renderPanel(patch: Partial<Parameters<typeof RelatedRecordingsPanel>[0]> = {}): string {
  return renderToStaticMarkup(<RelatedRecordingsPanel
    contactName="1D3E"
    state="success"
    stateMessage=""
    error=""
    items={[recording('recording-1')]}
    hasMore={false}
    loadingMore={false}
    monthBuckets={[]}
    selectedMonth=""
    onClose={() => undefined}
    onRetry={() => undefined}
    onLoadMore={() => undefined}
    onMonthChange={() => undefined}
    onSelect={() => undefined}
    {...patch}
  />)
}

describe('related recordings UI', () => {
  it('gates the private-chat entry and hides it while the panel is open', () => {
    expect(shouldShowRelatedRecordingsEntry(true, 'private_chat', 'allowed')).toBe(true)
    expect(shouldShowRelatedRecordingsEntry(true, 'private_chat', 'allowed', true)).toBe(false)
    expect(shouldShowRelatedRecordingsEntry(true, 'group_chat', 'allowed')).toBe(false)
    expect(shouldShowRelatedRecordingsEntry(false, 'private_chat', 'allowed')).toBe(false)
    expect(shouldShowRelatedRecordingsEntry(true, 'private_chat', 'error')).toBe(false)
  })

  it('renders a lowered overlay panel with partial and shared states', () => {
    const html = renderPanel({
      state: 'partial',
      stateMessage: '部分来源暂不可用',
      items: [recording('incoming-1', true)],
      monthBuckets: [{ monthKey: '2026-08', itemCount: 1 }],
    })

    expect(html).toContain('top:56px')
    expect(html).toContain('bottom:12px')
    expect(html).not.toContain('height:100%')
    expect(html).toContain('你与 1D3E 的线下交流记录')
    expect(html).toContain('部分来源暂不可用')
    expect(html).toContain('对方共享')
    expect(html).toContain('2026年08月')
  })

  it('keeps details read-only', () => {
    const owner = renderToStaticMarkup(<RelatedRecordingDetail item={recording('own-1')} onClose={() => undefined} />)
    expect(owner).toContain('查看原文')
    expect(owner).not.toContain('共享给对方')
    expect(owner).not.toContain('撤回共享')

    const incoming = renderToStaticMarkup(<RelatedRecordingDetail item={recording('incoming-1', true)} onClose={() => undefined} />)
    expect(incoming).toContain('对方共享 · 只读')
    expect(incoming).not.toContain('共享给对方')
  })

  it('deduplicates overlapping pages and rejects stale contact responses', () => {
    const first = recording('recording-1')
    const second = recording('recording-2', false, { startAtMillis: first.startAtMillis - 1000 })
    expect(mergeRelatedRecordingItems([first], [first, second]).map(item => item.recordingRef))
      .toEqual(['recording-1', 'recording-2'])
    expect(groupRelatedRecordings([first, second])).toHaveLength(1)
    expect(isCurrentRelatedRecordingRequest(2, 2, 'source-a', 'source-a')).toBe(true)
    expect(isCurrentRelatedRecordingRequest(1, 2, 'source-a', 'source-a')).toBe(false)
    expect(isCurrentRelatedRecordingRequest(2, 2, 'source-a', 'source-b')).toBe(false)
  })
})
