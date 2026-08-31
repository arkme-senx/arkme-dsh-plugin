import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArkmeRelatedQuickNoteList, ArkmeTimelineItem } from '../src/types.js'

const mocks = vi.hoisted(() => ({ callArkme: vi.fn() }))

vi.mock('../src/client/api.js', () => ({
  callArkme: mocks.callArkme,
  ArkmeClientError: class ArkmeClientError extends Error {
    constructor(readonly body: { code: string; message: string; retryable: boolean }) {
      super(body.message)
    }
  },
}))

import { ArkmeTimelineDetailDrawer } from '../src/client/ArkmeNoteDetails.js'
import { ArkmeClientError } from '../src/client/api.js'

const timelineItem: ArkmeTimelineItem = {
  itemUid: 'record-source',
  messageActionRef: 'opaque-action',
  senderName: '小林',
  isMe: false,
  sendAtMillis: 1_710_000_000_000,
  title: '',
  textContent: '源快记正文',
  status: 1,
}

const relatedList: ArkmeRelatedQuickNoteList = {
  total: 2,
  items: [{
    relatedRef: 'opaque-related-b', senderName: '小林',
    sendAtMillis: 1_709_000_000_000, title: '', textPreview: '问题不大',
  }, {
    relatedRef: 'opaque-related-a', senderName: '我',
    sendAtMillis: 1_708_000_000_000, title: '', textPreview: '没什么问题',
  }],
}

