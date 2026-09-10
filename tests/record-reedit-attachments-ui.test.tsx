import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArkmeSourceItem, ArkmeTimelineItem } from '../src/types.js'

const mocks = vi.hoisted(() => ({ callArkme: vi.fn(), renderedItems: [] as ArkmeTimelineItem[] }))
vi.mock('../src/client/api.js', () => ({
  callArkme: mocks.callArkme,
  ArkmeClientError: class extends Error {
    constructor(readonly body: { code: string; message: string; retryable: boolean }) { super(body.message) }
  },
}))
vi.mock('react-dom', () => ({ createPortal: (children: unknown) => children }))
vi.mock('../src/client/ArkmeRichContent.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/client/ArkmeRichContent.js')>()
  return { ...actual, ArkmeMessageContent: (props: Parameters<typeof actual.ArkmeMessageContent>[0]) => {
    mocks.renderedItems.push(props.item)
    return <actual.ArkmeMessageContent {...props} />
  } }
})

import { ArkmeSurface } from '../src/client/ArkmeSidebar.js'
import { ArkmeAttachmentStrip } from '../src/client/ArkmeAttachmentStrip.js'
import { ArkmeConfirmDialog } from '../src/client/ArkmeConfirmDialog.js'
import { ArkmeClientError } from '../src/client/api.js'
import { ArkmeRichComposerInput } from '../src/client/ArkmeRichComposerInput.js'
import * as composerFocus from '../src/client/composer-focus.js'
import { ArkmeMediaPreview } from '../src/client/ArkmeRichContent.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { arkmeChatDirectory, arkmeChatTimelineDelta } from '../src/client/chat-directory-store.js'
import { arkmeComposerDraftStore, arkmeSourceComposerDraftKey } from '../src/client/composer-draft-store.js'
import { arkmeMessageReadReceipts } from '../src/client/message-read-receipt-store.js'
import { arkmeUi } from '../src/client/ui-controller.js'
import { ArkmeConversationMemoryCache } from '../src/client/conversation-memory-cache.js'
import { MediaService } from '../src/services/media-service.js'
import { ChatService } from '../src/services/chat-service.js'

const source: ArkmeSourceItem = {
  sourceRef: 'reedit-source', sourceKey: 'chat:reedit', kind: 'private_chat', displayName: '附件编辑',
  activeAtMillis: 22, unreadCount: 0, latestSequence: 1,
}
const other = { ...source, sourceRef: 'other-source', sourceKey: 'chat:other', displayName: '其他会话' }
const item: ArkmeTimelineItem = {
  itemUid: 'record-a', messageActionRef: 'action-a', senderName: '我', isMe: true,
  sendAtMillis: 1, title: '', textContent: '原正文', status: 1, templateKind: 1, version: 3,
}
const existing = (id: string) => ({
  asset: { fileAssetUid: id, fileName: `${id}.pdf`, mimeType: 'application/pdf', size: 10, fileKind: 4 as const },
  selection: { fileAssetUid: id },
  block: { kind: 'file' as const, fileName: `${id}.pdf`, mediaRef: `media-${id}`, mimeType: 'application/pdf', size: 10, sortOrder: 0 },
})
const local = {
  fileRef: 'arkme-file-v1.00000000-0000-4000-8000-000000000001',
  fileName: 'new.pdf', mimeType: 'application/pdf', size: 1, fileKind: 4 as const,
}
const baseline = () => ({
  sourceRef: source.sourceRef, itemUid: item.itemUid, title: '', textContent: item.textContent,
  sendAtMillis: 1, templateKind: 1, displayKind: 0, version: 3, maxTextLength: 4000,
  preservesAttachments: true, attachments: [existing('a'), existing('b')], hasVoice: false, maxAttachments: 9,
})
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

