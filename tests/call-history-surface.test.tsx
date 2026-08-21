import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  ArkmeCallHistoryRow, ArkmeCallHistorySurface, ARKME_CALL_DEMO_ITEMS,
  filterCallHistoryItems, resolveSelectedCall,
} from '../src/client/ArkmeCallHistorySurface.js'

describe('ArkmeCallHistorySurface', () => {
  it('renders voice and video calls with replay, summary and chat-style transcript bubbles', () => {
    const markup = renderToStaticMarkup(<ArkmeCallHistorySurface />)

    expect(markup).toContain('data-arkme-call-history="prototype"')
    expect(markup).toContain('aria-label="通话记录列表"')
    expect(markup).toContain('aria-label="通话详情"')
    expect(markup).toContain('aria-label="视频通话回放"')
    expect(markup).toContain('data-arkme-video-replay="demo"')
    expect(markup).toContain('aria-label="聊天式通话转写"')
    expect(markup).toContain('data-arkme-transcript-surface="plain"')
    expect(markup).toContain('data-arkme-call-transcript-bubble="video-1"')
    expect(markup).toContain('点击气泡，播放并定位到这一段')
    expect(markup).toContain('>语音<')
    expect(markup).toContain('>视频<')
    expect(markup).toContain('>AI 摘要<')
    expect(markup).toContain('>通话转写<')
    expect(markup).toContain('第一版演示')
    expect(markup).not.toContain('aria-label="回放进度"')
    expect(markup).not.toContain('type="range"')
  })

  it('makes every connected call row expose an explicit playback action', () => {
    const item = ARKME_CALL_DEMO_ITEMS.find(candidate => candidate.id === 'demo-wife')
    expect(item).toBeDefined()
    if (item === undefined) return
    const markup = renderToStaticMarkup(<ArkmeCallHistoryRow
      item={item} selected playing={false} onSelect={vi.fn()} onTogglePlayback={vi.fn()}
    />)

    expect(markup).toContain('role="treeitem"')
    expect(markup).toContain('aria-selected="true"')
    expect(markup).toContain('aria-label="播放与林小满的通话录音"')
    expect(markup).toContain('>▶<')
  })

  it('labels video call rows with a dedicated replay action', () => {
    const item = ARKME_CALL_DEMO_ITEMS.find(candidate => candidate.mediaType === 'video' && candidate.missed !== true)
    expect(item).toBeDefined()
    if (item === undefined) return
    const markup = renderToStaticMarkup(<ArkmeCallHistoryRow
      item={item} selected playing={false} onSelect={vi.fn()} onTogglePlayback={vi.fn()}
    />)

    expect(markup).toContain('视频通话')
    expect(markup).toContain('aria-label="播放与陈依涵的视频回放"')
  })

  it('keeps missed calls readable without advertising an unavailable recording', () => {
    const item = ARKME_CALL_DEMO_ITEMS.find(candidate => candidate.missed === true)
    expect(item).toBeDefined()
    if (item === undefined) return
    const markup = renderToStaticMarkup(<ArkmeCallHistoryRow
      item={item} selected={false} playing={false} onSelect={vi.fn()} onTogglePlayback={vi.fn()}
    />)

    expect(markup).toContain('未接通')
    expect(markup).not.toContain('播放与')
  })

  it('keeps the detail selection inside the visible search and filter results', () => {
    const searched = filterCallHistoryItems(ARKME_CALL_DEMO_ITEMS, '周鹏', 'all')
    expect(searched.map(item => item.peerName)).toEqual(['周鹏'])
    expect(resolveSelectedCall(searched, 'demo-wife')?.peerName).toBe('周鹏')

    const empty = filterCallHistoryItems(ARKME_CALL_DEMO_ITEMS, '不存在的人', 'all')
    expect(empty).toEqual([])
    expect(resolveSelectedCall(empty, 'demo-wife')).toBeUndefined()

    const videos = filterCallHistoryItems(ARKME_CALL_DEMO_ITEMS, '', 'video')
    expect(resolveSelectedCall(videos, 'demo-wife')?.mediaType).toBe('video')
  })
})
