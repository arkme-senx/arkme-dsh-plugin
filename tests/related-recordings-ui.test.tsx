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
import type { JotmoRelatedRecordingItem } from '../src/types.js'

function item(id: string, startAtMillis: number, patch: Partial<JotmoRelatedRecordingItem> = {}): JotmoRelatedRecordingItem {
  return {
    recordingRef: id,
    momentId: id,
    sessionId: `session-${id}`,
    startAtMillis,
    endAtMillis: startAtMillis + 120_000,
    dateStamp: new Date(new Date(startAtMillis).toDateString()).getTime(),
    timeRangeText: '14:00 - 14:02',
    title: `录音 ${id}`,
    summary: `总结 ${id}`,
    summaryStatus: 3,
    transcript: `原文 ${id}`,
    transcriptAvailable: true,
    speakers: [],
    participants: [{ speakerId: 'speaker-1', displayName: '小林', role: 1 }],
    isSharedByOther: false,
    ...patch,
  }
}

const callbacks = {
  onClose: () => undefined,
  onRetry: () => undefined,
  onLoadMore: () => undefined,
  onMonthChange: () => undefined,
  onSelect: () => undefined,
}

describe('related recordings UI', () => {
  it('shows the menu entry only for an authenticated, eligible private chat', () => {
    expect(shouldShowRelatedRecordingsEntry(true, 'private_chat', 'allowed')).toBe(true)
    expect(shouldShowRelatedRecordingsEntry(false, 'private_chat', 'allowed')).toBe(false)
    expect(shouldShowRelatedRecordingsEntry(true, 'private_chat', 'loading')).toBe(false)
    expect(shouldShowRelatedRecordingsEntry(true, 'private_chat', 'denied')).toBe(false)
    expect(shouldShowRelatedRecordingsEntry(true, 'private_chat', 'error')).toBe(false)
    expect(shouldShowRelatedRecordingsEntry(true, 'group_chat', 'allowed')).toBe(false)
    expect(shouldShowRelatedRecordingsEntry(true, 'private_chat', 'allowed', true)).toBe(false)
  })

  it('renders grouped cards, month filters and complete runtime feedback without write actions', () => {
    const items = [
      item('newer', new Date('2026-08-18T14:00:00+08:00').getTime()),
      item('same-day', new Date('2026-08-18T10:00:00+08:00').getTime()),
      item('older', new Date('2026-08-17T09:00:00+08:00').getTime()),
    ]
    const html = renderToStaticMarkup(<RelatedRecordingsPanel
      contactName="小林"
      state="partial"
      stateMessage="部分相关录音暂不可用"
      error=""
      items={items}
      hasMore
      loadingMore={false}
      monthBuckets={[{ monthKey: '2026-08', itemCount: 3 }]}
      selectedMonth=""
      {...callbacks}
    />)

    expect(html).toContain('相关录音')
    expect(html).toContain('你与 小林 的线下交流记录')
    expect(html).toContain('全部时间')
    expect(html).toContain('2026年08月 · 3')
    expect(html).toContain('部分相关录音暂不可用')
    expect(html).toContain('录音 newer')
    expect(html).toContain('加载更多')
    expect(html).toContain('position:absolute')
    expect(html).toContain('top:56px')
    expect(html).toContain('right:0')
    expect(html).toContain('bottom:0')
    expect(html).not.toContain('height:100%')
    expect(html).not.toContain('分享给对方')
    expect(html).not.toContain('撤回')
    expect(groupRelatedRecordings(items).map(group => group.items.length)).toEqual([2, 1])
  })

  it('keeps empty, generating and error states distinct', () => {
    const renderState = (state: 'empty' | 'generating' | 'error', error = '') => renderToStaticMarkup(
      <RelatedRecordingsPanel contactName="小林" state={state} stateMessage="正在整理" error={error}
        items={[]} hasMore={false} loadingMore={false} monthBuckets={[]} selectedMonth="" {...callbacks} />,
    )
    expect(renderState('empty')).toContain('暂无相关录音')
    expect(renderState('generating')).toContain('正在整理')
    expect(renderState('error', '网络错误')).toContain('网络错误')
    expect(renderState('error', '网络错误')).toContain('重试')
    expect(renderToStaticMarkup(
      <RelatedRecordingsPanel contactName="小林" state="loading" stateMessage="" error=""
        items={[]} hasMore={false} loadingMore={false} monthBuckets={[]} selectedMonth="" {...callbacks} />,
    )).toContain('正在读取相关录音')
    expect(renderToStaticMarkup(
      <RelatedRecordingsPanel contactName="小林" state="success" stateMessage="" error=""
        items={[item('success', 1_785_000_000_000)]} hasMore={false} loadingMore={false}
        monthBuckets={[]} selectedMonth="" {...callbacks} />,
    )).toContain('录音 success')
  })

  it('opens a read-only detail with transcript affordance and no sharing controls', () => {
    const html = renderToStaticMarkup(<RelatedRecordingDetail
      item={item('detail', new Date('2026-08-18T14:00:00+08:00').getTime())}
      onClose={() => undefined}
    />)
    expect(html).toContain('相关录音详情')
    expect(html).toContain('时段总结')
    expect(html).toContain('查看原文')
    expect(html).toContain('参与人：小林')
    expect(html).not.toContain('分享给对方')
    expect(html).not.toContain('删除')
  })

  it('deduplicates stable identities and rejects stale contact generations', () => {
    const first = item('same', 1000, { summary: '第一页' })
    const duplicate = item('same', 1000, { summary: '重复页' })
    const next = item('next', 900)
    expect(mergeRelatedRecordingItems([first], [duplicate, next])).toEqual([first, next])
    expect(isCurrentRelatedRecordingRequest(2, 2, 'source-b', 'source-b')).toBe(true)
    expect(isCurrentRelatedRecordingRequest(1, 2, 'source-a', 'source-b')).toBe(false)
    expect(isCurrentRelatedRecordingRequest(2, 2, 'source-a', 'source-b')).toBe(false)

    const firstPage = Array.from({ length: 200 }, (_, index) => item(`item-${index}`, 1_000 - index))
    const nextPage = [item('item-199', 801), ...Array.from({ length: 50 }, (_, index) => item(`item-${200 + index}`, 800 - index))]
    const longList = mergeRelatedRecordingItems(firstPage, nextPage)
    expect(longList).toHaveLength(250)
    expect(longList.map(value => value.recordingRef)).toEqual([
      ...firstPage.map(value => value.recordingRef),
      ...nextPage.slice(1).map(value => value.recordingRef),
    ])
  })
})
