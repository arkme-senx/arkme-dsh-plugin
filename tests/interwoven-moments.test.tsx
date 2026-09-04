import { renderToStaticMarkup } from 'react-dom/server'
import { act, create } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import type { ArkmeInterwovenMention, ArkmeRelatedQuickNoteList, ArkmeSourceItem, ArkmeTimelineItem } from '../src/types.js'
import {
  ArkmeInterwovenDetailAside,
  ArkmeInterwovenMentionCard,
  interwovenContentParts,
  interwovenDetailTimeLabel,
  interwovenTimeLabel,
  mergeConversationRows,
  resolveInterwovenGroupTarget,
} from '../src/client/interwoven-moments.js'

function message(itemUid: string, sendAtMillis: number): ArkmeTimelineItem {
  return {
    itemUid, senderName: '小林', isMe: false, sendAtMillis,
    title: '', textContent: itemUid, status: 1,
  }
}

function moment(momentId: string, occurredAtMillis: number): ArkmeInterwovenMention {
  return {
    momentId, momentRef: `opaque-${momentId}`, occurredAtMillis, groupName: '即我大群',
    senderName: '小林', senderIsMe: false, summary: `@我 ${momentId}`, degraded: false,
  }
}

function source(sourceRef: string, kind: ArkmeSourceItem['kind'], displayName: string): ArkmeSourceItem {
  return { sourceRef, kind, displayName, activeAtMillis: 1, unreadCount: 0 }
}

describe('interwoven conversation projection', () => {
  it('merges messages and moments chronologically with stable identity deduplication', () => {
    const rows = mergeConversationRows(
      [message('m2', 20), message('m1', 10), message('m1', 10)],
      [moment('z', 20), moment('a', 20), moment('a', 20)],
    )

    expect(rows.map(row => row.id)).toEqual(['message:m1', 'message:m2', 'moment:a', 'moment:z'])
  })

  it('keeps a bounded maximum fixture stable without mutating either authority list', () => {
    const messages = Array.from({ length: 100 }, (_, index) => message(`message-${index}`, index * 2))
    const moments = Array.from({ length: 100 }, (_, index) => moment(`moment-${index}`, index * 2 + 1))

    const rows = mergeConversationRows(messages, moments)

    expect(rows).toHaveLength(200)
    expect(rows[0]?.id).toBe('message:message-0')
    expect(rows.at(-1)?.id).toBe('moment:moment-99')
    expect(messages).toHaveLength(100)
    expect(moments).toHaveLength(100)
  })

  it('formats today, yesterday and earlier timestamps using the card-owned time', () => {
    const now = new Date(2026, 7, 19, 12, 0).getTime()
    expect(interwovenTimeLabel(new Date(2026, 7, 19, 9, 8).getTime(), now)).toBe('09:08')
    expect(interwovenTimeLabel(new Date(2026, 7, 18, 20, 0).getTime(), now)).toBe('昨天 20:00')
    expect(interwovenTimeLabel(new Date(2026, 7, 12, 10, 51).getTime(), now)).toContain('08/12 10:51')
    expect(interwovenDetailTimeLabel(new Date(2026, 7, 19, 15, 13).getTime())).toBe('08月19日 15:13')
  })

  it('resolves only one exact loaded group source', () => {
    const target = source('group-one', 'group_chat', '前端重构')
    const privateChat = source('private-one', 'private_chat', '前端重构')

    expect(resolveInterwovenGroupTarget([privateChat, target], '前端重构')).toBe(target)
    expect(resolveInterwovenGroupTarget([target], '前端重构 ')).toBeUndefined()
    expect(resolveInterwovenGroupTarget([], '前端重构')).toBeUndefined()
    expect(resolveInterwovenGroupTarget([target, source('group-two', 'group_chat', '前端重构')], '前端重构'))
      .toBeUndefined()
  })

  it('splits mention tokens without coloring adjacent punctuation', () => {
    expect(interwovenContentParts('你好 @1D3E，@Purge!')).toEqual([
      { text: '你好 ', mention: false },
      { text: '@1D3E', mention: true },
      { text: '，', mention: false },
      { text: '@Purge', mention: true },
      { text: '!', mention: false },
    ])
  })
})

