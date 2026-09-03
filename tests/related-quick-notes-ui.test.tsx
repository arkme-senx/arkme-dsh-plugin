import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  ArkmeRelatedQuickNoteDetail,
  ArkmeRelatedQuickNotesCard,
  ArkmeRelatedQuickNotesList,
  relatedDrawerBackTarget,
} from '../src/client/ArkmeRelatedQuickNotes.js'
import type { ArkmeRelatedQuickNoteDetail as ArkmeRelatedQuickNoteDetailDto, ArkmeRelatedQuickNoteItem } from '../src/types.js'

function item(itemUid: string, textPreview: string): ArkmeRelatedQuickNoteItem {
  return {
    relatedRef: `opaque-${itemUid}`,
    senderName: itemUid === 'a' ? '小林' : '我',
    sendAtMillis: 1_710_000_000_000,
    title: '',
    textPreview,
  }
}

describe('related quick note shared UI', () => {
  it('renders at most two previews in the Arkme summary card', () => {
    const list = {
      total: 4,
      items: [item('a', '@小林 没什么问题'), item('b', '问题不大'), item('c', '没这个问题')],
    }
    const markup = renderToStaticMarkup(createElement(ArkmeRelatedQuickNotesCard, {
      state: { kind: 'success', list },
      onOpen: vi.fn(),
      onRetry: vi.fn(),
    }))

    expect(markup).toContain('相关快记')
    expect(markup).toContain('共 4 条')
    expect(markup).toContain('@小林')
    expect(markup).toContain('没什么问题')
    expect(markup).toContain('<span style="color:var(--dsw-alias-state-business-primary, #3964fe)">@小林</span>')
    expect(markup).toContain('问题不大')
    expect(markup).not.toContain('没这个问题')
    expect(markup).toContain('aria-label="查看 4 条相关快记"')
  })

  it('hides non-result states and keeps failures as a compact retry row', () => {
    for (const state of [{ kind: 'idle' }, { kind: 'loading' }, { kind: 'empty' }] as const) {
      expect(renderToStaticMarkup(createElement(ArkmeRelatedQuickNotesCard, {
        state, onOpen: vi.fn(), onRetry: vi.fn(),
      }))).toBe('')
    }
    const error = renderToStaticMarkup(createElement(ArkmeRelatedQuickNotesCard, {
      state: { kind: 'error', message: '网络不可用' },
      onOpen: vi.fn(),
      onRetry: vi.fn(),
    }))
    expect(error).toContain('相关快记加载失败')
    expect(error).toContain('<button')
    expect(error).toContain('重试')
  })

  it('renders accessible list rows and all list states', () => {
    const list = { total: 2, items: [item('a', '@小林 没什么问题'), item('b', '问题不大')] }
    const success = renderToStaticMarkup(createElement(ArkmeRelatedQuickNotesList, {
      state: { kind: 'success', list }, onSelect: vi.fn(), onRetry: vi.fn(),
    }))
    expect(success).toContain('aria-label="打开相关快记：@小林 没什么问题"')
    expect(success).toContain('aria-label="打开相关快记：问题不大"')
    expect(success).toContain('<span style="color:var(--dsw-alias-state-business-primary, #3964fe)">@小林</span>')
    expect(success.match(/<button/g)).toHaveLength(2)
    expect(renderToStaticMarkup(createElement(ArkmeRelatedQuickNotesList, {
      state: { kind: 'loading' }, onSelect: vi.fn(), onRetry: vi.fn(),
    }))).toContain('正在加载相关快记')
    expect(renderToStaticMarkup(createElement(ArkmeRelatedQuickNotesList, {
      state: { kind: 'empty' }, onSelect: vi.fn(), onRetry: vi.fn(),
    }))).toContain('暂无相关快记')
    expect(renderToStaticMarkup(createElement(ArkmeRelatedQuickNotesList, {
      state: { kind: 'error', message: '加载失败' }, onSelect: vi.fn(), onRetry: vi.fn(),
    }))).toContain('重试')
  })

  it('reuses rich-content detail rendering and preserves two-level back targets', () => {
    const related = item('a', '没什么问题')
    const detail: ArkmeRelatedQuickNoteDetailDto = {
      relatedRef: 'opaque-a', senderName: '小林', isMe: false,
      sendAtMillis: 1_710_000_000_000, title: '详情标题',
      textContent: '@狗才 完整详情正文 https://example.com/related', status: 1,
    }
    const markup = renderToStaticMarkup(createElement(ArkmeRelatedQuickNoteDetail, {
      state: { kind: 'success', item: related, detail }, onRetry: vi.fn(),
    }))
    expect(markup).toContain('data-arkme-related-quick-note-detail="true"')
    expect(markup).toContain('小林')
    expect(markup).toContain('完整详情正文')
    expect(markup).toContain('<span style="color:var(--dsw-alias-state-business-primary, #3964fe)">@狗才</span>')
    expect(markup).toContain('data-arkme-link-label="true">https://example.com/related</span>')
    expect(relatedDrawerBackTarget('related-detail')).toBe('related-list')
    expect(relatedDrawerBackTarget('related-list')).toBe('source-detail')
    expect(relatedDrawerBackTarget('source-detail')).toBe('source-detail')
  })

  it('omits timestamps outside the JavaScript Date range', () => {
    const invalidItem = { ...item('a', '没什么问题'), sendAtMillis: 8_640_000_000_000_001 }
    const listMarkup = renderToStaticMarkup(createElement(ArkmeRelatedQuickNotesList, {
      state: { kind: 'success', list: { total: 1, items: [invalidItem] } },
      onSelect: vi.fn(), onRetry: vi.fn(),
    }))
    const detailMarkup = renderToStaticMarkup(createElement(ArkmeRelatedQuickNoteDetail, {
      state: {
        kind: 'success', item: invalidItem, detail: {
          relatedRef: invalidItem.relatedRef, senderName: '小林', isMe: false,
          sendAtMillis: invalidItem.sendAtMillis, title: '', textContent: '详情', status: 1,
        },
      },
      onRetry: vi.fn(),
    }))

    expect(listMarkup).not.toContain('<time')
    expect(detailMarkup).not.toContain('<time')
  })
})
