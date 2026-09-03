import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import {
  groupRelatedRecordings,
  isCurrentRelatedRecordingRequest,
  mergeRelatedRecordingItems,
  ARKME_RELATED_RECORDING_TRANSCRIPT_BG,
  RelatedRecordingDetail,
  RelatedRecordingsPanel,
  shouldShowPrivateChatActions,
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

function nodeText(value: unknown): string {
  if (Array.isArray(value)) return value.map(nodeText).join('')
  if (value !== null && typeof value === 'object' && 'props' in value) {
    return nodeText((value as { props?: { children?: unknown } }).props?.children)
  }
  return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
}

describe('related recordings UI', () => {
  it('gates the private-chat entry and hides it while the panel is open', () => {
    expect(shouldShowRelatedRecordingsEntry(true, 'private_chat', 'allowed')).toBe(true)
    expect(shouldShowRelatedRecordingsEntry(true, 'private_chat', 'allowed', true)).toBe(false)
    expect(shouldShowRelatedRecordingsEntry(true, 'group_chat', 'allowed')).toBe(false)
    expect(shouldShowRelatedRecordingsEntry(false, 'private_chat', 'allowed')).toBe(false)
    expect(shouldShowRelatedRecordingsEntry(true, 'private_chat', 'error')).toBe(false)
  })

  it('reserves private-chat actions before related-recording eligibility is requested', () => {
    expect(shouldShowPrivateChatActions(true, 'private_chat')).toBe(true)
    expect(shouldShowPrivateChatActions(true, 'group_chat')).toBe(false)
    expect(shouldShowPrivateChatActions(false, 'private_chat')).toBe(false)
  })

  it('requests related-recording eligibility only after the private-chat menu opens', () => {
    const source = readFileSync(new URL('../src/client/ArkmeSidebar.tsx', import.meta.url), 'utf8')
    const resetStart = source.indexOf('relatedEligibilityAbortRef.current?.abort()')
    const ensureStart = source.indexOf('const ensureRelatedEligibility')
    const toggleStart = source.indexOf('const toggleRelatedMenu')

    expect(resetStart).toBeGreaterThan(-1)
    expect(ensureStart).toBeGreaterThan(resetStart)
    expect(source.slice(resetStart, ensureStart)).not.toContain("'related-recordings.eligibility'")
    expect(source.slice(ensureStart, toggleStart)).toContain("'related-recordings.eligibility'")
    expect(source.slice(toggleStart, source.indexOf('const acknowledgeRead'))).toContain('ensureRelatedEligibility()')
  })

  it('renders a lowered overlay panel with partial and shared states', () => {
    const html = renderPanel({
      state: 'partial',
      stateMessage: '部分来源暂不可用',
      items: [recording('incoming-1', true)],
      monthBuckets: [{ monthKey: '2026-08', itemCount: 1 }],
    })

    expect(html).toContain('top:48px')
    expect(html).toContain('bottom:0')
    expect(html).toContain('width:min(408px, 100%)')
    expect(html.slice(0, html.indexOf(' aria-label="相关录音"'))).not.toContain('height:100%')
    expect(html).toContain('你与 1D3E 的线下交流记录')
    expect(html).toContain('全部时间')
    expect(html).toContain('aria-haspopup="menu"')
    expect(html).toContain('2026-08-05 周三')
    expect(html).toContain('1段')
    expect(html).toContain('部分来源暂不可用')
    expect(html).not.toContain('对方共享')
  })

  it('matches the desktop related-recordings card anatomy', () => {
    const html = renderPanel({
      contactName: 'Tison@即我',
      contactAvatarRef: 'peer-avatar-ref',
      items: [recording('incoming-1', true, {
        startAtMillis: Date.UTC(2026, 7, 7, 4, 33),
        endAtMillis: Date.UTC(2026, 7, 7, 4, 59),
        timezoneOffsetMillis: 8 * 60 * 60 * 1000,
        timeRangeText: '2026-08-07 12:33 - 12:59',
      })],
    })

    expect(html).toContain('相关录音')
    expect(html).toContain('你与 Tison@即我 的线下交流记录')
    expect(html).toContain('2026-08-07 周五')
    expect(html).toContain('12:33 - 12:59')
    expect(html).not.toContain('2026-08-07 12:33 - 12:59')
    expect(html).toContain('参与者: 我')
    expect(html).toContain('aria-label="Tison@即我头像"')
    expect(html).toContain('没有更多内容了')
    expect(html).not.toContain('对方共享')
    expect(html).not.toContain('2026年08月 ·')
  })

  it('filters related recordings through the compact desktop time dropdown', async () => {
    const onMonthChange = vi.fn()
    let renderer: ReactTestRenderer | undefined
    const secondRecording = recording('recording-2', false, {
      startAtMillis: new Date('2026-08-05T07:46:00.000Z').getTime(),
      endAtMillis: new Date('2026-08-05T08:20:00.000Z').getTime(),
      timeRangeText: '15:46 - 16:20',
    })
    await act(async () => {
      renderer = create(<RelatedRecordingsPanel
        contactName="Tison@即我"
        state="success"
        stateMessage=""
        error=""
        items={[recording('recording-1'), secondRecording]}
        hasMore={false}
        loadingMore={false}
        monthBuckets={[]}
        selectedMonth=""
        onClose={() => undefined}
        onRetry={() => undefined}
        onLoadMore={() => undefined}
        onMonthChange={onMonthChange}
        onSelect={() => undefined}
      />)
    })

    const filter = renderer!.root.findByProps({ 'aria-label': '按时间筛选相关录音' })
    await act(async () => { filter.props.onClick() })
    const menuItems = renderer!.root.findAllByProps({ role: 'menuitem' })
    expect(menuItems.map(item => nodeText(item.props.children))).toEqual(['全部时间2段', '2026年8月2段'])
    const month = menuItems.find(button => nodeText(button.props.children).includes('2026年8月'))
    expect(month).toBeDefined()
    await act(async () => { month!.props.onClick() })
    expect(onMonthChange).toHaveBeenCalledWith('2026-08')
    await act(async () => { renderer!.unmount() })
  })

  it('filters months locally like the existing desktop owner', async () => {
    let renderer: ReactTestRenderer | undefined
    const august = recording('august', false, {
      startAtMillis: Date.UTC(2026, 7, 7, 4, 33),
      endAtMillis: Date.UTC(2026, 7, 7, 4, 59),
      timezoneOffsetMillis: 8 * 60 * 60 * 1000,
      timeRangeText: '2026-08-07 12:33 - 12:59',
    })
    const july = recording('july', false, {
      startAtMillis: Date.UTC(2026, 6, 23, 7, 33),
      endAtMillis: Date.UTC(2026, 6, 23, 7, 59),
      timezoneOffsetMillis: 8 * 60 * 60 * 1000,
      timeRangeText: '2026-07-23 15:33 - 15:59',
      title: '七月录音',
    })
    await act(async () => {
      renderer = create(<RelatedRecordingsPanel
        contactName="Tison@即我"
        state="success"
        stateMessage=""
        error=""
        items={[august, july]}
        hasMore={false}
        loadingMore={false}
        monthBuckets={[]}
        selectedMonth="2026-08"
        onClose={() => undefined}
        onRetry={() => undefined}
        onLoadMore={() => undefined}
        onMonthChange={() => undefined}
        onSelect={() => undefined}
      />)
    })

    const tree = JSON.stringify(renderer!.toJSON())
    expect(tree).toContain('2026-08-07 周五')
    expect(tree).toContain('12:33 - 12:59')
    expect(tree).not.toContain('七月录音')
    await act(async () => { renderer!.unmount() })
  })

  it('uses icon glyphs rather than text arrows in the related-recordings chrome', () => {
    const source = readFileSync(new URL('../src/client/related-recordings.tsx', import.meta.url), 'utf8')
    expect(source).toContain('CaretDown')
    expect(source).toContain('CaretRight')
    expect(source).not.toContain('>⌄<')
  })

  it('reuses the group-chat header menu chrome for the private related-recordings entry', () => {
    const source = readFileSync(new URL('../src/client/ArkmeSidebar.tsx', import.meta.url), 'utf8')
    const privateStart = source.indexOf('shouldShowPrivateChatActions(authenticated, source?.kind) && <div')
    const privateBlock = source.slice(privateStart, source.indexOf('</header>', privateStart))

    expect(privateStart).toBeGreaterThan(-1)
    expect(privateBlock).toContain('ARKME_CONVERSATION_HEADER_ACTIONS_STYLE')
    expect(privateBlock).toContain('ArkmeConversationHeaderIconButton')
    expect(privateBlock).toContain('ArkmeConversationMoreIcon')
    expect(privateBlock).toContain('buttonRef={relatedMenuButtonRef}')
    expect(privateBlock).toContain('createPortal(')
    expect(privateBlock).toContain('ARKME_CONVERSATION_SETTINGS_MENU_SCRIM_STYLE')
    expect(privateBlock).toContain('ARKME_CONVERSATION_SETTINGS_POPOVER_STYLE')
    expect(privateBlock).toContain('ARKME_CONVERSATION_SETTINGS_MENU_ROW_STYLE')
    expect(privateBlock).not.toContain('•••')
    expect(source).not.toContain('moreButton:')
    expect(source).not.toContain('menuItem:')
  })

  it('keeps related details on the shared-recording dialog path without share actions', () => {
    const owner = renderToStaticMarkup(<RelatedRecordingDetail item={recording('own-1')} onClose={() => undefined} />)
    expect(owner).toContain('查看原文')
    expect(owner).not.toContain('共享给对方')
    expect(owner).not.toContain('撤回共享')
    expect(owner).toContain('width:clamp(320px, calc(100vw - 40px), 560px)')
    expect(owner).toContain('height:clamp(420px, calc(100vh - 48px), 560px)')

    const incoming = renderToStaticMarkup(<RelatedRecordingDetail item={recording('incoming-1', true)} onClose={() => undefined} />)
    expect(incoming).not.toContain('对方共享 · 只读')
    expect(incoming).not.toContain('共享给对方')
    expect(owner).toContain('--dsw-specific-menu')
    expect(ARKME_RELATED_RECORDING_TRANSCRIPT_BG).toContain('--dsw-alias-bg-module-platform')
    expect(ARKME_RELATED_RECORDING_TRANSCRIPT_BG).not.toContain('--dsw-alias-bg-subtle')
  })

  it('loads a shared chat card detail before showing the transcript toggle', async () => {
    const initial = recording('shared-1', true, {
      transcript: undefined,
      transcriptAvailable: false,
      sharedRecordingDetailRef: 'detail-ref-1',
    })
    const loadDetail = vi.fn(async () => recording('shared-1', true, {
      transcript: '这是加载后的完整原文',
      transcriptAvailable: true,
      sharedRecordingDetailRef: 'detail-ref-1',
    }))
    let renderer: ReactTestRenderer | undefined
    await act(async () => {
      renderer = create(<RelatedRecordingDetail
        item={initial}
        loadDetail={loadDetail}
        showReadOnlyLabel={false}
        onClose={() => undefined}
      />)
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(loadDetail).toHaveBeenCalledTimes(1)
    expect(loadDetail.mock.calls[0]?.[0]).toMatchObject({ sharedRecordingDetailRef: 'detail-ref-1' })
    const toggle = renderer!.root.findAllByType('button').find(button => button.props.children === '查看原文')
    expect(toggle).toBeDefined()
    await act(async () => { toggle!.props.onClick() })
    const tree = JSON.stringify(renderer!.toJSON())
    expect(tree).toContain('这是加载后的完整原文')
    expect(tree).not.toContain('对方共享 · 只读')
    await act(async () => { renderer!.unmount() })
  })

  it('only lazy-loads original text when a desktop shared-recording detail ref exists', async () => {
    const loadDetail = vi.fn(async () => recording('shared-without-ref', true, {
      transcript: '不应该被加载',
      transcriptAvailable: true,
    }))
    let renderer: ReactTestRenderer | undefined
    await act(async () => {
      renderer = create(<RelatedRecordingDetail
        item={recording('shared-without-ref', true, {
          transcript: undefined,
          transcriptAvailable: false,
        })}
        loadDetail={loadDetail}
        onClose={() => undefined}
      />)
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(loadDetail).not.toHaveBeenCalled()
    expect(JSON.stringify(renderer!.toJSON())).not.toContain('查看原文')
    await act(async () => { renderer!.unmount() })
  })

  it('renders the recording detail as a top-layer modal over the directory quick-add button', () => {
    const source = readFileSync(new URL('../src/client/related-recordings.tsx', import.meta.url), 'utf8')
    expect(source).toContain('zIndex: 10020')
    expect(source).toContain('createPortal(detail, document.body)')
  })

  it('keeps transcript expansion from adding a visible scrollbar gutter', () => {
    const source = readFileSync(new URL('../src/client/related-recordings.tsx', import.meta.url), 'utf8')
    expect(source).toContain('arkme-related-recording-modal-body')
    expect(source).toContain('scrollbar-width: none')
    expect(source).toContain('::-webkit-scrollbar')
    expect(source).toContain("overscrollBehavior: 'contain'")
  })

  it('keeps shared recording chat cards in their standalone desktop layout', () => {
    const source = readFileSync(new URL('../src/client/ArkmeSidebar.tsx', import.meta.url), 'utf8')
    expect(source).toContain('sharedRecordingMessageLine')
    expect(source).toContain('sharedRecordingBubble')
    expect(source).toContain("'source.shared-recording-detail'")
    expect(source).toContain('loadDetail={loadRelatedRecordingDetail}')
  })

  it('deduplicates overlapping pages and rejects stale contact responses', () => {
    const first = recording('recording-1')
    const second = recording('recording-2', false, { startAtMillis: first.startAtMillis - 1000 })
    const dateStampOnly = recording('recording-date-stamp', false, {
      startAtMillis: 0,
      endAtMillis: 0,
      dateStamp: 20260807,
    })
    expect(mergeRelatedRecordingItems([first], [first, second]).map(item => item.recordingRef))
      .toEqual(['recording-1', 'recording-2'])
    expect(groupRelatedRecordings([first, second])).toHaveLength(1)
    expect(groupRelatedRecordings([dateStampOnly])[0]?.label).toBe('2026-08-07 周五')
    expect(isCurrentRelatedRecordingRequest(2, 2, 'source-a', 'source-a')).toBe(true)
    expect(isCurrentRelatedRecordingRequest(1, 2, 'source-a', 'source-a')).toBe(false)
    expect(isCurrentRelatedRecordingRequest(2, 2, 'source-a', 'source-b')).toBe(false)
  })
})