describe('normal timeline related quick note drawer', () => {
  beforeEach(() => {
    mocks.callArkme.mockReset()
    vi.stubGlobal('HTMLElement', class {})
    vi.stubGlobal('document', {
      activeElement: null,
      body: {},
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      querySelector: vi.fn(() => null),
    })
  })

  afterEach(() => { vi.unstubAllGlobals() })

  it('loads, navigates to detail, and returns through the retained list', async () => {
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'source.related-quick-notes.from-message') return relatedList
      if (operation === 'source.related-quick-note.detail') return {
        relatedRef: 'opaque-related-b', senderName: '小林', isMe: false,
        sendAtMillis: 1_709_000_000_000, title: '', textContent: '完整相关快记正文', status: 1,
      }
      throw new Error(`unexpected operation: ${operation}`)
    })
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<ArkmeTimelineDetailDrawer
        item={timelineItem}
        sourceRef="opaque-source"
        showOriginal={false}
        onClose={vi.fn()}
        onToggleOriginal={vi.fn()}
      />)
      await Promise.resolve()
    })

    expect(mocks.callArkme).toHaveBeenCalledWith(
      'source.related-quick-notes.from-message',
      { sourceRef: 'opaque-source', messageActionRef: 'opaque-action' },
      expect.any(AbortSignal),
    )
    const card = renderer.root.findByProps({ 'aria-label': '查看 2 条相关快记' })
    act(() => { card.props.onClick() })
    expect(JSON.stringify(renderer.toJSON())).toContain('2 条相关快记')

    const row = renderer.root.findByProps({ 'aria-label': '打开相关快记：问题不大' })
    await act(async () => {
      row.props.onClick()
      await Promise.resolve()
    })
    expect(mocks.callArkme).toHaveBeenCalledWith(
      'source.related-quick-note.detail',
      { sourceRef: 'opaque-source', relatedRef: 'opaque-related-b' },
      expect.any(AbortSignal),
    )
    expect(JSON.stringify(renderer.toJSON())).toContain('完整相关快记正文')

    act(() => { renderer.root.findByProps({ 'aria-label': '返回相关快记列表' }).props.onClick() })
    expect(renderer.root.findAllByProps({ 'aria-label': '打开相关快记：问题不大' })).toHaveLength(1)
    act(() => { renderer.root.findByProps({ 'aria-label': '返回快记详情' }).props.onClick() })
    expect(JSON.stringify(renderer.toJSON())).toContain('源快记正文')
    expect(mocks.callArkme).toHaveBeenCalledTimes(2)
  })

  it('restores source-detail and related-list scroll positions across nested navigation', async () => {
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'source.related-quick-notes.from-message') return relatedList
      if (operation === 'source.related-quick-note.detail') return {
        relatedRef: 'opaque-related-b', senderName: '小林', isMe: false,
        sendAtMillis: 1_709_000_000_000, title: '', textContent: '完整相关快记正文', status: 1,
      }
      throw new Error(`unexpected operation: ${operation}`)
    })
    const scrollBody = { scrollTop: 0 }
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<ArkmeTimelineDetailDrawer
        item={timelineItem}
        sourceRef="opaque-source"
        showOriginal={false}
        onClose={vi.fn()}
        onToggleOriginal={vi.fn()}
      />, {
        createNodeMock: element => element.props.style?.overflowY === 'auto'
          ? scrollBody
          : { focus: vi.fn(), contains: vi.fn(() => false), isConnected: true },
      })
      await Promise.resolve()
    })

    scrollBody.scrollTop = 211
    act(() => { renderer.root.findByProps({ 'aria-label': '查看 2 条相关快记' }).props.onClick() })
    scrollBody.scrollTop = 137
    await act(async () => {
      renderer.root.findByProps({ 'aria-label': '打开相关快记：问题不大' }).props.onClick()
      await Promise.resolve()
    })
    scrollBody.scrollTop = 29
    act(() => { renderer.root.findByProps({ 'aria-label': '返回相关快记列表' }).props.onClick() })
    expect(scrollBody.scrollTop).toBe(137)
    act(() => { renderer.root.findByProps({ 'aria-label': '返回快记详情' }).props.onClick() })
    expect(scrollBody.scrollTop).toBe(211)
  })

  it('refreshes the related list instead of retrying an expired detail reference', async () => {
    let listCalls = 0
    const refreshedList: ArkmeRelatedQuickNoteList = {
      total: 1,
      items: [{
        relatedRef: 'opaque-related-fresh', senderName: '小林',
        sendAtMillis: 1_709_000_000_001, title: '', textPreview: '刷新后的相关快记',
      }],
    }
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'source.related-quick-notes.from-message') {
        listCalls += 1
        return listCalls === 1 ? relatedList : refreshedList
      }
      if (operation === 'source.related-quick-note.detail') {
        throw new ArkmeClientError({
          code: 'related-quick-note-ref-expired',
          message: '相关快记引用已过期，请刷新后重试',
          retryable: true,
        })
      }
      throw new Error(`unexpected operation: ${operation}`)
    })
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<ArkmeTimelineDetailDrawer
        item={timelineItem}
        sourceRef="opaque-source"
        showOriginal={false}
        onClose={vi.fn()}
        onToggleOriginal={vi.fn()}
      />)
      await Promise.resolve()
    })

    act(() => { renderer.root.findByProps({ 'aria-label': '查看 2 条相关快记' }).props.onClick() })
    await act(async () => {
      renderer.root.findByProps({ 'aria-label': '打开相关快记：问题不大' }).props.onClick()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(listCalls).toBe(2)
    expect(renderer.root.findAllByProps({ 'aria-label': '打开相关快记：刷新后的相关快记' })).toHaveLength(1)
    expect(JSON.stringify(renderer.toJSON())).not.toContain('相关快记引用已过期，请刷新后重试')
  })

  it('does not query without both source and message action refs', async () => {
    await act(async () => {
      create(<ArkmeTimelineDetailDrawer
        item={{ ...timelineItem, messageActionRef: undefined }}
        sourceRef="opaque-source"
        showOriginal={false}
        onClose={vi.fn()}
        onToggleOriginal={vi.fn()}
      />)
      await Promise.resolve()
    })
    expect(mocks.callArkme).not.toHaveBeenCalled()
  })
})