describe('record re-edit attachment UI', () => {
  let renderer: ReactTestRenderer | undefined
  let snapshot: ReturnType<typeof baseline> & { draft?: Record<string, unknown> }
  const normalKey = arkmeSourceComposerDraftKey(42, source)
  const composer = () => renderer!.root.findByType(ArkmeRichComposerInput)
  const strip = () => renderer!.root.findByType(ArkmeAttachmentStrip)
  const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }
  const open = async (index = 0) => {
    const bubble = renderer!.root.findAllByProps({ 'aria-label': '打开快记详情' })[index]!
    act(() => bubble.props.onContextMenu({ preventDefault: vi.fn(), stopPropagation: vi.fn(), clientX: 120, clientY: 180 }))
    const entry = renderer!.root.findByProps({ 'aria-label': '消息操作' }).findAllByProps({ role: 'menuitem' })
      .find(button => button.findAllByType('span').some(span => span.children.includes('重新编辑')))!
    await act(async () => { entry.props.onClick(); await flush() })
  }
  const mount = async () => {
    await act(async () => {
      renderer = create(<ArkmeSurface productChrome={false} productNavigation={false} />, {
        createNodeMock: element => element.props.className === 'arkme-conversation-panel'
          ? { getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 720 }) } : null,
      })
      await flush()
    })
  }

  it('routes outer composer whitespace to the current handle and marks only its two bottom regions', async () => {
    const focus = vi.spyOn(composerFocus, 'focusArkmeComposerFromClick').mockReturnValue(false)
    await mount()
    const outer = renderer!.root.findByProps({ className: 'arkme-conversation-composer' })
    const footers = outer.findAll(node => typeof node.type === 'string' && node.props['data-arkme-composer-footer'] !== undefined)
    expect(footers.map(node => node.props['data-arkme-composer-footer'])).toEqual(['tools', 'hint'])
    expect(footers[0]!.findByProps({ 'aria-label': '发送消息' })).toBeDefined()
    expect(footers[1]!.children).toEqual(['Enter发送 / Shift+Enter换行'])
    const event = { currentTarget: {}, target: {}, button: 0, defaultPrevented: false }
    act(() => outer.props.onClick(event))
    expect(focus).toHaveBeenLastCalledWith(expect.objectContaining({ disabled: false, focus: expect.any(Function) }), event)
    const ordinaryHandle = focus.mock.calls.at(-1)![0]
    await open()
    act(() => renderer!.root.findByProps({ className: 'arkme-conversation-composer' }).props.onClick(event))
    expect(focus.mock.calls.at(-1)![0]).not.toBe(ordinaryHandle)
    expect(focus.mock.calls.at(-1)![0]?.value).toBe('原正文')
  })
  const pick = async () => {
    const input = renderer!.root.findAllByType('input').find(node => node.props.type === 'file')!
    await act(async () => { input.props.onChange({ currentTarget: { files: [new File(['x'], 'new.pdf', { type: 'application/pdf' })] } }); await flush() })
  }
  const stubStage = (stage: () => Promise<unknown>) => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/files/stage')) return stage()
      const request = JSON.parse(String(init?.body)) as { operation: string; params?: Record<string, unknown> }
      return { json: async () => ({ ok: true, value: await mocks.callArkme(request.operation, request.params) }) }
    }))
  }

  it('can edit again after adding an image and receiving the actual realtime projection', async () => {
    const image = { ...local, fileName: 'added.png', mimeType: 'image/png', fileKind: 1 as const }
    const attachments = [existing('a'), {
      asset: { fileAssetUid: 'image', fileName: image.fileName, mimeType: image.mimeType, size: 1, fileKind: 1 as const },
      selection: { fileAssetUid: 'image' },
      block: { kind: 'image' as const, fileAssetUid: 'image', mediaRef: 'image-ref', fileName: image.fileName, sortOrder: 1 },
    }]
    const raw = { relation: { record_uid: item.itemUid, sender_user_id: 42, attach_at: 1 },
      record: { status: 1, version: 4, payload: { template_kind: 2, display_kind: 0, text_content: '添加图片后',
        content_payload: { media_refs: attachments.map(view => ({ file_asset_uid: view.asset.fileAssetUid })) },
        media_display_items: attachments.map(view => ({ file_asset_uid: view.asset.fileAssetUid,
          file_name: view.asset.fileName, file_kind: view.asset.fileKind, preview_url: `https://example.test/${view.asset.fileAssetUid}` })),
      } } }
    const session = { userId: 42, accessToken: 'fixture', refreshToken: 'fixture' }
    const runtime = { config: { environment: 'test' }, stateStore: { uniqueCode: async () => 'fixture-signing-key' } }
    const media = new MediaService(runtime as never, {} as never, {} as never, { recordUid: () => item.itemUid })
    const chat = new ChatService(runtime as never, {} as never, { sealProfileImageRef: async () => 'avatar' } as never,
      media, {} as never, {} as never, { currentUserAgentSourceFallback: () => undefined } as never,
      { timelineAiPolish: () => undefined } as never, {} as never)
    const [delta] = await chat.chatTimelineItems({ items: [raw] }, session, 'chat', 'private_chat')
    let submitted = false
    const base = mocks.callArkme.getMockImplementation()!
    mocks.callArkme.mockImplementation(async (operation, params) => {
      if (operation === 'source.record-reedit.detail') return submitted
        ? { ...baseline(), version: 4, textContent: '添加图片后', attachments } : { ...baseline(), attachments: [existing('a')] }
      if (operation === 'source.timeline' && submitted) return { source, hasMore: false,
        items: [{ ...item, templateKind: 2, recordVersion: 4, textContent: '添加图片后', contentBlocks: attachments.map(view => view.block) }] }
      if (operation === 'source.record-reedit.acknowledge') return {}
      if (operation === 'source.record-reedit.submit') {
        submitted = true
        const baseVersion = Number(params?.expectedVersion)
        return { submissionId: `image-edit-${baseVersion}`, state: 'committed', baseVersion, itemUid: item.itemUid,
          title: '', textContent: params?.newText, attachments,
          result: { status: 'committed', itemUid: item.itemUid, version: baseVersion + 1, revisionUid: `revision-${baseVersion}`, projectionState: 'pending' } }
      }
      return base(operation, params)
    })
    stubStage(async () => ({ json: async () => ({ ok: true, value: image }) }))
    await mount(); await open()
    const input = renderer!.root.findAllByType('input').find(node => node.props.type === 'file')!
    await act(async () => {
      input.props.onChange({ currentTarget: { files: [new File(['x'], image.fileName, { type: image.mimeType })] } })
      await flush()
    })
    act(() => composer().props.onTextChange('添加图片后'))
    await act(async () => { renderer!.root.findByProps({ 'aria-label': '保存重新编辑' }).props.onClick(); await flush() })
    expect(mocks.callArkme).toHaveBeenCalledWith('source.record-reedit.submit', expect.objectContaining({
      attachments: [{ fileAssetUid: 'a' }, { fileRef: image.fileRef }], expectedVersion: 3,
    }))
    await act(async () => { arkmeChatTimelineDelta.publish([{ source, items: [delta!] }]); await flush() })
    const bubble = renderer!.root.findByProps({ 'data-arkme-message-item-uid': item.itemUid })
      .findByProps({ 'aria-label': '打开快记详情' })
    act(() => bubble.props.onContextMenu({ preventDefault: vi.fn(), stopPropagation: vi.fn(), clientX: 120, clientY: 180 }))
    const entry = renderer!.root.findByProps({ 'aria-label': '消息操作' }).findAllByProps({ role: 'menuitem' })
      .find(button => button.findAllByType('span').some(span => span.children.includes('重新编辑')))
    expect(entry).toBeDefined()
    await act(async () => { entry!.props.onClick(); await flush() })
    expect(composer().props.value).toBe('添加图片后')
    expect(strip().props.attachments.map((view: typeof attachments[number]) => view.selection)).toEqual(attachments.map(view => view.selection))
    act(() => composer().props.onTextChange('再次编辑'))
    await act(async () => { renderer!.root.findByProps({ 'aria-label': '保存重新编辑' }).props.onClick(); await flush() })
    expect(mocks.callArkme).toHaveBeenCalledWith('source.record-reedit.submit', expect.objectContaining({ newText: '再次编辑', expectedVersion: 4 }))
  })

  it('shows submitted text and attachments in place while remote saving is still pending', async () => {
    arkmeComposerDraftStore.setText(normalKey, '普通发送草稿')
    const base = mocks.callArkme.getMockImplementation()!
    mocks.callArkme.mockImplementation(async (operation, params) => {
      if (operation === 'source.record-reedit.submit') return {
        submissionId: 'submit-1', state: 'pending', itemUid: item.itemUid,
        title: '', textContent: '待保存新正文', attachments: [existing('b')],
      }
      if (operation === 'source.record-reedit.submissions') return []
      return base(operation, params)
    })
    await mount()
    await open()
    act(() => composer().props.onTextChange('待保存新正文'))
    await act(async () => { renderer!.root.findByProps({ 'aria-label': '保存重新编辑' }).props.onClick(); await flush() })
    expect(mocks.callArkme).toHaveBeenCalledWith('source.record-reedit.submit', expect.objectContaining({ newText: '待保存新正文' }))
    expect(renderer!.root.findAllByProps({ 'aria-label': '保存重新编辑' })).toHaveLength(0)
    const row = renderer!.root.findByProps({ 'data-arkme-message-item-uid': item.itemUid })
    expect(JSON.stringify(renderer!.toJSON())).toContain('待保存新正文')
    expect(row.findAllByProps({ 'aria-label': '重新编辑保存状态' })).toHaveLength(0)
    expect(composer().props.value).toBe('普通发送草稿')
    expect(arkmeComposerDraftStore.get(normalKey).text).toBe('普通发送草稿')
    expect(JSON.stringify(renderer!.toJSON())).toContain('b.pdf')
    expect(renderer!.root.findAllByProps({ 'data-arkme-highlight-backdrop': 'true' })).toHaveLength(0)
  })

  it.each(['pending', 'committed'] as const)(
    'does not restore a removed image when the accepted %s candidate lacks its main voice projection', async state => {
      const image = {
        asset: { fileAssetUid: 'old-image', fileName: 'removed.png', mimeType: 'image/png', size: 10, fileKind: 1 },
        selection: { fileAssetUid: 'old-image' },
        block: { kind: 'image' as const, fileAssetUid: 'old-image', mediaRef: 'old-image-ref',
          fileName: 'removed.png', mimeType: 'image/png', size: 10, sortOrder: 0 },
      }
      const original: ArkmeTimelineItem = { ...item, templateKind: 4, mediaUnavailable: true,
        contentBlocks: [image.block] }
      const candidate = { submissionId: 'voice-only-candidate', itemUid: item.itemUid, baseVersion: 3,
        state, title: '', textContent: '保留主语音并移除图片', attachments: [], voiceFileAssetUid: 'main-voice',
        ...(state === 'committed' ? { result: { status: 'committed', itemUid: item.itemUid,
          version: 4, revisionUid: 'revision', projectionState: 'pending' } } : {}),
      }
      const base = mocks.callArkme.getMockImplementation()!
      mocks.callArkme.mockImplementation(async (operation, params) => {
        if (operation === 'source.timeline') return { source, items: [original], hasMore: false }
        if (operation === 'source.record-reedit.detail') return { ...baseline(), templateKind: 4,
          hasVoice: true, attachments: [image] }
        if (operation === 'source.record-reedit.submit') return candidate
        return base(operation, params)
      })
      await mount()
      const message = () => renderer!.root.findByProps({ 'data-arkme-message-item-uid': item.itemUid })
      expect(message().findAllByProps({ alt: 'removed.png' })).toHaveLength(1)
      await open()
      act(() => strip().props.onRemove(strip().props.attachments[0]))
      act(() => composer().props.onTextChange(candidate.textContent))
      await act(async () => { renderer!.root.findByProps({ 'aria-label': '保存重新编辑' }).props.onClick(); await flush() })
      expect(mocks.callArkme).toHaveBeenCalledWith('source.record-reedit.submit',
        expect.objectContaining({ attachments: [], newText: candidate.textContent }))
      expect(candidate).not.toHaveProperty('voiceBlock')
      expect(mocks.renderedItems.filter(value => value.itemUid === item.itemUid).at(-1))
        .toMatchObject({ contentBlocks: [], mediaUnavailable: true, textContent: candidate.textContent })
      expect(message().findAllByProps({ alt: 'removed.png' })).toHaveLength(0)
      expect(message().findAll(node => node.type === 'p'
        && node.children.includes('部分媒体暂时无法加载，请刷新对话后重试'))).toHaveLength(1)
    },
  )

  it('explicitly resumes on source activation and keeps receipt queries read-only', async () => {
    await mount()
    expect(mocks.callArkme).toHaveBeenCalledWith('source.record-reedit.resume', { sourceRef: source.sourceRef })
    expect(mocks.callArkme).toHaveBeenCalledWith('source.record-reedit.submissions', { sourceRef: source.sourceRef })
    expect(mocks.callArkme.mock.calls.filter(([operation]) => operation === 'source.record-reedit.resume')).toHaveLength(1)
  })

  it.each(['refresh', 'delta'] as const)(
    'renews available same-version image capabilities through the Sidebar %s path after a Host restart', async trigger => {
      const runtime = { config: { environment: 'test' }, requireSession: async () => ({ userId: 42 }),
        fetchImpl: vi.fn(async () => new Response('image-bytes')) }
      const media = () => new MediaService(runtime as never, {} as never, {} as never, { recordUid: () => item.itemUid })
      const display = ['a', 'b'].map((id, sort_order) => ({ file_asset_uid: id, file_name: `${id}.png`,
        file_kind: 1, mime_type: 'image/png', size: 10, sort_order,
        download_url: `https://jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com/${id}.png` }))
      const raw = { record_core: { record_uid: item.itemUid, content_payload: {
        media_refs: display.map(({ download_url: _url, ...ref }) => ref),
      } } }
      const beforeRestart = media()
      const oldBlocks = beforeRestart.richContentBlocks(raw, 42, display)
      const afterRestart = media()
      const freshBlocks = afterRestart.richContentBlocks(raw, 42, display.slice(0, 1))
      expect(beforeRestart.recordMediaUnavailable(raw, oldBlocks)).toBe(false)
      expect(afterRestart.recordMediaUnavailable(raw, freshBlocks)).toBe(true)
      await expect(afterRestart.fetchMedia(oldBlocks[0]!.mediaRef)).rejects.toMatchObject({ code: 'media-ref-invalid' })
      await expect(afterRestart.fetchMedia(freshBlocks[0]!.mediaRef)).resolves.toMatchObject({ response: { status: 200 } })
      let timelineItem = { ...item, timelineItemKey: 'media-recovery', recordVersion: 8,
        contentBlocks: oldBlocks, mediaUnavailable: false }
      const base = mocks.callArkme.getMockImplementation()!
      mocks.callArkme.mockImplementation(async (operation, params) => operation === 'source.timeline'
        ? { source, items: [timelineItem], hasMore: false } : base(operation, params))
      await mount()
      timelineItem = { ...timelineItem, contentBlocks: freshBlocks, mediaUnavailable: true }
      await act(async () => {
        if (trigger === 'delta') arkmeChatTimelineDelta.publish([{ source, items: [timelineItem] }])
        else arkmeChatTimelineDelta.applyTimelineChange({ sourceKey: source.sourceKey!, timelineItemKey: 'media-recovery',
          changeKind: 'reedited', changeVersion: 8, relationTerminal: false, throughSequence: 1 })
        await flush()
      })
      const rendered = mocks.renderedItems.filter(value => value.itemUid === item.itemUid).at(-1)!
      expect(rendered).toMatchObject({ recordVersion: 8, mediaUnavailable: true })
      expect(rendered.contentBlocks).toHaveLength(2)
      expect(rendered.contentBlocks![0]).toMatchObject({ fileAssetUid: 'a', mediaRef: freshBlocks[0]!.mediaRef,
        originalRef: freshBlocks[0]!.originalRef })
      const images = renderer!.root.findByProps({ 'data-arkme-message-item-uid': item.itemUid }).findAllByType('img')
        .filter(image => ['a.png', 'b.png'].includes(image.props.alt))
      expect(images).toHaveLength(2)
      expect(images.find(image => image.props.alt === 'a.png')!.props.src).toContain(encodeURIComponent(freshBlocks[0]!.mediaRef))
    },
  )

  it('keeps the union of successive partial timeline deltas while preserving the incomplete-media marker', async () => {
    const blocks = ['a', 'b'].map((id, sortOrder) => ({ kind: 'image' as const, fileAssetUid: id,
      mediaRef: `fresh-${id}`, fileName: `${id}.png`, mimeType: 'image/png', size: 10, sortOrder }))
    const original = { ...item, recordVersion: 8, mediaUnavailable: true, contentBlocks: blocks.slice(0, 1) }
    const base = mocks.callArkme.getMockImplementation()!
    mocks.callArkme.mockImplementation(async (operation, params) => operation === 'source.timeline'
      ? { source, items: [original], hasMore: false } : base(operation, params))
    await mount()
    for (const contentBlocks of [blocks.slice(1), [], blocks.slice(0, 1)]) {
      await act(async () => { arkmeChatTimelineDelta.publish([{ source, items: [{ ...original, contentBlocks }] }]); await flush() })
      const rendered = mocks.renderedItems.filter(value => value.itemUid === item.itemUid).at(-1)!
      expect(rendered).toMatchObject({ recordVersion: 8, mediaUnavailable: true, contentBlocks: blocks })
      const images = renderer!.root.findByProps({ 'data-arkme-message-item-uid': item.itemUid }).findAllByType('img')
        .filter(image => ['a.png', 'b.png'].includes(image.props.alt))
      expect(images).toHaveLength(2)
    }
  })

  it.each(['receipt', 'event', 'receipt-slow'])('keeps a paged historical edit and its viewport after a %s refresh', async trigger => {
    vi.useFakeTimers()
    window.setTimeout = globalThis.setTimeout as typeof window.setTimeout
    window.clearTimeout = globalThis.clearTimeout as typeof window.clearTimeout
    const observers: IntersectionObserverCallback[] = []
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
        if (options?.rootMargin === '120px 0px 0px') observers.push(callback)
      }
      observe() {} disconnect() {}
    })
    let submitted = false
    let committed = false
    const base = mocks.callArkme.getMockImplementation()!
    const latest = Array.from({ length: 40 }, (_, index) => ({ ...item,
      itemUid: `latest-${index + 41}`, sendAtMillis: index + 41, sequence: index + 41,
    }))
    mocks.callArkme.mockImplementation(async (operation, params) => {
      if (operation === 'source.timeline') {
        if (committed && trigger === 'receipt-slow' && !params?.cursor) {
          await new Promise(resolve => setTimeout(resolve, 4000))
        }
        return params?.cursor
        ? { source, items: [{ ...item, sequence: 1, version: committed ? 4 : 3,
          textContent: committed ? '编辑历史消息' : item.textContent }], hasMore: false }
        : { source, items: latest, hasMore: true, nextCursor: { beforeSequence: 41 } }
      }
      const receipt = { submissionId: 'history-edit', itemUid: item.itemUid, baseVersion: 3,
        title: '', textContent: '编辑历史消息', attachments: [], state: 'pending' }
      if (operation === 'source.record-reedit.submit') { submitted = true; return receipt }
      if (operation === 'source.record-reedit.submissions') return !submitted ? [] : [{ ...receipt,
        ...(committed && trigger.startsWith('receipt') ? { state: 'committed', result: { status: 'committed',
          itemUid: item.itemUid, version: 4, revisionUid: 'rev', projectionState: 'pending' } } : {}),
      }]
      return base(operation, params)
    })
    const body = { scrollTop: 0, scrollHeight: 4000, clientHeight: 600, scrollTo: vi.fn(),
      querySelectorAll: () => [], getBoundingClientRect: () => ({ top: 0, bottom: 600, height: 600 }),
    }
    await act(async () => {
      renderer = create(<ArkmeSurface productChrome={false} productNavigation={false} />, {
        createNodeMock: element => element.props.className === 'arkme-conversation-body' ? body
          : element.props.className === 'arkme-conversation-panel'
            ? { getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 720 }) }
            : element.props.style?.width === '100%' && element.props.style?.height === 1 ? {} : null,
      })
      await flush()
    })
    expect(observers.length).toBeGreaterThan(0)
    body.scrollTop = 120
    await act(async () => { observers.at(-1)!([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver); await flush() })
    await open()
    act(() => composer().props.onTextChange('编辑历史消息'))
    await act(async () => { renderer!.root.findByProps({ 'aria-label': '保存重新编辑' }).props.onClick(); await flush() })
    expect(renderer!.root.findAllByProps({ 'data-arkme-message-item-uid': item.itemUid })).toHaveLength(1)
    committed = true
    await act(async () => {
      if (trigger === 'event') arkmeChatTimelineDelta.applyTimelineChange({ sourceKey: source.sourceKey!,
        timelineItemKey: 'history-target', changeKind: 'reedited', changeVersion: 4,
        relationTerminal: false, throughSequence: 1 })
      await vi.advanceTimersByTimeAsync(1500)
    })
    if (trigger === 'receipt-slow') await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(renderer!.root.findAllByProps({ 'data-arkme-message-item-uid': item.itemUid })).toHaveLength(1)
    expect(JSON.stringify(renderer!.toJSON())).toContain('编辑历史消息')
    expect(mocks.renderedItems.filter(value => value.itemUid === item.itemUid).at(-1)?.version).toBe(4)
    expect(body.scrollTop).toBe(120)
    expect(body.scrollTo).not.toHaveBeenCalled()
    expect(renderer!.root.findAllByProps({ 'data-arkme-message-item-uid': 'latest-80' })).toHaveLength(1)
  })

  it('refreshes an around window in place without loading the latest page', async () => {
    const stored = vi.spyOn(ArkmeConversationMemoryCache.prototype, 'storeTimeline')
    const notice = { noticeUid: 'notice', sourceKey: source.sourceKey!, message: '原有提示', createdAtMillis: 1 }
    const base = mocks.callArkme.getMockImplementation()!
    let refreshed = false
    const sibling = { ...item, itemUid: 'sibling', sequence: 2, sendAtMillis: 2 }
    mocks.callArkme.mockImplementation(async (operation, params) => {
      if (operation === 'source.timeline-around') return { source,
        items: [{ ...item, sequence: 1 }, sibling], anchorItemUid: item.itemUid, anchorSequence: 1,
        anchorIndex: 0, olderHasMore: false, newerHasMore: true, newerCursor: { afterSequence: 2 },
      }
      if (operation === 'source.timeline') {
        if (params?.cursor) {
          expect(params.cursor).toEqual({ beforeSequence: 3 })
          refreshed = true
          return { source, hasMore: false, items: [{ ...item, sequence: 1, version: 4, textContent: '历史定位更新' }, sibling] }
        }
        return { source, items: [{ ...item, itemUid: 'latest', sequence: 80, sendAtMillis: 80 }], hasMore: false,
          aiPolishNotices: [notice] }
      }
      return base(operation, params)
    })
    await mount()
    await act(async () => { arkmeUi.showConversationTarget(source, item.itemUid, 1, 42); await flush() })
    expect(renderer!.root.findAllByProps({ 'data-arkme-message-item-uid': item.itemUid })).toHaveLength(1)
    await act(async () => {
      arkmeChatTimelineDelta.applyTimelineChange({ sourceKey: source.sourceKey!, timelineItemKey: 'around-item',
        changeKind: 'reedited', changeVersion: 4, relationTerminal: false, throughSequence: 1 })
      await flush()
    })
    expect(refreshed).toBe(true)
    expect(JSON.stringify(renderer!.toJSON())).toContain('历史定位更新')
    expect(renderer!.root.findAllByProps({ 'data-arkme-message-item-uid': 'latest' })).toHaveLength(0)
    expect(renderer!.root.findAllByProps({ 'data-arkme-message-item-uid': 'sibling' })).toHaveLength(1)
    expect(stored.mock.calls.filter(([key]) => key === source.sourceKey).at(-1)?.[1]).toMatchObject({
      mode: 'around', newerCursor: { afterSequence: 2 }, newerHasMore: true,
      aroundSequenceRange: { minimumSequence: 1, maximumSequence: 2 }, aiPolishNotices: [notice],
    })
  })

  it('replays a deferred timeline invalidation when around navigation fails', async () => {
    let rejectAround!: (reason: Error) => void
    const around = new Promise<never>((_resolve, reject) => { rejectAround = reject })
    const base = mocks.callArkme.getMockImplementation()!
    const refreshReads: unknown[] = []
    let changed = false
    mocks.callArkme.mockImplementation(async (operation, params) => {
      if (operation === 'source.timeline-around') return around
      if (operation === 'source.timeline' && changed) {
        refreshReads.push(params)
        return { source, items: [{ ...item, version: 4, textContent: '定位失败后补刷的新正文' }], hasMore: false }
      }
      return base(operation, params)
    })
    await mount()
    await act(async () => { arkmeUi.showConversationTarget(source, 'missing-target', 7, 42); await flush() })
    await act(async () => {
      changed = true
      arkmeChatTimelineDelta.applyTimelineChange({ sourceKey: source.sourceKey!, timelineItemKey: 'changed-item',
        changeKind: 'reedited', changeVersion: 4, relationTerminal: false, throughSequence: 1 })
      await flush()
    })
    expect(refreshReads).toHaveLength(0)
    await act(async () => { rejectAround(new Error('未找到要定位的快记')); await flush() })
    expect(refreshReads).toEqual([{ sourceRef: source.sourceRef, limit: 100 }])
    expect(mocks.renderedItems.filter(value => value.itemUid === item.itemUid).at(-1))
      .toMatchObject({ version: 4, textContent: '定位失败后补刷的新正文' })
    expect(renderer!.root.findAllByProps({ 'data-arkme-message-item-uid': 'missing-target' })).toHaveLength(0)
  })

  it.each(['newer-record', 'complete-media', 'deleted'] as const)(
    'keeps live neighbor facts in every frame of a late around response: %s', async change => {
      const read = deferred<unknown>()
      const base = mocks.callArkme.getMockImplementation()!
      const neighbor: ArkmeTimelineItem = { ...item, itemUid: 'history-neighbor', timelineItemKey: 'neighbor-key',
        sequence: 8, sendAtMillis: 8, recordVersion: change === 'newer-record' ? 5 : 4,
        textContent: '新版本邻居', contentBlocks: [existing('a').block, existing('b').block] }
      mocks.callArkme.mockImplementation(async (operation, params) => operation === 'source.timeline-around'
        ? read.promise : base(operation, params))
      await mount()
      await act(async () => { arkmeUi.showConversationTarget(source, 'history-target', 7, 42); await flush() })
      await act(async () => {
        arkmeChatTimelineDelta.publish([{ source, items: [neighbor] }])
        await flush()
      })
      if (change === 'deleted') await act(async () => {
        arkmeChatTimelineDelta.applyTimelineChange({ sourceKey: source.sourceKey!, timelineItemKey: 'neighbor-key',
          changeKind: 'deleted', changeVersion: 5, relationTerminal: false, throughSequence: 8 })
        await flush()
      })
      expect(arkmeUi.getSnapshot().conversationTarget?.itemUid).toBe('history-target')
      mocks.renderedItems.length = 0
      await act(async () => {
        read.resolve({ source, items: [{ ...item, itemUid: 'history-target', sequence: 7, sendAtMillis: 7 },
          { ...neighbor, recordVersion: 4, mediaUnavailable: true, textContent: '旧版本邻居',
            contentBlocks: [existing('a').block] }],
          anchorItemUid: 'history-target', anchorSequence: 7, anchorIndex: 0,
          olderHasMore: false, newerHasMore: false })
        await flush()
      })
      const frames = mocks.renderedItems.filter(value => value.itemUid === neighbor.itemUid)
      if (change === 'deleted') expect(frames).toHaveLength(0)
      else {
        expect(frames.length).toBeGreaterThan(0)
        expect(frames.every(value => value.recordVersion === neighbor.recordVersion
          && value.contentBlocks?.length === 2 && value.textContent === neighbor.textContent)).toBe(true)
      }
      expect(renderer!.root.findAllByProps({ 'data-arkme-message-item-uid': 'history-target' })).toHaveLength(1)
    },
  )

  it('keeps the previous window when the around target was deleted during navigation', async () => {
    const read = deferred<unknown>()
    const base = mocks.callArkme.getMockImplementation()!
    mocks.callArkme.mockImplementation(async (operation, params) => operation === 'source.timeline-around'
      ? read.promise : base(operation, params))
    await mount()
    await act(async () => { arkmeUi.showConversationTarget(source, 'history-target', 7, 42); await flush() })
    await act(async () => {
      arkmeChatTimelineDelta.applyTimelineChange({ sourceKey: source.sourceKey!, timelineItemKey: 'target-key',
        changeKind: 'deleted', changeVersion: 5, relationTerminal: false, throughSequence: 7 })
      await flush()
    })
    mocks.renderedItems.length = 0
    await act(async () => {
      read.resolve({ source, items: [{ ...item, itemUid: 'history-target', timelineItemKey: 'target-key', sequence: 7 }],
        anchorItemUid: 'history-target', anchorSequence: 7, anchorIndex: 0,
        olderHasMore: false, newerHasMore: false })
      await flush()
    })
    expect(mocks.renderedItems.filter(value => value.itemUid === 'history-target')).toHaveLength(0)
    expect(arkmeUi.getSnapshot().conversationTarget).toBeUndefined()
    expect(renderer!.root.findAllByProps({ 'data-arkme-message-item-uid': item.itemUid })).toHaveLength(1)
    expect(JSON.stringify(renderer!.toJSON())).toContain('未找到要定位的快记')
  })

  it.each([false, true])('acknowledges complete timeline media despite a stale partial delta: %s', async newerVersion => {
    vi.useFakeTimers()
    window.setTimeout = globalThis.setTimeout as typeof window.setTimeout
    window.clearTimeout = globalThis.clearTimeout as typeof window.clearTimeout
    let complete = false
    let acknowledged = false
    const base = mocks.callArkme.getMockImplementation()!
    mocks.callArkme.mockImplementation(async (operation, params) => {
      if (operation === 'source.record-reedit.submissions') return acknowledged ? [] : [{
        submissionId: 'handoff', baseVersion: 3, itemUid: item.itemUid, state: 'committed',
        title: '', textContent: '已提交内容', attachments: [existing('a'), existing('b')],
        result: { status: 'committed', itemUid: item.itemUid, version: 4, revisionUid: 'rev', projectionState: 'pending' },
      }]
      if (operation === 'source.record-reedit.acknowledge') { acknowledged = true; return {} }
      if (operation === 'source.timeline') return { source, hasMore: false, items: [{
        ...item, recordVersion: complete && newerVersion ? 5 : 4, mediaUnavailable: !complete,
        textContent: complete && newerVersion ? '远端新版本正文' : '已提交内容',
        contentBlocks: complete ? [existing('a').block, existing('b').block] : [existing('a').block],
      }, ...(complete ? [] : [{ ...item, itemUid: 'removed-record', textContent: '不应被缓存恢复的旧记录' }])] }
      return base(operation, params)
    })
    await mount()
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
    expect(acknowledged).toBe(false)
    expect(JSON.stringify(renderer!.toJSON())).toContain('b.pdf')
    expect(renderer!.root.findAllByProps({ 'aria-label': '重新编辑保存状态' })).toHaveLength(0)
    await act(async () => {
      arkmeChatTimelineDelta.publish([{ source, items: [{
        ...item, recordVersion: 4, mediaUnavailable: true, textContent: '已提交内容',
        contentBlocks: [existing('a').block],
      }] }])
      await flush()
    })
    complete = true
    await act(async () => { await vi.advanceTimersByTimeAsync(4500) })
    expect(acknowledged).toBe(true)
    expect(JSON.stringify(renderer!.toJSON())).toContain('b.pdf')
    if (newerVersion) expect(JSON.stringify(renderer!.toJSON())).toContain('远端新版本正文')
    expect(JSON.stringify(renderer!.toJSON())).not.toContain('不应被缓存恢复的旧记录')
  })

  it('keeps a completed page authoritative when another re-edit invalidation retains the old partial delta', async () => {
    const blocks = ['a', 'b'].map((id, sortOrder) => ({ kind: 'image' as const, fileAssetUid: id,
      mediaRef: `complete-${id}`, fileName: `${id}.png`, mimeType: 'image/png', size: 10, sortOrder }))
    const partial = { ...item, recordVersion: 8, mediaUnavailable: true, contentBlocks: blocks.slice(0, 1) }
    let complete = false
    const base = mocks.callArkme.getMockImplementation()!
    mocks.callArkme.mockImplementation(async (operation, params) => operation === 'source.timeline'
      ? { source, items: [{ ...partial, mediaUnavailable: !complete, contentBlocks: complete ? blocks : partial.contentBlocks }], hasMore: false }
      : base(operation, params))
    await mount()
    await act(async () => { arkmeChatTimelineDelta.publish([{ source, items: [partial] }]); await flush() })
    complete = true
    await act(async () => {
      arkmeChatTimelineDelta.applyTimelineChange({ sourceKey: source.sourceKey!, timelineItemKey: 'record-key',
        changeKind: 'reedited', changeVersion: 8, relationTerminal: false, throughSequence: 1 })
      await flush()
    })
    expect(mocks.renderedItems.filter(value => value.itemUid === item.itemUid).at(-1))
      .toMatchObject({ recordVersion: 8, mediaUnavailable: false, contentBlocks: blocks })
    expect(arkmeChatTimelineDelta.getSnapshotForSource(source.sourceKey!).items[0]).toBe(partial)
    mocks.renderedItems.length = 0
    await act(async () => {
      arkmeChatTimelineDelta.applyTimelineChange({ sourceKey: source.sourceKey!, timelineItemKey: 'other-record-key',
        changeKind: 'reedited', changeVersion: 1, relationTerminal: false, throughSequence: 1 })
      await flush()
    })
    const frames = mocks.renderedItems.filter(value => value.itemUid === item.itemUid)
    expect(frames.length).toBeGreaterThan(0)
    expect(frames.every(value => value.mediaUnavailable === false && value.contentBlocks?.length === 2)).toBe(true)
  })

  it('keeps a new same-version partial media capability that arrives during an around read', async () => {
    const around = deferred<unknown>()
    const blocks = ['a', 'b'].map((id, sortOrder) => ({ kind: 'image' as const, fileAssetUid: id,
      mediaRef: `old-${id}`, originalRef: `old-original-${id}`, fileName: `${id}.png`, mimeType: 'image/png', size: 10, sortOrder }))
    const neighbor = { ...item, itemUid: 'history-neighbor', sequence: 8, sendAtMillis: 8, recordVersion: 8,
      contentBlocks: blocks, mediaUnavailable: false }
    const freshBlock = { ...blocks[0]!, mediaRef: 'renewed-a', originalRef: 'renewed-original-a' }
    const incoming = { ...neighbor, contentBlocks: [freshBlock], mediaUnavailable: true }
    const base = mocks.callArkme.getMockImplementation()!
    mocks.callArkme.mockImplementation(async (operation, params) => operation === 'source.timeline-around'
      ? around.promise : base(operation, params))
    await mount()
    await act(async () => { arkmeUi.showConversationTarget(source, 'history-target', 7, 42); await flush() })
    await act(async () => { arkmeChatTimelineDelta.publish([{ source, items: [incoming] }]); await flush() })
    mocks.renderedItems.length = 0
    await act(async () => {
      around.resolve({ source, items: [{ ...item, itemUid: 'history-target', sequence: 7, sendAtMillis: 7 }, neighbor],
        anchorItemUid: 'history-target', anchorSequence: 7, anchorIndex: 0, olderHasMore: false, newerHasMore: false })
      await flush()
    })
    const frames = mocks.renderedItems.filter(value => value.itemUid === neighbor.itemUid)
    expect(frames.length).toBeGreaterThan(0)
    expect(frames.every(value => value.recordVersion === 8 && value.mediaUnavailable === true
      && value.contentBlocks?.[0]?.mediaRef === freshBlock.mediaRef
      && value.contentBlocks[0]?.originalRef === freshBlock.originalRef)).toBe(true)
    const completeIndex = frames.findIndex(value => value.contentBlocks?.length === 2)
    expect(completeIndex).toBeGreaterThanOrEqual(0)
    expect(frames.slice(completeIndex).every(value => value.contentBlocks?.length === 2)).toBe(true)
    expect(renderer!.root.findByProps({ 'data-arkme-message-item-uid': neighbor.itemUid })
      .findByProps({ alt: 'a.png' }).props.src).toContain('renewed-a')
  })

  it('uses the second page request boundary when an earlier partial delta precedes that page complete media', async () => {
    const firstPage = deferred<unknown>()
    const blocks = ['a', 'b'].map((id, sortOrder) => ({ kind: 'image' as const, fileAssetUid: id,
      mediaRef: `page-two-${id}`, fileName: `${id}.png`, mimeType: 'image/png', size: 10, sortOrder }))
    const history = { ...item, sequence: 1, recordVersion: 8, mediaUnavailable: false, contentBlocks: blocks }
    const latest = { ...item, itemUid: 'latest-80', sequence: 80, sendAtMillis: 80 }
    const partial = { ...history, mediaUnavailable: true, contentBlocks: [{ ...blocks[0]!, mediaRef: 'earlier-delta-a' }] }
    let refreshing = false
    let secondPageStartedWith: ArkmeTimelineItem | undefined
    const base = mocks.callArkme.getMockImplementation()!
    mocks.callArkme.mockImplementation(async (operation, params) => {
      if (operation === 'source.timeline') {
        if (!refreshing) return { source, items: [history, latest], hasMore: false }
        if (!params?.cursor) return firstPage.promise
        expect(params.cursor).toEqual({ beforeSequence: 80 })
        secondPageStartedWith = arkmeChatTimelineDelta.getSnapshotForSource(source.sourceKey!).items[0]
        return { source, items: [history], hasMore: false }
      }
      return base(operation, params)
    })
    await mount()
    refreshing = true
    await act(async () => {
      arkmeChatTimelineDelta.applyTimelineChange({ sourceKey: source.sourceKey!, timelineItemKey: 'history-key',
        changeKind: 'reedited', changeVersion: 8, relationTerminal: false, throughSequence: 1 })
      await flush()
    })
    expect(mocks.callArkme).toHaveBeenCalledWith('source.timeline', { sourceRef: source.sourceRef, limit: 100 }, expect.any(AbortSignal))
    await act(async () => { arkmeChatTimelineDelta.publish([{ source, items: [partial] }]); await flush() })
    mocks.renderedItems.length = 0
    await act(async () => {
      firstPage.resolve({ source, items: [latest], hasMore: true, nextCursor: { beforeSequence: 80 } })
      await flush()
    })
    expect(secondPageStartedWith).toBe(partial)
    const frames = mocks.renderedItems.filter(value => value.itemUid === item.itemUid)
    expect(frames.length).toBeGreaterThan(0)
    expect(frames.every(value => value.mediaUnavailable === false && value.contentBlocks?.length === 2
      && value.contentBlocks[0]?.mediaRef === blocks[0]!.mediaRef)).toBe(true)
  })

  it.each(['committing', 'uncertain'] as const)('shows only actionable delivery feedback: %s', async state => {
    const base = mocks.callArkme.getMockImplementation()!
    mocks.callArkme.mockImplementation(async (operation, params) => operation === 'source.record-reedit.submissions'
      ? [{ submissionId: 'feedback', baseVersion: 3, itemUid: item.itemUid, state,
        title: '', textContent: '提交候选', attachments: [] }]
      : base(operation, params))
    await mount()
    expect(renderer!.root.findAllByProps({ 'aria-label': '重新编辑保存状态' })).toHaveLength(state === 'uncertain' ? 1 : 0)
    if (state === 'uncertain') expect(renderer!.root.findAllByType('button').some(button => button.children.includes('核对结果'))).toBe(true)
  })

  it('never renders an older initial response after a newer live record, even before a timeline cache exists', async () => {
    const read = deferred<unknown>()
    const base = mocks.callArkme.getMockImplementation()!
    mocks.callArkme.mockImplementation(async (operation, params) => operation === 'source.timeline'
      ? read.promise : base(operation, params))
    await mount()
    await act(async () => {
      arkmeChatTimelineDelta.publish([{ source, items: [{ ...item, recordVersion: 5,
        textContent: '远端新版本正文', contentBlocks: [existing('a').block, existing('b').block] }] }])
      await flush()
    })
    expect(JSON.stringify(renderer!.toJSON())).toContain('远端新版本正文')
    mocks.renderedItems.length = 0
    await act(async () => {
      read.resolve({ source, hasMore: false, items: [{ ...item, recordVersion: 4,
        mediaUnavailable: true, contentBlocks: [existing('a').block] }] })
      await flush()
    })
    const frames = mocks.renderedItems.filter(value => value.itemUid === item.itemUid)
    expect(frames.length).toBeGreaterThan(0)
    expect(frames.every(value => value.recordVersion === 5 && value.contentBlocks?.length === 2)).toBe(true)
  })

  it.each([
    { name: 'fresh complete URLs', patch: { contentBlocks: [{ ...existing('b').block, mediaRef: 'fresh-media' }] } },
    { name: 'explicit attachment removal', patch: { contentBlocks: [] } },
    { name: 'newer partial record', patch: { recordVersion: 6, mediaUnavailable: true, contentBlocks: [] } },
    { name: 'record deletion', patch: { status: -1, contentBlocks: [] } },
  ])('does not suppress authoritative changes when retaining complete media: $name', async ({ patch }) => {
    await mount()
    const full = { ...item, recordVersion: 5, contentBlocks: [existing('a').block, existing('b').block] }
    await act(async () => { arkmeChatTimelineDelta.publish([{ source, items: [full] }]); await flush() })
    const incoming = { ...full, ...patch }
    await act(async () => { arkmeChatTimelineDelta.publish([{ source, items: [incoming] }]); await flush() })
    if (incoming.status < 0) expect(JSON.stringify(renderer!.toJSON())).not.toContain('b.pdf')
    else expect(mocks.renderedItems.filter(value => value.itemUid === item.itemUid).at(-1)).toMatchObject(incoming)
  })

  it('ignores an old receipt read after leaving and returning to the same source', async () => {
    const read = deferred<unknown>()
    const base = mocks.callArkme.getMockImplementation()!
    let count = 0
    mocks.callArkme.mockImplementation(async (operation, params) => {
      if (operation === 'source.record-reedit.submissions') return ++count === 1 ? read.promise : []
      return base(operation, params)
    })
    await mount()
    await act(async () => { arkmeUi.selectSource(other); await flush() })
    await act(async () => { arkmeUi.selectSource(source); await flush() })
    await act(async () => { read.resolve([{ submissionId: 'stale', baseVersion: 3, itemUid: item.itemUid, state: 'pending', title: '', textContent: '迟到旧候选', attachments: [] }]); await flush() })
    expect(JSON.stringify(renderer!.toJSON())).not.toContain('迟到旧候选')
  })

  it('previews the saved content matching the forward action instead of a pending edit', async () => {
    const base = mocks.callArkme.getMockImplementation()!
    mocks.callArkme.mockImplementation(async (operation, params) => {
      if (operation === 'source.record-reedit.submissions') return [{
        submissionId: 'pending', baseVersion: 3, itemUid: item.itemUid, state: 'pending',
        title: '', textContent: '尚未保存候选', attachments: [],
      }]
      return base(operation, params)
    })
    await mount()
    const bubble = renderer!.root.findAllByProps({ 'aria-label': '打开快记详情' })[0]!
    act(() => bubble.props.onContextMenu({ preventDefault: vi.fn(), stopPropagation: vi.fn(), clientX: 120, clientY: 180 }))
    const forward = renderer!.root.findByProps({ 'aria-label': '消息操作' }).findAllByProps({ role: 'menuitem' })
      .find(button => button.findAllByType('span').some(span => span.children.includes('转发')))!
    act(() => forward.props.onClick())
    const dialog = renderer!.root.findByProps({ 'aria-labelledby': 'arkme-forward-target-title' })
    const target = dialog.findAll(node => node.type === 'button' && typeof node.props['aria-pressed'] === 'boolean')[0]!
    act(() => target.props.onClick())
    const previewText = dialog.findAll(() => true).flatMap(node => node.children.filter(child => typeof child === 'string')).join('\n')
    expect(previewText).toContain('原正文')
    expect(previewText).not.toContain('尚未保存候选')
  })

  it.each([false, true])('restores a failed candidate without changing ordinary input even when activation fails: %s', async activationFails => {
    arkmeComposerDraftStore.setText(normalKey, '普通输入')
    snapshot.draft = { title: '', textContent: '失败候选', attachments: [existing('b')], baseVersion: 3, draftRevision: 1 }
    const base = mocks.callArkme.getMockImplementation()!
    mocks.callArkme.mockImplementation(async (operation, params) => {
      if (operation === 'source.record-reedit.resume' && activationFails) throw new Error('恢复执行暂不可用')
      if (operation === 'source.record-reedit.submissions') return [{ submissionId: 'failed', baseVersion: 3, itemUid: item.itemUid, state: 'failed', title: '', textContent: '失败候选', attachments: [existing('b')], error: '上传失败' }]
      return base(operation, params)
    })
    await mount()
    const restore = renderer!.root.findAllByType('button').find(button => button.children.includes('恢复编辑'))!
    await act(async () => { restore.props.onClick({ stopPropagation() {} }); await flush() })
    expect(composer().props.value).toBe('失败候选')
    expect(strip().props.attachments).toHaveLength(1)
    expect(arkmeComposerDraftStore.get(normalKey).text).toBe('普通输入')
  })

  it('keeps the complete submitted candidate while the same source renews its capability', async () => {
    const base = mocks.callArkme.getMockImplementation()!
    const pending = { submissionId: 'pending-renewal', state: 'pending', itemUid: item.itemUid, baseVersion: 3,
      title: '', textContent: '已提交的完整候选', attachments: [existing('b'), { localFile: local, selection: { fileRef: local.fileRef } }] }
    let delayed = false
    const nextRead = deferred<unknown>()
    mocks.callArkme.mockImplementation(async (operation, params) => {
      if (operation === 'source.record-reedit.submissions') return delayed ? nextRead.promise : [pending]
      return base(operation, params)
    })
    await mount()
    const display = () => mocks.renderedItems.filter(value => value.itemUid === item.itemUid).at(-1)!
    expect(display().textContent).toBe(pending.textContent)
    expect(display().contentBlocks).toHaveLength(2)
    delayed = true
    await act(async () => { arkmeUi.selectSource({ ...source, sourceRef: 'renewed-source-ref', latestSequence: 2 }); await flush() })
    expect(display().textContent).toBe(pending.textContent)
    expect(display().contentBlocks).toHaveLength(2)
    await act(async () => { nextRead.resolve([pending]); await flush() })
    expect(display().textContent).toBe(pending.textContent)
    expect(display().contentBlocks).toHaveLength(2)
  })

  beforeEach(() => {
    mocks.renderedItems.length = 0
    snapshot = baseline()
    const storage = new Map<string, string>()
    const storageApi = { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => { storage.set(key, value) }, removeItem: (key: string) => { storage.delete(key) } }
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn(), setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout, innerHeight: 900, localStorage: storageApi, sessionStorage: storageApi })
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    arkmeComposerDraftStore.clearAccount(42)
    arkmeChatDirectory.clear()
    arkmeChatTimelineDelta.publish([])
    arkmeChatDirectory.activateAccount(42)
    arkmeChatDirectory.publish([source, other])
    arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 42 })
    arkmeMessageReadReceipts.activateAccount(42)
    arkmeUi.selectSource(source)
    mocks.callArkme.mockReset()
    mocks.callArkme.mockImplementation(async (operation: string, params?: Record<string, unknown>) => {
      if (operation === 'source.record-reedit.detail') return { ...snapshot, itemUid: params?.itemUid }
      if (operation === 'source.record-reedit.draft.put') return { saved: true, draftRevision: Number(params?.expectedDraftRevision ?? 0) + 1 }
      if (operation === 'source.record-reedit.submit') return { submissionId: 'submission', state: 'pending', itemUid: params?.itemUid, title: '', textContent: params?.newText, attachments: [] }
      if (operation === 'source.record-reedit.submissions') return []
      if (operation === 'source.record-reedit.resume') return { resumed: true }
      if (operation === 'files.capabilities') return { version: 1, maxFileBytes: 10_000, maxImageBytes: 10_000, maxAttachments: 9 }
      if (operation === 'source.timeline') return { source: arkmeUi.getSnapshot().selectedSource, items: [item, { ...item, itemUid: 'record-b', messageActionRef: 'action-b' }], hasMore: false }
      if (operation === 'sources.list') return { directory: 'root', items: [source, other], hasMore: false }
      if (operation === 'source.members') return { source, items: [], total: 0, activeCount: 0 }
      if (operation === 'source.interwoven-moments') return { state: 'disabled', moments: [], preparedAtMillis: 1 }
      if (operation === 'source.related-quick-notes.from-message') return { total: 0, items: [] }
      if (operation === 'records.tags.list') return { items: [] }
      throw new Error(`unexpected operation ${operation}`)
    })
    stubStage(async () => ({ json: async () => ({ ok: true, value: local }) }))
  })
  afterEach(async () => {
    await act(async () => { renderer?.unmount(); await flush() })
    renderer = undefined
    arkmeComposerDraftStore.clearAccount(42)
    arkmeChatDirectory.clear()
    arkmeChatTimelineDelta.publish([])
    arkmeMessageReadReceipts.activateAccount(undefined)
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it.each([false, true])('keeps refusal scoped to new messages when admission arrives after opening re-edit: %s', async lateAdmission => {
    const refusedSource = { ...source, directMessageAdmissionApplicable: true }
    const admission = deferred<unknown>()
    const refused = { state: 'refused_by_self', canSend: false, refusalCreationEnabled: true,
      ownRefused: true, counterpartRefused: false, ownRevision: 1, counterpartRevision: 0 }
    const base = mocks.callArkme.getMockImplementation()!
    mocks.callArkme.mockImplementation(async (operation, params) => {
      if (operation === 'sources.list') return { directory: 'root', items: [refusedSource, other], hasMore: false }
      if (operation === 'chat.direct-message-admission') return lateAdmission ? admission.promise : refused
      return base(operation, params)
    })
    arkmeComposerDraftStore.setText(normalKey, '普通草稿')
    arkmeChatDirectory.publish([refusedSource, other])
    arkmeUi.selectSource(refusedSource)
    await mount()
    if (!lateAdmission) {
      expect.soft(composer().props.disabled).toBe(true)
      expect.soft(renderer!.root.findByProps({ 'aria-label': '添加内容' }).props.disabled).toBe(true)
    }
    await open()
    if (lateAdmission) await act(async () => { admission.resolve(refused); await flush() })
    expect(composer().props.value).toBe('原正文')
    expect(composer().props.disabled).toBe(false)
    expect(renderer!.root.findByProps({ 'aria-label': '添加内容' }).props.disabled).toBe(false)
    await pick()
    expect(strip().props.attachments).toHaveLength(3)
    await act(async () => { renderer!.root.findByProps({ 'aria-label': '保存重新编辑' }).props.onClick(); await flush() })
    expect(mocks.callArkme).toHaveBeenCalledWith('source.record-reedit.submit', expect.objectContaining({
      attachments: [{ fileAssetUid: 'a' }, { fileAssetUid: 'b' }, { fileRef: local.fileRef }],
    }))
    expect(composer().props.disabled).toBe(true)
    expect(composer().props.value).toBe('')
    expect(arkmeComposerDraftStore.get(normalKey).text).toBe('普通草稿')
    expect(arkmeComposerDraftStore.get(normalKey).attachments).toHaveLength(0)
    expect(mocks.callArkme.mock.calls.some(([operation]) => operation === 'source.send-text')).toBe(false)
  })

  it('uses the existing strip to reorder and remove original attachments without touching the ordinary draft', async () => {
    arkmeComposerDraftStore.appendAttachments(normalKey, [{ localFile: local }], 9)
    await mount(); await open()
    expect(renderer!.root.findAllByType(ArkmeAttachmentStrip)).toHaveLength(1)
    expect(strip().props.attachments.map((attachment: ReturnType<typeof existing>) => attachment.asset.fileAssetUid)).toEqual(['a', 'b'])
    act(() => strip().props.onMove(1, 0))
    act(() => strip().props.onRemove(strip().props.attachments[1]))
    await act(async () => { renderer!.root.findByProps({ 'aria-label': '关闭重新编辑' }).props.onClick(); await flush() })
    expect(mocks.callArkme).toHaveBeenCalledWith('source.record-reedit.draft.put', expect.objectContaining({ attachments: [{ fileAssetUid: 'b' }], expectedVersion: 3, expectedDraftRevision: 0 }))
    expect(arkmeComposerDraftStore.get(normalKey).attachments).toEqual([{ localFile: local }])
    expect(mocks.callArkme.mock.calls.filter(([operation]) => operation === 'files.local.remove')).toHaveLength(0)
  })

  it('restores Tool attachment candidates and submits against their base version and draft revision', async () => {
    snapshot.draft = { title: '', textContent: '', attachments: [{ localFile: local, selection: { fileRef: local.fileRef } }], baseVersion: 2, draftRevision: 7, updatedAtMillis: 2 }
    await mount(); await open()
    expect(renderer!.root.findByProps({ 'aria-label': '保存重新编辑' }).props.disabled).toBe(false)
    expect(strip().props.attachments[0].localFile).toEqual(local)
    await act(async () => { renderer!.root.findByProps({ 'aria-label': '保存重新编辑' }).props.onClick(); await flush() })
    expect(mocks.callArkme).toHaveBeenCalledWith('source.record-reedit.submit', expect.objectContaining({ newText: '', attachments: [{ fileRef: local.fileRef }], expectedVersion: 2, expectedDraftRevision: 7 }))
  })

  it('keeps ordinary draft staging outside Host reference-managed retention', async () => {
    await mount(); await pick()
    const request = vi.mocked(fetch).mock.calls.find(([url]) => String(url).endsWith('/files/stage'))?.[1]
    expect(request).toBeDefined()
    expect(new Headers(request?.headers).get('X-Arkme-File-Retention')).toBeNull()
    expect(arkmeComposerDraftStore.get(normalKey).attachments[0]?.localFile).toEqual(local)
  })

  it('adds picked files only to re-edit and blocks reentrant changes while local preparation is pending', async () => {
    const staged = deferred<unknown>()
    stubStage(async () => await staged.promise)
    arkmeComposerDraftStore.setText(normalKey, '普通草稿')
    await mount(); await open()
    expect(renderer!.root.findByProps({ 'aria-label': '添加内容' }).props.disabled).toBe(false)
    await pick()
    expect(renderer!.root.findByProps({ 'aria-label': '保存重新编辑' }).props.disabled).toBe(true)
    expect(renderer!.root.findByProps({ 'aria-label': '关闭重新编辑' }).props.disabled).toBe(true)
    expect(renderer!.root.findByProps({ 'aria-label': '正在准备附件' })).toBeDefined()
    await pick()
    await act(async () => { staged.resolve({ json: async () => ({ ok: true, value: local }) }); await flush() })
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith('/files/stage'))).toHaveLength(1)
    const stagedRequest = vi.mocked(fetch).mock.calls.find(([url]) => String(url).endsWith('/files/stage'))?.[1]
    expect(new Headers(stagedRequest?.headers).get('X-Arkme-File-Retention')).toBe('references')
    expect(renderer!.root.findAllByProps({ role: 'alert' }).map(node => node.children)).toEqual([])
    expect(strip().props.attachments).toHaveLength(3)
    expect(arkmeComposerDraftStore.get(normalKey)).toMatchObject({ text: '普通草稿', attachments: [] })
  })

  it('routes pasted attachments through the same existing picker staging path', async () => {
    await mount(); await open()
    const preventDefault = vi.fn()
    await act(async () => {
      composer().props.onPaste({ preventDefault, clipboardData: { files: [new File(['x'], 'new.pdf', { type: 'application/pdf' })], items: [] } })
      await flush()
    })
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(renderer!.root.findAllByProps({ role: 'alert' }).map(node => node.children)).toEqual([])
    expect(strip().props.attachments).toHaveLength(3)
    expect(arkmeComposerDraftStore.get(normalKey).attachments).toHaveLength(0)
  })

  it('retains an attachment-only candidate when saving on close fails', async () => {
    await mount(); await open()
    act(() => { composer().props.onTextChange(''); strip().props.onRemove(strip().props.attachments[0]) })
    const base = mocks.callArkme.getMockImplementation()!
    mocks.callArkme.mockImplementation(async (operation: string, params?: Record<string, unknown>) => {
      if (operation === 'source.record-reedit.draft.put') throw new Error('草稿保存失败')
      return base(operation, params)
    })
    await act(async () => { renderer!.root.findByProps({ 'aria-label': '关闭重新编辑' }).props.onClick(); await flush() })
    expect(renderer!.root.findAllByProps({ 'data-arkme-composer-reedit-target': 'true' })).toHaveLength(1)
    expect(composer().props.value).toBe('')
    expect(strip().props.attachments).toHaveLength(1)
    expect(renderer!.root.findByProps({ role: 'alert' }).children).toContain('草稿保存失败')
  })

  it.each(['source', 'account'] as const)('ignores late staged files after a %s context switch', async kind => {
    const staged = deferred<unknown>()
    stubStage(async () => await staged.promise)
    await mount(); await open(); await pick()
    await act(async () => {
      if (kind === 'source') arkmeUi.selectSource(other)
      else arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 43 })
      await flush()
      staged.resolve({ json: async () => ({ ok: true, value: local }) })
      await flush()
    })
    expect(renderer!.root.findAllByProps({ 'data-arkme-composer-reedit-target': 'true' })).toHaveLength(0)
    expect(arkmeComposerDraftStore.get(normalKey).attachments).toHaveLength(0)
    expect(arkmeComposerDraftStore.get(arkmeSourceComposerDraftKey(kind === 'account' ? 43 : 42, kind === 'account' ? source : other)).attachments).toHaveLength(0)
  })

  it('reactivates attachment staging after a failed save on leaving and returning to the source', async () => {
    const base = mocks.callArkme.getMockImplementation()!
    mocks.callArkme.mockImplementation(async (operation: string, params?: Record<string, unknown>) => {
      if (operation === 'source.record-reedit.draft.put') throw new Error('离线，草稿保存失败')
      return base(operation, params)
    })
    await mount(); await open()
    act(() => composer().props.onTextChange('留在来源 A 的候选'))
    await act(async () => { arkmeUi.selectSource(other); await flush() })
    await act(async () => { arkmeUi.selectSource(source); await flush() })
    expect(composer().props.value).toBe('留在来源 A 的候选')
    await pick()
    expect(strip().props.attachments).toHaveLength(3)
    expect(strip().props.attachments[2].localFile).toEqual(local)
    expect(arkmeComposerDraftStore.get(normalKey).attachments).toHaveLength(0)
  })

  it('does not let an exit-save failure in another source block normal message extension', async () => {
    const base = mocks.callArkme.getMockImplementation()!
    mocks.callArkme.mockImplementation(async (operation, params) => {
      if (operation === 'source.record-reedit.draft.put') throw new Error('草稿保存失败')
      return base(operation, params)
    })
    await mount(); await open()
    act(() => composer().props.onTextChange('来源 A 未落盘草稿'))
    await act(async () => { arkmeUi.selectSource(other); await flush() })
    const bubble = renderer!.root.findAllByProps({ 'aria-label': '打开快记详情' })[0]!
    act(() => bubble.props.onContextMenu({ preventDefault: vi.fn(), stopPropagation: vi.fn(), clientX: 120, clientY: 180 }))
    const extend = renderer!.root.findByProps({ 'aria-label': '消息操作' }).findAllByProps({ role: 'menuitem' })
      .find(button => button.findAllByType('span').some(span => span.children.includes('延展')))!
    await act(async () => { extend.props.onClick(); await flush() })
    expect(renderer!.root.findAllByProps({ 'data-arkme-composer-extension-target': 'true' })).toHaveLength(1)
    await act(async () => { arkmeUi.selectSource(source); await flush() })
    expect(composer().props.value).toBe('来源 A 未落盘草稿')
  })

  it.each([
    { context: 'source', save: 'failed' }, { context: 'record', save: 'failed' },
    { context: 'source', save: 'delayed' }, { context: 'record', save: 'delayed' },
  ])('opens and saves another $context while the first candidate save is $save, then restores its input', async ({ context, save }) => {
    const savingA = deferred<{ draftRevision: number }>()
    const base = mocks.callArkme.getMockImplementation()!
    const isA = (params?: Record<string, unknown>) => params?.sourceRef === source.sourceRef && params?.itemUid === item.itemUid
    mocks.callArkme.mockImplementation(async (operation, params) => {
      if (operation === 'source.record-reedit.draft.put' && isA(params)) {
        if (save === 'failed') throw new Error('A 草稿持续保存失败')
        return savingA.promise
      }
      if (operation === 'source.record-reedit.detail' && !isA(params)) return {
        ...baseline(), sourceRef: params?.sourceRef, itemUid: params?.itemUid,
        textContent: 'B 原正文', attachments: [existing('B')],
      }
      return base(operation, params)
    })
    arkmeComposerDraftStore.setText(normalKey, 'A 普通草稿')
    arkmeComposerDraftStore.setText(arkmeSourceComposerDraftKey(42, other), 'B 普通草稿')
    await mount(); await open()
    act(() => composer().props.onTextChange('A 未落盘正文'))
    act(() => strip().props.onRemove(strip().props.attachments[0]))
    await pick()
    if (context === 'source') await act(async () => { arkmeUi.selectSource(other); await flush() })
    await open(context === 'source' ? 0 : 1)
    expect(composer().props.value).toBe('B 原正文')
    expect(strip().props.attachments.map((attachment: ReturnType<typeof existing>) => attachment.asset.fileAssetUid)).toEqual(['B'])
    act(() => composer().props.onTextChange('B 独立修改'))
    await act(async () => { renderer!.root.findByProps({ 'aria-label': '保存重新编辑' }).props.onClick(); await flush() })
    expect(mocks.callArkme).toHaveBeenCalledWith('source.record-reedit.submit', expect.objectContaining({
      sourceRef: context === 'source' ? other.sourceRef : source.sourceRef,
      itemUid: context === 'source' ? item.itemUid : 'record-b', newText: 'B 独立修改',
    }))
    expect(composer().props.value).toBe(context === 'source' ? 'B 普通草稿' : 'A 普通草稿')
    if (context === 'source') await act(async () => { arkmeUi.selectSource(source); await flush() })
    await open()
    expect(composer().props.value).toBe('A 未落盘正文')
    expect(strip().props.attachments).toHaveLength(2)
    expect(strip().props.attachments[0].asset.fileAssetUid).toBe('b')
    expect(strip().props.attachments[1].localFile).toEqual(local)
    act(() => composer().props.onTextChange('A 返回后继续输入'))
    const returnedFile = { ...local, fileRef: 'arkme-file-v1.00000000-0000-4000-8000-000000000003', fileName: '返回后新增.pdf' }
    stubStage(async () => ({ json: async () => ({ ok: true, value: returnedFile }) }))
    await pick()
    if (save === 'delayed') await act(async () => { savingA.resolve({ draftRevision: 1 }); await flush() })
    expect(composer().props.value).toBe('A 返回后继续输入')
    expect(strip().props.attachments).toHaveLength(3)
    expect(strip().props.attachments[2].localFile).toEqual(returnedFile)
    expect(renderer!.root.findAllByProps({ 'aria-label': '保存重新编辑' })).toHaveLength(1)
    expect(arkmeComposerDraftStore.get(normalKey)).toMatchObject({ text: 'A 普通草稿', attachments: [] })
  })

  it('releases the submit lock after an account switch interrupts its preparatory draft save', async () => {
    const saving = deferred<{ draftRevision: number }>()
    const base = mocks.callArkme.getMockImplementation()!
    mocks.callArkme.mockImplementation(async (operation, params) => operation === 'source.record-reedit.draft.put'
      ? saving.promise : base(operation, params))
    await mount(); await open()
    act(() => composer().props.onTextChange('账号 42 的未提交输入'))
    await act(async () => { renderer!.root.findByProps({ 'aria-label': '保存重新编辑' }).props.onClick(); await flush() })
    await act(async () => { arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 43 }); await flush() })
    expect(renderer!.root.findAllByProps({ 'aria-label': '保存重新编辑' })).toHaveLength(0)
    expect(composer().props.value).not.toBe('账号 42 的未提交输入')
    await act(async () => { saving.resolve({ draftRevision: 1 }); await flush() })
    expect(mocks.callArkme.mock.calls.filter(([operation]) => operation === 'source.record-reedit.submit')).toHaveLength(0)
    await act(async () => { arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 42 }); await flush() })
    expect(composer().props.value).toBe('账号 42 的未提交输入')
    expect(renderer!.root.findByProps({ 'aria-label': '保存重新编辑' }).props.disabled).toBe(false)
  })

  it('can reopen a record after an account switch invalidates its initial detail request', async () => {
    const detail = deferred<unknown>()
    const base = mocks.callArkme.getMockImplementation()!
    let reads = 0
    mocks.callArkme.mockImplementation(async (operation, params) => operation === 'source.record-reedit.detail' && ++reads === 1
      ? detail.promise : base(operation, params))
    await mount(); await open()
    expect(renderer!.root.findByProps({ 'aria-label': '保存重新编辑' }).props.disabled).toBe(true)
    await act(async () => { arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 43 }); await flush() })
    await act(async () => { detail.resolve({ ...baseline(), textContent: '迟到的账号 42 内容' }); await flush() })
    expect(composer().props.value).not.toBe('迟到的账号 42 内容')
    await act(async () => { arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 42 }); await flush() })
    await open()
    expect(composer().props.value).toBe('原正文')
    expect(renderer!.root.findByProps({ 'aria-label': '保存重新编辑' }).props.disabled).toBe(false)
  })

  it.each(['failed', 'pending'] as const)('closes an uninitialized editor after a %s detail read and can reopen it without stale input', async initial => {
    const detail = deferred<unknown>()
    const base = mocks.callArkme.getMockImplementation()!
    let reads = 0
    mocks.callArkme.mockImplementation(async (operation, params) => {
      if (operation === 'source.record-reedit.detail' && ++reads === 1) {
        if (initial === 'failed') throw new Error('重新编辑详情加载失败')
        return detail.promise
      }
      return base(operation, params)
    })
    arkmeComposerDraftStore.setText(normalKey, '保留普通发送正文')
    arkmeComposerDraftStore.appendAttachments(normalKey, [{ localFile: local }], 9)
    await mount(); await open()
    const close = renderer!.root.findByProps({ 'aria-label': '关闭重新编辑' })
    expect(close.props.disabled).not.toBe(true)
    await act(async () => { close.props.onClick(); await flush() })
    expect(renderer!.root.findAllByProps({ 'aria-label': '保存重新编辑' })).toHaveLength(0)
    expect(composer().props.value).toBe('保留普通发送正文')
    expect(strip().props.attachments[0].localFile).toEqual(local)
    expect(mocks.callArkme.mock.calls.filter(([operation]) => operation === 'source.record-reedit.draft.put')).toHaveLength(0)
    await open()
    act(() => composer().props.onTextChange('重新打开后的新输入'))
    if (initial === 'pending') await act(async () => {
      detail.resolve({ ...baseline(), textContent: '旧详情迟到内容', attachments: [] })
      await flush()
    })
    expect(composer().props.value).toBe('重新打开后的新输入')
    expect(strip().props.attachments).toHaveLength(2)
    expect(renderer!.root.findByProps({ 'aria-label': '保存重新编辑' }).props.disabled).toBe(false)
    expect(arkmeComposerDraftStore.get(normalKey)).toMatchObject({ text: '保留普通发送正文', attachments: [{ localFile: local }] })
  })

  it.each(['failed', 'pending'] as const)('rejects text, picked files and pasted files until the %s initial detail is available', async initial => {
    const detail = deferred<unknown>()
    const base = mocks.callArkme.getMockImplementation()!
    let reads = 0
    mocks.callArkme.mockImplementation(async (operation, params) => {
      if (operation === 'source.record-reedit.detail' && ++reads === 1) {
        if (initial === 'failed') throw new Error('详情失败，请关闭后重试')
        return detail.promise
      }
      return base(operation, params)
    })
    arkmeComposerDraftStore.setText(normalKey, '原普通发送草稿')
    arkmeComposerDraftStore.appendAttachments(normalKey, [{ localFile: local }], 9)
    await mount(); await open()
    act(() => composer().props.onTextChange('没有快照不能接收的输入'))
    await pick()
    await act(async () => {
      composer().props.onPaste({ preventDefault: vi.fn(), clipboardData: {
        files: [new File(['x'], 'paste.pdf', { type: 'application/pdf' })], items: [],
      } })
      await flush()
    })
    expect(composer().props.value).toBe(item.textContent)
    expect(composer().props.disabled).toBe(true)
    expect(renderer!.root.findByProps({ 'aria-label': '添加内容' }).props.disabled).toBe(true)
    expect(renderer!.root.findAllByType(ArkmeAttachmentStrip)).toHaveLength(0)
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith('/files/stage'))).toHaveLength(0)
    if (initial === 'failed') expect(renderer!.root.findByProps({ role: 'alert' }).children).toContain('详情失败，请关闭后重试')
    await act(async () => { renderer!.root.findByProps({ 'aria-label': '关闭重新编辑' }).props.onClick(); await flush() })
    expect(composer().props.value).toBe('原普通发送草稿')
    expect(strip().props.attachments[0].localFile).toEqual(local)
    await open()
    expect(composer().props.disabled).toBe(false)
    expect(renderer!.root.findByProps({ 'aria-label': '添加内容' }).props.disabled).toBe(false)
  })

  it.each(['close', 'source'] as const)('retains unsaved input when an account switch skips its queued %s save', async exit => {
    vi.useFakeTimers()
    const saving = deferred<{ draftRevision: number }>()
    const base = mocks.callArkme.getMockImplementation()!
    mocks.callArkme.mockImplementation(async (operation, params) => operation === 'source.record-reedit.draft.put'
      ? saving.promise : base(operation, params))
    await mount(); await open()
    act(() => composer().props.onTextChange('A 自动保存的旧内容'))
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); await flush() })
    expect(mocks.callArkme).toHaveBeenCalledWith('source.record-reedit.draft.put', expect.objectContaining({ newText: 'A 自动保存的旧内容' }))
    act(() => composer().props.onTextChange('A 尚未落盘的新内容'))
    await act(async () => {
      if (exit === 'close') renderer!.root.findByProps({ 'aria-label': '关闭重新编辑' }).props.onClick()
      else arkmeUi.selectSource(other)
      await flush()
    })
    await act(async () => { arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 43 }); await flush() })
    await act(async () => { saving.resolve({ draftRevision: 1 }); await flush() })
    await act(async () => {
      arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 42 })
      arkmeUi.selectSource(source)
      await flush()
    })
    expect(composer().props.value).toBe('A 尚未落盘的新内容')
    expect(renderer!.root.findByProps({ 'aria-label': '保存重新编辑' }).props.disabled).toBe(false)
    expect(mocks.callArkme.mock.calls.filter(([operation]) => operation === 'source.record-reedit.draft.put')).toHaveLength(1)
  })

  it('restores the same failed candidate when its source capability changes without an identity change', async () => {
    const base = mocks.callArkme.getMockImplementation()!
    let fail = true
    mocks.callArkme.mockImplementation(async (operation, params) => {
      if (operation === 'source.record-reedit.draft.put' && params?.sourceRef === source.sourceRef && fail) {
        throw new Error('A 保存失败')
      }
      return base(operation, params)
    })
    await mount(); await open()
    act(() => composer().props.onTextChange('来源凭据刷新前的输入'))
    await pick()
    await act(async () => { arkmeUi.selectSource(other); await flush() })
    await act(async () => { arkmeUi.selectSource({ ...source, sourceRef: 'ref-after-new-message', latestSequence: 2 }); await flush() })
    expect(composer().props.value).toBe('来源凭据刷新前的输入')
    expect(strip().props.attachments).toHaveLength(3)
    await open()
    expect(mocks.callArkme.mock.calls.filter(([operation]) => operation === 'source.record-reedit.detail')).toHaveLength(1)
    act(() => composer().props.onTextChange('凭据刷新后继续输入'))
    fail = false
    await act(async () => { renderer!.root.findByProps({ 'aria-label': '保存重新编辑' }).props.onClick(); await flush() })
    expect(mocks.callArkme).toHaveBeenCalledWith('source.record-reedit.submit', expect.objectContaining({
      sourceRef: source.sourceRef, itemUid: item.itemUid, newText: '凭据刷新后继续输入',
    }))
    expect(renderer!.root.findAllByProps({ 'aria-label': '保存重新编辑' })).toHaveLength(0)
  })

  it.each([
    { context: 'source', outcome: 'accepted' }, { context: 'record', outcome: 'accepted' },
    { context: 'source', outcome: 'failed' }, { context: 'record', outcome: 'failed' },
  ])('settles a late $outcome submission only for its candidate while another $context is edited', async ({ context, outcome }) => {
    const submitting = deferred<unknown>()
    const base = mocks.callArkme.getMockImplementation()!
    mocks.callArkme.mockImplementation(async (operation, params) => operation === 'source.record-reedit.submit'
      ? submitting.promise : base(operation, params))
    arkmeComposerDraftStore.setText(normalKey, '普通发送草稿')
    await mount(); await open()
    act(() => composer().props.onTextChange('A 已请求提交'))
    await act(async () => { renderer!.root.findByProps({ 'aria-label': '保存重新编辑' }).props.onClick(); await flush() })
    if (context === 'source') await act(async () => { arkmeUi.selectSource(other); await flush() })
    await open(context === 'source' ? 0 : 1)
    act(() => composer().props.onTextChange('B 正在继续输入'))
    await act(async () => {
      if (outcome === 'accepted') submitting.resolve({ submissionId: 'late-A', state: 'pending', itemUid: item.itemUid,
        title: '', textContent: 'A 已请求提交', attachments: [] })
      else submitting.reject(new Error('A 提交失败'))
      await flush()
    })
    expect(composer().props.value).toBe('B 正在继续输入')
    expect(renderer!.root.findByProps({ 'aria-label': '保存重新编辑' }).props.disabled).toBe(false)
    if (context === 'source') await act(async () => { arkmeUi.selectSource(source); await flush() })
    if (outcome === 'failed') {
      await open()
      expect(composer().props.value).toBe('A 已请求提交')
      expect(renderer!.root.findByProps({ role: 'alert' }).children).toContain('A 提交失败')
      expect(renderer!.root.findByProps({ 'aria-label': '保存重新编辑' }).props.disabled).toBe(false)
    } else if (context === 'source') {
      expect(composer().props.value).toBe('普通发送草稿')
      expect(renderer!.root.findAllByProps({ 'aria-label': '保存重新编辑' })).toHaveLength(0)
    }
  })

  it.each(['failed', 'committed'] as const)('uses three-second highlighting only for a confirmed edit: %s', async outcome => {
    vi.useFakeTimers()
    window.setTimeout = globalThis.setTimeout as typeof window.setTimeout
    window.clearTimeout = globalThis.clearTimeout as typeof window.clearTimeout
    let state: 'pending' | 'failed' | 'committed' = 'pending'
    const base = mocks.callArkme.getMockImplementation()!
    mocks.callArkme.mockImplementation(async (operation, params) => {
      if (operation === 'source.record-reedit.submissions') return [{ submissionId: 'highlight-test', itemUid: item.itemUid,
        state, baseVersion: 3, title: '', textContent: '提交候选', attachments: [],
        ...(state === 'committed' ? { result: { status: 'committed', itemUid: item.itemUid, version: 4, revisionUid: 'revision', projectionState: 'pending' } } : {}),
      }]
      return base(operation, params)
    })
    await mount()
    state = outcome
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
    expect(renderer!.root.findAllByProps({ 'data-arkme-highlight-backdrop': 'true' })).toHaveLength(outcome === 'committed' ? 1 : 0)
    if (outcome === 'failed') return
    await act(async () => { await vi.advanceTimersByTimeAsync(2999) })
    expect(renderer!.root.findAllByProps({ 'data-arkme-highlight-backdrop': 'true' })).toHaveLength(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(renderer!.root.findAllByProps({ 'data-arkme-highlight-backdrop': 'true' })).toHaveLength(0)
  })

  it('reactivates conflict recovery after returning to a source whose exit save failed', async () => {
    const base = mocks.callArkme.getMockImplementation()!
    mocks.callArkme.mockImplementation(async (operation: string, params?: Record<string, unknown>) => {
      if (operation === 'source.record-reedit.draft.put') throw new ArkmeClientError({ code: 'record-reedit-conflict', message: '快记已更新，草稿保留', retryable: false })
      return base(operation, params)
    })
    await mount(); await open()
    act(() => composer().props.onTextChange('冲突候选'))
    await act(async () => { arkmeUi.selectSource(other); await flush() })
    await act(async () => { arkmeUi.selectSource(source); await flush() })
    const detailCalls = mocks.callArkme.mock.calls.filter(([operation]) => operation === 'source.record-reedit.detail').length
    act(() => renderer!.root.findByProps({ 'aria-label': '放弃草稿并重新载入' }).props.onClick())
    await act(async () => { renderer!.root.findByType(ArkmeConfirmDialog).props.onConfirm(); await flush() })
    expect(mocks.callArkme.mock.calls.filter(([operation]) => operation === 'source.record-reedit.detail')).toHaveLength(detailCalls + 1)
    expect(composer().props.value).toBe('原正文')
    expect(renderer!.root.findAllByType(ArkmeConfirmDialog)).toHaveLength(0)
  })

  it('isolates an old pending stage from a resumed editor while accepting its new stage', async () => {
    const oldStage = deferred<unknown>()
    let stageCalls = 0
    stubStage(async () => ++stageCalls === 1 ? await oldStage.promise : { json: async () => ({ ok: true, value: local }) })
    const base = mocks.callArkme.getMockImplementation()!
    mocks.callArkme.mockImplementation(async (operation: string, params?: Record<string, unknown>) => {
      if (operation === 'source.record-reedit.draft.put') throw new Error('离线，草稿保存失败')
      return base(operation, params)
    })
    await mount(); await open()
    act(() => composer().props.onTextChange('切换前候选'))
    await pick()
    await act(async () => { arkmeUi.selectSource(other); await flush() })
    await act(async () => { arkmeUi.selectSource(source); await flush() })
    await pick()
    expect(stageCalls).toBe(2)
    expect(strip().props.attachments).toHaveLength(3)
    await act(async () => {
      oldStage.resolve({ json: async () => ({ ok: true, value: { ...local, fileRef: 'arkme-file-v1.00000000-0000-4000-8000-000000000002', fileName: '迟到旧文件.pdf' } }) })
      await flush()
    })
    expect(strip().props.attachments).toHaveLength(3)
    expect(strip().props.attachments[2].localFile).toEqual(local)
    expect(composer().props.value).toBe('切换前候选')
  })

  it('disables empty submissions unless a primary voice is retained', async () => {
    snapshot.textContent = ''; snapshot.attachments = []
    await mount(); await open()
    expect(renderer!.root.findByProps({ 'aria-label': '保存重新编辑' }).props.disabled).toBe(true)
    await act(async () => { renderer!.root.findByProps({ 'aria-label': '关闭重新编辑' }).props.onClick(); await flush() })
    snapshot.hasVoice = true
    await open()
    expect(renderer!.root.findByProps({ 'aria-label': '保存重新编辑' }).props.disabled).toBe(false)
  })
  it('keeps text editing and attachment removal available when adding attachments is unsupported', async () => {
    snapshot.displayKind = 1; snapshot.maxAttachments = 0
    const stage = vi.fn(async () => ({ json: async () => ({ ok: true, value: local }) }))
    stubStage(stage)
    await mount(); await open()
    expect(renderer!.root.findByProps({ 'aria-label': '添加内容' }).props.disabled).toBe(true)
    expect(composer().props.disabled).toBe(false)
    expect(strip().props.disabled).toBe(false)
    await pick()
    expect(stage).not.toHaveBeenCalled()
  })

  it('opens an authorized remote attachment in the existing media preview', async () => {
    await mount(); await open()
    vi.stubGlobal('document', { body: { style: { overflow: '' } }, addEventListener: vi.fn(), removeEventListener: vi.fn() })
    const preview = renderer!.root.findByProps({ 'aria-label': '预览 a.pdf' })
    expect(preview.props.disabled).toBe(false)
    await act(async () => { preview.props.onClick(); await flush() })
    expect(renderer!.root.findByType(ArkmeMediaPreview).props.selected).toEqual(existing('a').block)
  })

  it('keeps the authorized image thumbnail inside the existing attachment tile', async () => {
    snapshot.attachments = [{
      ...existing('photo'),
      asset: { ...existing('photo').asset, fileName: 'photo.png', mimeType: 'image/png', fileKind: 1 },
      block: { ...existing('photo').block, kind: 'image', fileName: 'photo.png', mimeType: 'image/png' },
    }] as unknown as typeof snapshot.attachments
    await mount(); await open()
    expect(strip().findAllByType('img').map(node => node.props.src)).toContain('/arkme-self/api/media?ref=media-photo')
  })

  it('saves a completely empty candidate on exit while keeping final submission disabled', async () => {
    await mount(); await open()
    act(() => composer().props.onTextChange(''))
    act(() => strip().props.onRemove(strip().props.attachments[0]))
    act(() => strip().props.onRemove(strip().props.attachments[0]))
    expect(renderer!.root.findByProps({ 'aria-label': '保存重新编辑' }).props.disabled).toBe(true)
    await act(async () => { renderer!.root.findByProps({ 'aria-label': '关闭重新编辑' }).props.onClick(); await flush() })
    expect(mocks.callArkme).toHaveBeenCalledWith('source.record-reedit.draft.put', expect.objectContaining({ newText: '', attachments: [], expectedDraftRevision: 0 }))
  })

  it('persists the candidate revision before commit and retains it for a failed-commit retry', async () => {
    const base = mocks.callArkme.getMockImplementation()!
    let failCommit = true
    mocks.callArkme.mockImplementation(async (operation: string, params?: Record<string, unknown>) => {
      if (operation === 'source.record-reedit.submit' && failCommit) throw new Error('上传失败，请重试')
      return base(operation, params)
    })
    await mount(); await open()
    act(() => strip().props.onRemove(strip().props.attachments[0]))
    await act(async () => { renderer!.root.findByProps({ 'aria-label': '保存重新编辑' }).props.onClick(); await flush() })
    expect(mocks.callArkme.mock.calls.filter(([operation]) => ['source.record-reedit.draft.put', 'source.record-reedit.submit'].includes(operation)).map(([operation, params]) => [operation, params.expectedDraftRevision])).toEqual([
      ['source.record-reedit.draft.put', 0], ['source.record-reedit.submit', 1],
    ])
    expect(strip().props.attachments).toHaveLength(1)
    expect(renderer!.root.findByProps({ role: 'alert' }).children).toContain('上传失败，请重试')
    failCommit = false
    await act(async () => { renderer!.root.findByProps({ 'aria-label': '保存重新编辑' }).props.onClick(); await flush() })
    expect(mocks.callArkme.mock.calls.filter(([operation]) => operation === 'source.record-reedit.submit').map(([, params]) => params.expectedDraftRevision)).toEqual([1, 1])
    expect(renderer!.root.findAllByProps({ 'data-arkme-composer-reedit-target': 'true' })).toHaveLength(0)
  })

  it('obtains a known draft revision even when submitting an unchanged original record', async () => {
    await mount(); await open()
    await act(async () => { renderer!.root.findByProps({ 'aria-label': '保存重新编辑' }).props.onClick(); await flush() })
    expect(mocks.callArkme.mock.calls.filter(([operation]) => ['source.record-reedit.draft.put', 'source.record-reedit.submit'].includes(operation)).map(([operation, params]) => [operation, params.expectedDraftRevision])).toEqual([
      ['source.record-reedit.draft.put', 0], ['source.record-reedit.submit', 1],
    ])
  })

  it('serializes autosaves and carries the returned revision into the next candidate', async () => {
    vi.useFakeTimers()
    const firstSave = deferred<{ saved: true; draftRevision: number }>()
    const base = mocks.callArkme.getMockImplementation()!
    let saves = 0
    mocks.callArkme.mockImplementation(async (operation: string, params?: Record<string, unknown>) => {
      if (operation === 'source.record-reedit.draft.put' && saves++ === 0) return await firstSave.promise
      return base(operation, params)
    })
    await mount(); await open()
    act(() => strip().props.onMove(0, 1))
    await act(async () => { vi.advanceTimersByTime(10_000); await flush() })
    act(() => composer().props.onTextChange('第二份候选'))
    await act(async () => { vi.advanceTimersByTime(10_000); await flush() })
    expect(mocks.callArkme.mock.calls.filter(([operation]) => operation === 'source.record-reedit.draft.put')).toHaveLength(1)
    await act(async () => { firstSave.resolve({ saved: true, draftRevision: 5 }); await flush() })
    expect(mocks.callArkme.mock.calls.filter(([operation]) => operation === 'source.record-reedit.draft.put').map(([, params]) => params.expectedDraftRevision)).toEqual([0, 5])
  })

  it('does not lose a candidate reverted to the original while an older save is queued', async () => {
    vi.useFakeTimers()
    const firstSave = deferred<{ saved: true; draftRevision: number }>()
    const base = mocks.callArkme.getMockImplementation()!
    let saves = 0
    mocks.callArkme.mockImplementation(async (operation: string, params?: Record<string, unknown>) => {
      if (operation === 'source.record-reedit.draft.put' && saves++ === 0) return await firstSave.promise
      return base(operation, params)
    })
    await mount(); await open()
    act(() => composer().props.onTextChange('排队中的旧候选'))
    await act(async () => { vi.advanceTimersByTime(10_000); await flush() })
    act(() => composer().props.onTextChange('原正文'))
    act(() => { renderer!.root.findByProps({ 'aria-label': '关闭重新编辑' }).props.onClick() })
    await act(async () => { firstSave.resolve({ saved: true, draftRevision: 1 }); await flush() })
    expect(mocks.callArkme.mock.calls.filter(([operation]) => operation === 'source.record-reedit.draft.put').map(([, params]) => [params.newText, params.expectedDraftRevision])).toEqual([
      ['排队中的旧候选', 0], ['原正文', 1],
    ])
  })

  it('confirms before discarding a version-conflicted draft and reloads owner attachments', async () => {
    snapshot.draft = { title: '', textContent: '冲突草稿', attachments: [existing('b')], baseVersion: 2, draftRevision: 7, updatedAtMillis: 2 }
    const base = mocks.callArkme.getMockImplementation()!
    mocks.callArkme.mockImplementation(async (operation: string, params?: Record<string, unknown>) => {
      if (operation === 'source.record-reedit.draft.delete') { snapshot = baseline(); return { status: 'discarded', itemUid: item.itemUid } }
      return base(operation, params)
    })
    await mount(); await open()
    const reload = () => renderer!.root.findByProps({ 'aria-label': '放弃草稿并重新载入' })
    act(() => reload().props.onClick())
    expect(renderer!.root.findByType(ArkmeConfirmDialog).props.confirmLabel).toBe('放弃并重新载入')
    expect(mocks.callArkme.mock.calls.filter(([operation]) => operation === 'source.record-reedit.draft.delete')).toHaveLength(0)
    act(() => renderer!.root.findByType(ArkmeConfirmDialog).props.onClose())
    expect(composer().props.value).toBe('冲突草稿')
    act(() => reload().props.onClick())
    await act(async () => { renderer!.root.findByType(ArkmeConfirmDialog).props.onConfirm(); await flush() })
    expect(mocks.callArkme).toHaveBeenCalledWith('source.record-reedit.draft.delete', { sourceRef: source.sourceRef, itemUid: item.itemUid, expectedDraftRevision: 7 })
    expect(composer().props.value).toBe('原正文')
    expect(strip().props.attachments.map((attachment: ReturnType<typeof existing>) => attachment.asset.fileAssetUid)).toEqual(['a', 'b'])
  })

  it('reloads another consumer changed draft without deleting the newly observed candidate', async () => {
    snapshot.draft = { title: '', textContent: '原候选', attachments: [existing('b')], baseVersion: 2, draftRevision: 7, updatedAtMillis: 2 }
    await mount(); await open()
    act(() => renderer!.root.findByProps({ 'aria-label': '放弃草稿并重新载入' }).props.onClick())
    snapshot.draft = { ...snapshot.draft, textContent: '其他入口新候选', draftRevision: 8 }
    await act(async () => { renderer!.root.findByType(ArkmeConfirmDialog).props.onConfirm(); await flush() })
    expect(mocks.callArkme.mock.calls.filter(([operation]) => operation === 'source.record-reedit.draft.delete')).toHaveLength(0)
    expect(composer().props.value).toBe('其他入口新候选')
    expect(renderer!.root.findAllByType(ArkmeConfirmDialog)).toHaveLength(0)
  })

  it('offers a non-destructive reload when the draft revision has changed', async () => {
    const base = mocks.callArkme.getMockImplementation()!
    mocks.callArkme.mockImplementation(async (operation: string, params?: Record<string, unknown>) => {
      if (operation === 'source.record-reedit.submit') throw new ArkmeClientError({ code: 'record-reedit-draft-changed', message: '其他入口已更新草稿', retryable: false })
      return base(operation, params)
    })
    await mount(); await open()
    await act(async () => { renderer!.root.findByProps({ 'aria-label': '保存重新编辑' }).props.onClick(); await flush() })
    expect(renderer!.root.findAllByProps({ 'aria-label': '放弃草稿并重新载入' })).toHaveLength(0)
    act(() => renderer!.root.findByProps({ 'aria-label': '重新载入草稿' }).props.onClick())
    snapshot.draft = { title: '', textContent: '最新草稿', attachments: [], baseVersion: 3, draftRevision: 8, updatedAtMillis: 2 }
    await act(async () => { renderer!.root.findByType(ArkmeConfirmDialog).props.onConfirm(); await flush() })
    expect(composer().props.value).toBe('最新草稿')
    expect(mocks.callArkme.mock.calls.filter(([operation]) => operation === 'source.record-reedit.draft.delete')).toHaveLength(0)
  })
})
