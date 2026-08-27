import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  ArkmeAddContactPage, ArkmeCallHistoryRow, ArkmeCallHistorySurface, ARKME_CALL_DEMO_ITEMS,
  callInviteUrl, filterCallHistoryItems, formatCallTranscriptClock, profileQrDataUrl, profileShareUrl, resolveSelectedCall,
  transcriptToPreviewSeconds,
} from '../src/client/ArkmeCallHistorySurface.js'

describe('ArkmeCallHistorySurface', () => {
  it('renders the mobile-aligned mother call with visible summary, transcript and participant drawer', () => {
    const markup = renderToStaticMarkup(<ArkmeCallHistorySurface />)

    expect(markup).toContain('data-arkme-call-history="prototype"')
    expect(markup).toContain('aria-label="通话记录列表"')
    expect(markup).toContain('aria-label="通话详情"')
    expect(markup).not.toContain('aria-label="视频通话回放"')
    expect(markup).toContain('aria-label="聊天式通话转写"')
    expect(markup).toContain('data-arkme-transcript-surface="plain"')
    expect(markup).toContain('data-arkme-call-transcript-bubble="mother-1"')
    expect(markup).toContain('>语音<')
    expect(markup).toContain('>视频<')
    expect(markup).toContain('data-arkme-call-participants="bottom-sheet"')
    expect(markup).toContain('aria-label="通话参与人"')
    expect(markup).toContain('data-expanded="false"')
    expect(markup).toContain('aria-expanded="false"')
    expect(markup).toContain('查看通话参与人')
    expect(markup).toContain('>AI 摘要<')
    expect(markup).toContain('data-arkme-call-meta-icon="time"')
    expect(markup).toContain('data-arkme-call-meta-icon="duration"')
    expect(markup).not.toContain('◷')
    expect(markup).not.toContain('◴')
    expect(markup).toContain('>通话转写<')
    expect(markup).toContain('和母亲确认了周末回家吃饭和备菜安排')
    expect(markup).toContain('顺路给您捎点水果和排骨')
    expect(markup).toContain('妈妈已挂断通话')
    expect(markup).not.toContain('aria-label="通话内容处理状态"')
    expect(markup).not.toContain('>文件存储<')
    expect(markup).not.toContain('>声纹识别<')
    expect(markup).not.toContain('>录音转写<')
    expect(markup).not.toContain('data-arkme-video-perspectives="paired"')
    expect(markup).not.toContain('双方视角演示')
    expect(markup).not.toContain('data-arkme-voice-perspectives')
    expect(markup).toContain('aria-label="联系人快捷入口"')
    expect(markup).not.toContain('aria-label="完整通话演示"')
    expect(markup).not.toContain('>语音通话演示<')
    expect(markup).not.toContain('>视频通话演示<')
    expect(markup).toContain('找联系人，发起语音或视频通话')
    expect(markup).toContain('<time>16:27:12</time>')
    expect(markup).toContain('<time>16:27:59</time>')
    expect(markup).toContain('<time>16:28:51</time>')
    expect(markup).toContain('<time>16:29:49</time>')
    expect(markup).not.toContain('00:01–00:03')
    expect(markup).not.toContain('陈依涵')
    expect(markup).not.toContain('周鹏')
    expect(markup).toContain('第一版演示')
    expect(markup).toContain('aria-label="播放通话录音"')
    expect(markup).toContain(
      'background:var(--dsw-alias-button-primary-fill, #17191c);color:var(--dsw-alias-label-primary-inverted, #ffffff)',
    )
    expect(markup).not.toContain('aria-label="回放进度"')
    expect(markup).not.toContain('type="range"')
  })

  it('makes every connected call row expose a mobile-style call action', () => {
    const item = ARKME_CALL_DEMO_ITEMS.find(candidate => candidate.id === 'demo-wife')
    expect(item).toBeDefined()
    if (item === undefined) return
    const markup = renderToStaticMarkup(<ArkmeCallHistoryRow
      item={item} selected playing={false} onSelect={vi.fn()} onTogglePlayback={vi.fn()}
    />)

    expect(markup).toContain('role="treeitem"')
    expect(markup).toContain('aria-selected="true"')
    expect(markup).toContain('aria-label="向林小满发起视频通话"')
    expect(markup).toContain('data-arkme-call-action="video"')
    expect(markup).toContain('background:#fff;color:#17191c')
    expect(markup).toContain('data-arkme-demo-avatar="demo-wife"')
    expect(markup).not.toContain('data-arkme-media-icon="play"')
    expect(markup).not.toContain('▶')
    expect(markup).not.toContain('Ⅱ')

    expect(markup).not.toContain('box-shadow:inset 3px')
  })

  it('shows the wall-clock time when each sentence was spoken', () => {
    expect(formatCallTranscriptClock('今天 14:26', 3.8)).toBe('14:26:03')
    expect(formatCallTranscriptClock('昨天 23:59', 62)).toBe('00:00:02')
  })

  it('builds the same profile-share URL contract used by the mobile client', () => {
    expect(profileShareUrl('Falling 01')).toBe('https://jiwo.cc/Falling%2001')
    expect(profileQrDataUrl('Falling')).toMatch(/^data:image\/gif;base64,/)
  })

  it('builds typed call invites and maps long transcripts into the short preview audio', () => {
    expect(callInviteUrl('Falling 01', 'video')).toBe('https://jiwo.cc/call/invite?from=Falling%2001&media=video')
    const mother = ARKME_CALL_DEMO_ITEMS.find(item => item.id === 'demo-mother')
    expect(mother).toBeDefined()
    if (mother === undefined) return
    expect(transcriptToPreviewSeconds(mother, mother.transcript[0]?.atSeconds ?? 0)).toBeGreaterThan(0)
    expect(transcriptToPreviewSeconds(mother, mother.transcript.at(-1)?.endSeconds ?? 0)).toBe(12)
  })

  it('renders the mobile-aligned add-contact destination with real account identity', () => {
    const markup = renderToStaticMarkup(<ArkmeAddContactPage onBack={vi.fn()} profile={{
      userId: 1, displayName: '汤慧玲', nickname: '汤慧玲', avatarRef: '', arkmeId: 'Falling', accountType: 0, createdAt: 0,
      bindings: { apple: false, wechat: false, google: false }, contact: {},
    }} />)
    expect(markup).toContain('data-arkme-add-contact-page="true"')
    expect(markup).toContain('placeholder="输入手机号或即我号"')
    expect(markup).toContain('扫一扫二维码添加好友')
    expect(markup).toContain('即我号：Falling')
    expect(markup).toContain('alt="我的 Arkme 二维码"')
    expect(markup).toContain('icon-scan-add-contact.svg')
  })

  it('keeps a complete video demo alongside the mother voice demo', () => {
    const item = ARKME_CALL_DEMO_ITEMS.find(candidate => candidate.mediaType === 'video' && candidate.missed !== true)
    expect(item).toBeDefined()
    if (item === undefined) return
    const markup = renderToStaticMarkup(<ArkmeCallHistoryRow
      item={item} selected playing={false} onSelect={vi.fn()} onTogglePlayback={vi.fn()}
    />)

    expect(markup).toContain('视频通话')
    expect(markup).toContain('aria-label="向林小满发起视频通话"')
  })

  it('renders real account contacts separately from the two demo records', () => {
    const markup = renderToStaticMarkup(<ArkmeCallHistorySurface contacts={[{
      sourceRef: 'private:real-contact', displayName: '我的真实联系人', avatarRef: 'opaque-avatar-ref',
    }]} />)
    expect(markup).toContain('选择联系人我的真实联系人发起通话')
    expect(markup).toContain('>我的真实联系人<')
    expect(ARKME_CALL_DEMO_ITEMS.map(item => item.peerName)).toEqual(['林小满', '妈妈'])
  })

  it('keeps the detail selection inside the visible search and filter results', () => {
    const searched = filterCallHistoryItems(ARKME_CALL_DEMO_ITEMS, '妈妈', 'all')
    expect(searched.map(item => item.peerName)).toEqual(['妈妈'])
    expect(resolveSelectedCall(searched, 'demo-wife')?.peerName).toBe('妈妈')

    const empty = filterCallHistoryItems(ARKME_CALL_DEMO_ITEMS, '不存在的人', 'all')
    expect(empty).toEqual([])
    expect(resolveSelectedCall(empty, 'demo-wife')).toBeUndefined()

    const videos = filterCallHistoryItems(ARKME_CALL_DEMO_ITEMS, '', 'video')
    expect(resolveSelectedCall(videos, 'demo-wife')?.mediaType).toBe('video')
  })
})
