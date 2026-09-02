import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArkmeRelatedQuickNoteList, ArkmeSourceMessageExtendResult, ArkmeTimelineItem } from '../src/types.js'

const mocks = vi.hoisted(() => ({
  callArkme: vi.fn(),
  fileCapabilities: vi.fn(async () => ({ version: 1, maxFileBytes: 1_000, maxImageBytes: 1_000, maxAttachments: 9 })),
  stageFile: vi.fn(async (file: { name: string; type: string; size: number }) => ({
    fileRef: 'arkme-file-v1.11111111-1111-4111-8111-111111111111',
    fileName: file.name, mimeType: file.type, size: file.size, fileKind: 1,
  })),
  removeLocalFile: vi.fn(async () => undefined),
  openLocalFile: vi.fn(async () => ({ opened: true })),
}))

vi.mock('../src/client/api.js', () => ({
  callArkme: mocks.callArkme,
  ArkmeClientError: class ArkmeClientError extends Error {
    constructor(readonly body: { code: string; message: string; retryable: boolean }) {
      super(body.message)
    }
  },
}))

vi.mock('../src/sdk/index.js', () => ({
  createArkmeSdk: () => ({
    fileCapabilities: mocks.fileCapabilities,
    stageFile: mocks.stageFile,
    removeLocalFile: mocks.removeLocalFile,
    openLocalFile: mocks.openLocalFile,
    localFileUrl: (fileRef: string) => `/arkme-local/${fileRef}`,
  }),
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
    mocks.fileCapabilities.mockClear()
    mocks.stageFile.mockClear()
    mocks.removeLocalFile.mockClear()
    mocks.openLocalFile.mockClear()
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:detail-clipboard-preview')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    vi.stubGlobal('HTMLElement', class {})
    vi.stubGlobal('document', {
      activeElement: null,
      body: { style: { overflow: '' } },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      querySelector: vi.fn(() => null),
    })
    vi.stubGlobal('window', {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      requestAnimationFrame: (callback: () => void) => { callback(); return 1 },
    })
  })

  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

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
    expect(mocks.callArkme).toHaveBeenCalledTimes(3)
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

  it('shows the current quick note extension count and desktop-style extension rows', async () => {
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'source.related-quick-notes.from-message') return { total: 0, items: [] }
      if (operation === 'source.message-extension.context') return {
        parentRecordUid: 'record-source',
        extensionCount: 2,
        extensions: [{
          recordUid: 'extension-newer', level: 2, sourceKind: 'record_extension', senderDisplayName: '狗才',
          senderAvatarUrl: 'opaque-avatar', title: '', textContent: '新的延展正文', sendAtMillis: 1_710_000_120_000,
          templateKind: 2, displayKind: 0, officialMark: 0,
          mediaItems: [{ fileKind: 1, fileName: '补充截图.png', size: 12 }],
        }, {
          recordUid: 'extension-older', level: 2, sourceKind: 'record_extension', senderDisplayName: '小林',
          title: '', textContent: '较早的延展正文', sendAtMillis: 1_710_000_060_000,
          templateKind: 1, displayKind: 0, officialMark: 0, mediaItems: [],
        }],
      }
      throw new Error(`unexpected operation: ${operation}`)
    })
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<ArkmeTimelineDetailDrawer
        item={timelineItem} sourceRef="opaque-source" showOriginal={false}
        onClose={vi.fn()} onToggleOriginal={vi.fn()}
      />)
      await Promise.resolve(); await Promise.resolve()
    })

    expect(mocks.callArkme).toHaveBeenCalledWith(
      'source.message-extension.context',
      { sourceRef: 'opaque-source', messageActionRef: 'opaque-action' },
      expect.any(AbortSignal),
    )
    expect(renderer.root.findByProps({ 'data-arkme-note-extension-count': 'true' }).children.join('')).toBe('共2条延展')
    const newer = renderer.root.findByProps({ 'data-arkme-note-extension-item': 'extension-newer' })
    expect(newer.findAll(node => node.children.includes('狗才'))).not.toHaveLength(0)
    expect(newer.findAll(node => node.children.includes('新的延展正文'))).not.toHaveLength(0)
    expect(newer.findAll(node => node.children.includes('补充截图.png'))).not.toHaveLength(0)
    const rows = renderer.root.findAll(node => typeof node.props['data-arkme-note-extension-item'] === 'string')
    expect(rows.map(row => row.props['data-arkme-note-extension-item'])).toEqual(['extension-newer', 'extension-older'])
  })

  it('shows the extended parent preview below the current quick note content', async () => {
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'source.related-quick-notes.from-message') return { total: 0, items: [] }
      if (operation === 'source.message-extension.context') return {
        parentRecordUid: 'record-source', extensionCount: 0, extensions: [],
      }
      throw new Error(`unexpected operation: ${operation}`)
    })
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<ArkmeTimelineDetailDrawer
        item={{
          ...timelineItem,
          textContent: '当前延展正文',
          extensionParentRecordUid: 'record-parent',
          extensionParent: {
            itemUid: 'record-parent', senderName: '狗才', title: '',
            textContent: '感觉不能开子 Agent 来写代码，很耗token',
          },
        }}
        sourceRef="opaque-source" showOriginal={false}
        onClose={vi.fn()} onToggleOriginal={vi.fn()}
      />)
      await Promise.resolve(); await Promise.resolve()
    })

    const parent = renderer.root.findByProps({ 'data-arkme-detail-extension-parent': 'record-parent' })
    expect(parent.findAll(node => node.children.includes('感觉不能开子 Agent 来写代码，很耗token'))).toHaveLength(1)
    expect(parent.props.style).toMatchObject({ borderLeftWidth: 1, borderLeftStyle: 'solid' })
  })

  it('selects an extension row as the next extension target and shows the new child indented below it', async () => {
    const sent: ArkmeSourceMessageExtendResult = {
      recordUid: '11111111-1111-4111-8111-111111111111',
      parentRecordUid: 'extension-level-two',
      relationUid: '22222222-2222-4222-8222-222222222222',
      sequence: 19,
      status: 1,
      localState: 'synced',
      extension: {
        recordUid: '11111111-1111-4111-8111-111111111111',
        parentRecordUid: 'extension-level-two', level: 3, sourceKind: 'record_extension',
        senderDisplayName: '狗才', title: '', textContent: '三级延展', sendAtMillis: 1_710_000_180_000,
        templateKind: 1, displayKind: 0, officialMark: 0, mediaItems: [],
      },
    }
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'source.related-quick-notes.from-message') return { total: 0, items: [] }
      if (operation === 'source.message-extension.context') return {
        parentRecordUid: 'record-source', extensionCount: 1, extensions: [{
          recordUid: 'extension-level-two', parentRecordUid: 'record-source', level: 2,
          sourceKind: 'record_extension', senderDisplayName: '小林', title: '', textContent: '二级延展',
          sendAtMillis: 1_710_000_120_000, templateKind: 1, displayKind: 0, officialMark: 0, mediaItems: [],
        }],
      }
      if (operation === 'source.message-extension.extend') return sent
      throw new Error(`unexpected operation: ${operation}`)
    })
    vi.stubGlobal('crypto', { randomUUID: vi.fn()
      .mockReturnValueOnce('11111111-1111-4111-8111-111111111111')
      .mockReturnValueOnce('22222222-2222-4222-8222-222222222222') })
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<ArkmeTimelineDetailDrawer
        item={timelineItem} sourceRef="opaque-source" showOriginal={false}
        onClose={vi.fn()} onToggleOriginal={vi.fn()}
      />)
      await Promise.resolve(); await Promise.resolve()
    })
    const target = renderer.root.findByProps({ 'data-arkme-note-extension-item': 'extension-level-two' })
    act(() => { target.props.onClick() })
    expect(target.props['aria-pressed']).toBe(true)
    expect(target.props.style).toMatchObject({ borderRadius: 12 })
    act(() => {
      renderer.root.findByProps({ 'aria-label': '延展此快记' }).props.onChange({ target: { value: '三级延展' } })
    })
    await act(async () => {
      renderer.root.findByProps({ 'aria-label': '发送延展' }).props.onClick()
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    })

    expect(mocks.callArkme).toHaveBeenCalledWith('source.message-extension.extend', expect.objectContaining({
      sourceRef: 'opaque-source', messageActionRef: 'opaque-action', parentRecordUid: 'extension-level-two',
      textContent: '三级延展',
    }), expect.any(AbortSignal))
    const child = renderer.root.findByProps({
      'data-arkme-note-extension-item': '11111111-1111-4111-8111-111111111111',
    })
    expect(child.props.style).toMatchObject({ marginLeft: 30 })
  })

  it('keeps a newly sent detail extension visible while the server context catches up and reports it to the conversation', async () => {
    const sent: ArkmeSourceMessageExtendResult = {
      recordUid: '11111111-1111-4111-8111-111111111111',
      parentRecordUid: 'record-source',
      relationUid: '22222222-2222-4222-8222-222222222222',
      sequence: 19,
      status: 1,
      localState: 'synced',
      extension: {
        recordUid: '11111111-1111-4111-8111-111111111111', level: 2, sourceKind: 'record_extension',
        senderDisplayName: '狗才', title: '', textContent: '详情里新延展', sendAtMillis: 1_710_000_180_000,
        templateKind: 1, displayKind: 0, officialMark: 0, mediaItems: [],
      },
    }
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'source.related-quick-notes.from-message') return { total: 0, items: [] }
      if (operation === 'source.message-extension.context') return {
        parentRecordUid: 'record-source', extensionCount: 0, extensions: [],
      }
      if (operation === 'source.message-extension.extend') return sent
      throw new Error(`unexpected operation: ${operation}`)
    })
    vi.stubGlobal('crypto', { randomUUID: vi.fn()
      .mockReturnValueOnce('11111111-1111-4111-8111-111111111111')
      .mockReturnValueOnce('22222222-2222-4222-8222-222222222222') })
    const onExtensionSent = vi.fn()
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<ArkmeTimelineDetailDrawer
        item={timelineItem} sourceRef="opaque-source" showOriginal={false}
        onClose={vi.fn()} onToggleOriginal={vi.fn()} onExtensionSent={onExtensionSent}
      />)
      await Promise.resolve(); await Promise.resolve()
    })
    act(() => {
      renderer.root.findByProps({ 'aria-label': '延展此快记' }).props.onChange({ target: { value: '详情里新延展' } })
    })
    await act(async () => {
      renderer.root.findByProps({ 'aria-label': '发送延展' }).props.onClick()
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    })

    expect(onExtensionSent).toHaveBeenCalledWith(sent)
    expect(renderer.root.findAllByProps({
      'data-arkme-note-extension-item': '11111111-1111-4111-8111-111111111111',
    })).toHaveLength(1)
    expect(renderer.root.findByProps({ 'data-arkme-note-extension-count': 'true' }).children.join('')).toBe('共1条延展')
  })

  it('keeps the quick-note detail silent while extension context is loading', async () => {
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'source.related-quick-notes.from-message') return { total: 0, items: [] }
      if (operation === 'source.message-extension.context') return await new Promise(() => {})
      throw new Error(`unexpected operation: ${operation}`)
    })
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<ArkmeTimelineDetailDrawer
        item={timelineItem} sourceRef="opaque-source" showOriginal={false}
        onClose={vi.fn()} onToggleOriginal={vi.fn()}
      />)
      await Promise.resolve()
    })

    expect(JSON.stringify(renderer.toJSON())).not.toContain('加载延展中')
    expect(renderer.root.findAllByProps({ role: 'status' })).toHaveLength(0)
  })

  it('reports detail extension failures through toast without rendering an inline error row', async () => {
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'source.related-quick-notes.from-message') return { total: 0, items: [] }
      if (operation === 'source.message-extension.context') return {
        parentRecordUid: 'record-source', extensionCount: 0, extensions: [],
      }
      if (operation === 'source.message-extension.extend') throw new Error('资源不存在')
      throw new Error(`unexpected operation: ${operation}`)
    })
    vi.stubGlobal('crypto', { randomUUID: vi.fn()
      .mockReturnValueOnce('11111111-1111-4111-8111-111111111111')
      .mockReturnValueOnce('22222222-2222-4222-8222-222222222222') })
    const onToast = vi.fn()
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<ArkmeTimelineDetailDrawer
        item={timelineItem} sourceRef="opaque-source" showOriginal={false}
        onClose={vi.fn()} onToggleOriginal={vi.fn()} onToast={onToast}
      />)
      await Promise.resolve(); await Promise.resolve()
    })
    act(() => {
      renderer.root.findByProps({ 'aria-label': '延展此快记' }).props.onChange({ target: { value: '继续延展' } })
    })
    await act(async () => {
      renderer.root.findByProps({ 'aria-label': '发送延展' }).props.onClick()
      await Promise.resolve(); await Promise.resolve()
    })

    expect(onToast).toHaveBeenCalledWith('资源不存在')
    expect(JSON.stringify(renderer.toJSON())).not.toContain('资源不存在')
    expect(renderer.root.findAllByProps({ role: 'alert' })).toHaveLength(0)
  })

  it('uses the desktop detail footer divider and visible composer surface while retaining the arrow send control', async () => {
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'source.related-quick-notes.from-message') return { total: 0, items: [] }
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
      />, { unstable_isConcurrent: true } as never)
      await Promise.resolve()
    })

    const input = renderer.root.findByProps({ 'aria-label': '延展此快记' })
    expect(input.props.rows).toBe(1)
    expect(input.props.style).toMatchObject({
      fontSize: 14,
      minHeight: 28,
      maxHeight: 84,
      boxSizing: 'border-box',
      fieldSizing: 'content',
      overflowY: 'auto',
    })
    expect(input.parent?.props.style).toMatchObject({
      minHeight: 44,
      maxHeight: 100,
      border: 0,
      borderRadius: 12,
      background: '#f6f6f6',
    })
    expect(input.parent?.parent?.props.style).toMatchObject({
      padding: '12px 16px',
      borderTop: '0.5px solid #e6e6e6',
    })
    const attachmentButton = renderer.root.findByProps({ 'aria-label': '添加延展附件' })
    expect(attachmentButton.children).not.toContain('＋')
    expect(attachmentButton.props.style).toMatchObject({ width: 18, height: 28 })
    const sendButton = renderer.root.findByProps({ 'aria-label': '发送延展' })
    expect(sendButton.children).toContain('↑')
    expect(sendButton.props.style).toMatchObject({ width: 28, height: 28 })

    const pastedImage = { name: 'desktop.png', type: 'image/png', size: 12 }
    const preventDefault = vi.fn()
    await act(async () => {
      input.props.onPaste({
        clipboardData: {
          files: [] as unknown as FileList,
          items: [{ kind: 'file', getAsFile: () => pastedImage }] as unknown as DataTransferItemList,
        },
        preventDefault,
      })
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(mocks.stageFile).toHaveBeenCalledWith(pastedImage, expect.objectContaining({ signal: expect.any(AbortSignal) }))
    const attachmentList = renderer.root.findByProps({ role: 'list', 'aria-label': '待发送附件' })
    const attachmentPreview = renderer.root.findAll(node => node.type === 'div'
      && node.props.style?.padding === '8px 16px'
      && node.findAll(child => child === attachmentList).length === 1)
    expect(attachmentPreview).toHaveLength(1)
    expect(attachmentPreview[0]?.props.style).not.toHaveProperty('borderTop')
    const attachment = renderer.root.findByProps({ 'aria-label': '附件 desktop.png' })
    expect(attachment.props.style).toMatchObject({ width: 48, height: 48, borderRadius: 8 })
    expect(attachment.findByType('img').props.src).toBe('blob:detail-clipboard-preview')
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()
    expect(mocks.removeLocalFile).not.toHaveBeenCalled()
    await act(async () => { renderer.root.findByProps({ 'aria-label': '预览 desktop.png' }).props.onClick() })
    const dialog = renderer.root.findByProps({ role: 'dialog', 'aria-label': 'desktop.png' })
    expect(dialog.findByType('img').props.src).toBe('blob:detail-clipboard-preview')
    expect(mocks.openLocalFile).not.toHaveBeenCalled()
  })

  it('keeps the detail extension draft and attachments while browsing related quick notes', async () => {
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'source.related-quick-notes.from-message') return relatedList
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
    const detailInput = renderer.root.findByProps({ 'aria-label': '延展此快记' })
    act(() => { detailInput.props.onChange({ target: { value: '独立抽屉草稿' } }) })
    const fileInput = renderer.root.findByProps({ 'data-arkme-detail-extension-file-input': 'true' })
    await act(async () => {
      await fileInput.props.onChange({ currentTarget: { files: [{ name: 'draft.png', type: 'image/png', size: 12 }], value: '' } })
      await Promise.resolve()
    })

    act(() => { renderer.root.findByProps({ 'aria-label': '查看 2 条相关快记' }).props.onClick() })
    expect(renderer.root.findByProps({ 'aria-label': '延展此快记' }).props.value).toBe('独立抽屉草稿')
    expect(renderer.root.findAllByProps({ 'aria-label': 'draft.png，第 1 个附件' })).toHaveLength(1)
    act(() => { renderer.root.findByProps({ 'aria-label': '返回快记详情' }).props.onClick() })
    expect(renderer.root.findByProps({ 'aria-label': '延展此快记' }).props.value).toBe('独立抽屉草稿')
    expect(renderer.root.findAllByProps({ 'aria-label': 'draft.png，第 1 个附件' })).toHaveLength(1)
  })

  it('reuses the same detail extension record uid after a failed send', async () => {
    let attempts = 0
    mocks.callArkme.mockImplementation(async (operation: string, params?: Record<string, unknown>) => {
      if (operation === 'source.related-quick-notes.from-message') return { total: 0, items: [] }
      if (operation === 'source.message-extension.extend') {
        attempts += 1
        if (attempts === 1) throw new Error('网络中断')
        return { recordUid: params?.recordUid, parentRecordUid: 'record-source', status: 1, localState: 'synced' }
      }
      throw new Error(`unexpected operation: ${operation}`)
    })
    const uuids = [
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    ]
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => uuids.shift()) })
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<ArkmeTimelineDetailDrawer
        item={timelineItem} sourceRef="opaque-source" showOriginal={false}
        onClose={vi.fn()} onToggleOriginal={vi.fn()}
      />)
      await Promise.resolve()
    })
    act(() => { renderer.root.findByProps({ 'aria-label': '延展此快记' }).props.onChange({ target: { value: '失败后重试' } }) })
    await act(async () => {
      renderer.root.findByProps({ 'aria-label': '发送延展' }).props.onClick()
      await Promise.resolve(); await Promise.resolve()
    })
    await act(async () => {
      renderer.root.findByProps({ 'aria-label': '发送延展' }).props.onClick()
      await Promise.resolve(); await Promise.resolve()
    })

    const extensionCalls = mocks.callArkme.mock.calls.filter(([operation]) => operation === 'source.message-extension.extend')
    expect(extensionCalls).toHaveLength(2)
    expect(extensionCalls[0]?.[1]?.recordUid).toBe('11111111-1111-4111-8111-111111111111')
    expect(extensionCalls[1]?.[1]?.recordUid).toBe(extensionCalls[0]?.[1]?.recordUid)
    expect(extensionCalls[0]?.[1]?.relationUid).toBe('22222222-2222-4222-8222-222222222222')
    expect(extensionCalls[1]?.[1]?.relationUid).toBe(extensionCalls[0]?.[1]?.relationUid)
  })

  it('removes staged detail attachments when the drawer is discarded', async () => {
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'source.related-quick-notes.from-message') return { total: 0, items: [] }
      throw new Error(`unexpected operation: ${operation}`)
    })
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<ArkmeTimelineDetailDrawer
        item={timelineItem} sourceRef="opaque-source" showOriginal={false}
        onClose={vi.fn()} onToggleOriginal={vi.fn()}
      />)
      await Promise.resolve()
    })
    const fileInput = renderer.root.findByProps({ 'data-arkme-detail-extension-file-input': 'true' })
    await act(async () => {
      await fileInput.props.onChange({ currentTarget: { files: [{ name: 'discard.png', type: 'image/png', size: 12 }], value: '' } })
      await Promise.resolve()
    })
    await act(async () => { renderer.unmount(); await Promise.resolve() })
    expect(mocks.removeLocalFile).toHaveBeenCalledWith('arkme-file-v1.11111111-1111-4111-8111-111111111111')
  })

  it('aborts an in-flight detail extension before cleaning its staged attachment on close', async () => {
    let requestSignal: AbortSignal | undefined
    mocks.callArkme.mockImplementation(async (operation: string, _params?: Record<string, unknown>, signal?: AbortSignal) => {
      if (operation === 'source.related-quick-notes.from-message') return { total: 0, items: [] }
      if (operation === 'source.message-extension.extend') {
        requestSignal = signal
        return await new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => { reject(new Error('aborted')) }, { once: true })
        })
      }
      throw new Error(`unexpected operation: ${operation}`)
    })
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<ArkmeTimelineDetailDrawer
        item={timelineItem} sourceRef="opaque-source" showOriginal={false}
        onClose={vi.fn()} onToggleOriginal={vi.fn()}
      />)
      await Promise.resolve()
    })
    const fileInput = renderer.root.findByProps({ 'data-arkme-detail-extension-file-input': 'true' })
    await act(async () => {
      await fileInput.props.onChange({ currentTarget: { files: [{ name: 'sending.png', type: 'image/png', size: 12 }], value: '' } })
      await Promise.resolve()
    })
    await act(async () => {
      renderer.root.findByProps({ 'aria-label': '发送延展' }).props.onClick()
      await Promise.resolve()
    })
    expect(mocks.removeLocalFile).not.toHaveBeenCalled()
    await act(async () => { renderer.unmount(); await Promise.resolve(); await Promise.resolve() })
    expect(requestSignal?.aborted).toBe(true)
    expect(mocks.removeLocalFile).toHaveBeenCalledWith('arkme-file-v1.11111111-1111-4111-8111-111111111111')
  })

  it('does not let an old detail send clear the next target draft', async () => {
    let resolveOldSend!: (value: unknown) => void
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'source.related-quick-notes.from-message') return { total: 0, items: [] }
      if (operation === 'source.message-extension.extend') return await new Promise(resolve => { resolveOldSend = resolve })
      throw new Error(`unexpected operation: ${operation}`)
    })
    const uuids = [
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
    ]
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => uuids.shift()) })
    let renderer!: ReactTestRenderer
    const renderDrawer = (item: ArkmeTimelineItem) => <ArkmeTimelineDetailDrawer
      item={item} sourceRef="opaque-source" showOriginal={false}
      onClose={vi.fn()} onToggleOriginal={vi.fn()}
    />
    await act(async () => { renderer = create(renderDrawer(timelineItem)); await Promise.resolve() })
    act(() => { renderer.root.findByProps({ 'aria-label': '延展此快记' }).props.onChange({ target: { value: '旧目标内容' } }) })
    await act(async () => {
      renderer.root.findByProps({ 'aria-label': '发送延展' }).props.onClick()
      await Promise.resolve()
    })
    const nextItem = { ...timelineItem, itemUid: 'record-next', messageActionRef: 'opaque-next-action', textContent: '新目标' }
    await act(async () => { renderer.update(renderDrawer(nextItem)); await Promise.resolve() })
    act(() => { renderer.root.findByProps({ 'aria-label': '延展此快记' }).props.onChange({ target: { value: '新目标草稿' } }) })
    await act(async () => {
      resolveOldSend({ recordUid: 'old-record', parentRecordUid: 'record-source', status: 1, localState: 'synced' })
      await Promise.resolve(); await Promise.resolve()
    })
    expect(renderer.root.findByProps({ 'aria-label': '延展此快记' }).props.value).toBe('新目标草稿')
  })

  it('keeps an independent detail-drawer extension draft and sends an attachment-only extension', async () => {
    mocks.callArkme.mockImplementation(async (operation: string, params?: Record<string, unknown>) => {
      if (operation === 'source.related-quick-notes.from-message') return { total: 0, items: [] }
      if (operation === 'source.message-extension.extend') return {
        recordUid: params?.recordUid, parentRecordUid: 'record-source', status: 1, localState: 'synced',
        extension: { recordUid: params?.recordUid, level: 2, sourceKind: 'record_extension', senderDisplayName: '我', title: '', textContent: '', sendAtMillis: 1, templateKind: 2, displayKind: 0, officialMark: 0, mediaItems: [] },
      }
      throw new Error(`unexpected operation: ${operation}`)
    })
    const uuids = [
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
    ]
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => uuids.shift()) })
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

    const detailInput = renderer.root.findByProps({ 'aria-label': '延展此快记' })
    expect(detailInput.props.value).toBe('')
    const fileInput = renderer.root.findByProps({ 'data-arkme-detail-extension-file-input': 'true' })
    const image = { name: 'detail.png', type: 'image/png', size: 12 }
    await act(async () => {
      await fileInput.props.onChange({ currentTarget: { files: [image], value: '' } })
      await Promise.resolve()
    })
    expect(mocks.stageFile).toHaveBeenCalledWith(image, expect.objectContaining({ signal: expect.any(AbortSignal) }))
    expect(renderer.root.findAllByProps({ 'aria-label': 'detail.png，第 1 个附件' })).toHaveLength(1)

    await act(async () => {
      renderer.root.findByProps({ 'aria-label': '发送延展' }).props.onClick()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(mocks.callArkme).toHaveBeenCalledWith('source.message-extension.extend', {
      sourceRef: 'opaque-source',
      messageActionRef: 'opaque-action',
      textContent: '',
      recordUid: '22222222-2222-4222-8222-222222222222',
      relationUid: '33333333-3333-4333-8333-333333333333',
      fileRefs: ['arkme-file-v1.11111111-1111-4111-8111-111111111111'],
    }, expect.any(AbortSignal))
    expect(renderer.root.findAllByProps({ 'aria-label': 'detail.png，第 1 个附件' })).toHaveLength(0)
    expect(renderer.root.findByProps({ 'aria-label': '延展此快记' }).props.value).toBe('')
  })
})