describe('interwoven UI', () => {
  it('restores source-detail and related-list scroll positions across nested navigation', () => {
    const occurredAtMillis = new Date(2026, 7, 19, 15, 13).getTime()
    const selected = vi.fn()
    const opened = vi.fn()
    const backed = vi.fn()
    const scrollBody = { scrollTop: 0 }
    const relatedList: ArkmeRelatedQuickNoteList = { total: 1, items: [{
      relatedRef: 'opaque-related-b', senderName: '小林',
      sendAtMillis: occurredAtMillis - 1, title: '', textPreview: '问题不大',
    }] }
    const sourceDetail = {
      momentId: 'one', groupName: '即我大群', senderName: '小林', senderIsMe: false,
      occurredAtMillis, title: '快记标题', textContent: '源快记正文', status: 1, degraded: false,
    }
    const sharedProps = {
      state: { kind: 'success' as const, detail: sourceDetail },
      relatedState: { kind: 'success' as const, list: relatedList },
      onClose: vi.fn(), onRetry: vi.fn(), onOpenRelated: opened,
      onSelectRelated: selected, onBackRelated: backed,
    }
    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(<ArkmeInterwovenDetailAside {...sharedProps} relatedView="source-detail" />, {
        createNodeMock: element => element.props['data-arkme-interwoven-aside-body'] === true ? scrollBody : {},
      })
    })

    scrollBody.scrollTop = 211
    act(() => {
      renderer.root.findByProps({ 'aria-label': '查看 1 条相关快记' }).props.onClick()
      renderer.update(<ArkmeInterwovenDetailAside {...sharedProps} relatedView="related-list" />)
    })
    expect(opened).toHaveBeenCalledTimes(1)
    scrollBody.scrollTop = 137
    act(() => {
      renderer.root.findByProps({ 'aria-label': '打开相关快记：问题不大' }).props.onClick()
    })
    expect(selected).toHaveBeenCalledWith(relatedList.items[0])
    act(() => {
      renderer.update(<ArkmeInterwovenDetailAside {...sharedProps} relatedView="related-detail"
        relatedDetailState={{ kind: 'loading', item: relatedList.items[0]! }} />)
    })
    scrollBody.scrollTop = 0
    act(() => {
      renderer.update(<ArkmeInterwovenDetailAside {...sharedProps} relatedView="related-list" />)
    })

    expect(scrollBody.scrollTop).toBe(137)
    act(() => {
      renderer.root.findByProps({ 'aria-label': '返回快记详情' }).props.onClick()
      renderer.update(<ArkmeInterwovenDetailAside {...sharedProps} relatedView="source-detail" />)
    })
    expect(backed).toHaveBeenCalledTimes(1)
    expect(scrollBody.scrollTop).toBe(211)
  })

  it('renders the centered transparent 18px-avatar card as a native keyboard button', () => {
    const markup = renderToStaticMarkup(
      <ArkmeInterwovenMentionCard moment={moment('one', Date.now())} rowId="moment:one" onOpen={vi.fn()} />,
    )

    expect(markup).toContain('<button type="button"')
    expect(markup).toContain('打开快记详情')
    expect(markup).toContain('即我大群，小林：@我 one')
    expect(markup).toContain('width:18px')
    expect(markup).toContain('gap:8px')
    expect(markup).toContain('font-size:13px')
    expect(markup).toContain('background:transparent')
    expect(markup).toContain('text-overflow:ellipsis')
    expect(markup).toContain('max-width:min(680px, 100%)')
    expect(markup).toContain('var(--dsw-alias-label-secondary')
    expect(markup).toContain('data-arkme-conversation-row="moment:one"')
  })

  it('renders distinct loading, error, success and degraded detail states', () => {
    const occurredAtMillis = new Date(2026, 7, 19, 15, 13).getTime()
    const relatedList: ArkmeRelatedQuickNoteList = { total: 2, items: [{
      relatedRef: 'opaque-related-b', senderName: '小林',
      sendAtMillis: occurredAtMillis - 1, title: '', textPreview: '问题不大',
    }, {
      relatedRef: 'opaque-related-a', senderName: '我',
      sendAtMillis: occurredAtMillis - 2, title: '', textPreview: '没什么问题',
    }] }
    const loading = renderToStaticMarkup(
      <ArkmeInterwovenDetailAside state={{ kind: 'loading' }} onClose={vi.fn()} onRetry={vi.fn()} />,
    )
    const error = renderToStaticMarkup(
      <ArkmeInterwovenDetailAside state={{ kind: 'error', message: '加载失败' }} onClose={vi.fn()} onRetry={vi.fn()} />,
    )
    const success = renderToStaticMarkup(<ArkmeInterwovenDetailAside state={{ kind: 'success', detail: {
      momentId: 'one', groupName: '即我大群', senderName: '小林', senderIsMe: false,
      occurredAtMillis, title: '快记标题', textContent: '你好 @1D3E，快记正文', status: 1, degraded: false,
    } }} onClose={vi.fn()} onRetry={vi.fn()} onOpenGroup={vi.fn()}
      relatedView="source-detail" relatedState={{ kind: 'success', list: relatedList }}
      relatedDetailState={{ kind: 'idle' }} onOpenRelated={vi.fn()} onSelectRelated={vi.fn()}
      onBackRelated={vi.fn()} onRetryRelated={vi.fn()} onRetryRelatedDetail={vi.fn()} />)
    const relatedListMarkup = renderToStaticMarkup(<ArkmeInterwovenDetailAside state={{ kind: 'success', detail: {
      momentId: 'one', groupName: '即我大群', senderName: '小林', senderIsMe: false,
      occurredAtMillis, title: '快记标题', textContent: '源快记正文', status: 1, degraded: false,
    } }} onClose={vi.fn()} onRetry={vi.fn()} relatedView="related-list"
      relatedState={{ kind: 'success', list: relatedList }} relatedDetailState={{ kind: 'idle' }}
      onOpenRelated={vi.fn()} onSelectRelated={vi.fn()} onBackRelated={vi.fn()}
      onRetryRelated={vi.fn()} onRetryRelatedDetail={vi.fn()} />)
    const relatedDetailMarkup = renderToStaticMarkup(<ArkmeInterwovenDetailAside state={{ kind: 'success', detail: {
      momentId: 'one', groupName: '即我大群', senderName: '小林', senderIsMe: false,
      occurredAtMillis, title: '快记标题', textContent: '源快记正文', status: 1, degraded: false,
    } }} onClose={vi.fn()} onRetry={vi.fn()} relatedView="related-detail"
      relatedState={{ kind: 'success', list: relatedList }} relatedDetailState={{ kind: 'success',
        item: relatedList.items[0]!, detail: {
          relatedRef: 'opaque-related-b', senderName: '小林', isMe: false, sendAtMillis: occurredAtMillis - 1,
          title: '', textContent: '完整相关快记正文', status: 1,
        } }} onOpenRelated={vi.fn()} onSelectRelated={vi.fn()} onBackRelated={vi.fn()}
      onRetryRelated={vi.fn()} onRetryRelatedDetail={vi.fn()} />)
    const degraded = renderToStaticMarkup(<ArkmeInterwovenDetailAside state={{ kind: 'success', detail: {
      momentId: 'one', groupName: '即我大群', senderName: '小林', senderIsMe: false,
      occurredAtMillis, title: '快记标题', textContent: '', status: 3, degraded: true,
    } }} onClose={vi.fn()} onRetry={vi.fn()} />)
    const degradedSummary = renderToStaticMarkup(<ArkmeInterwovenDetailAside state={{ kind: 'success', detail: {
      momentId: 'one', groupName: '即我大群', senderName: '小林', senderIsMe: false,
      occurredAtMillis, title: '', textContent: '@1D3E 安全摘要', status: 3, degraded: true,
    } }} onClose={vi.fn()} onRetry={vi.fn()} />)

    expect(loading).toContain('正在加载快记详情')
    expect(error).toContain('加载失败')
    expect(error).toContain('重试')
    expect(success).toContain('快记正文')
    expect(success).toContain('08月19日 15:13')
    expect(success).toContain('width:40px')
    expect(success).toContain('font-size:14px')
    expect(success).toContain('font-size:12px')
    expect(success).toContain('var(--dsw-alias-state-business-primary')
    expect(success).toContain('data-arkme-interwoven-group-target="即我大群"')
    expect(success).not.toContain('disabled=""')
    expect(success).toContain('相关快记')
    expect(success).toContain('查看 2 条相关快记')
    expect(success).not.toContain('延展此快记')
    expect(relatedListMarkup).toContain('2 条相关快记')
    expect(relatedListMarkup).toContain('aria-label="返回快记详情"')
    expect(relatedListMarkup).toContain('打开相关快记：问题不大')
    expect(relatedDetailMarkup).toContain('完整相关快记正文')
    expect(relatedDetailMarkup).toContain('aria-label="返回相关快记列表"')
    expect(degraded).toContain('正文暂时不可用')
    expect(degradedSummary).toContain('安全摘要')
    expect(degradedSummary).toContain('data-arkme-interwoven-degraded="true"')
    expect(degradedSummary).not.toContain('正文暂时不可用')
    expect(degraded).toContain('disabled=""')
    for (const markup of [loading, error, success, relatedListMarkup, relatedDetailMarkup, degraded, degradedSummary]) {
      expect(markup).toContain('aria-label="关闭快记详情"')
      expect(markup).toContain('position:absolute')
      expect(markup).toContain('width:405px')
      expect(markup).toContain('max-width:100%')
      expect(markup).toContain('aria-label="调整快记详情宽度"')
      expect(markup).toContain('aria-valuenow="405"')
      expect(markup).toContain('top:68px')
      expect(markup).not.toContain('top:0;right:0;bottom:0')
      expect(markup).toContain('bottom:0')
      expect(markup).toContain('height:auto')
      expect(markup).toContain('min-height:0')
      expect(markup).not.toContain('height:min(695px, 100%)')
      expect(markup).toContain('background:#fff')
      expect(markup).toContain('border-left:1px solid #e5e6e9')
    }
  })
})
