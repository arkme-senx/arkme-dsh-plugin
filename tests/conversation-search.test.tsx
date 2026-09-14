import { useState } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArkmeConversationSearchPanel } from '../src/client/ArkmeConversationSearch.js'
import type { ArkmeRecordSearchResult, ArkmeSearchSceneKind, ArkmeSourceItem } from '../src/types.js'

const mocks = vi.hoisted(() => ({ callArkme: vi.fn(), locate: vi.fn(), preview: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.callArkme, ArkmeClientError: class extends Error {} }))
vi.mock('../src/client/ui-controller.js', () => ({ arkmeUi: { showConversationTarget: mocks.locate } }))
vi.mock('../src/client/ArkmeRichContent.js', async importOriginal => ({
  arkmeContentMediaUrl: (await importOriginal<typeof import('../src/client/ArkmeRichContent.js')>()).arkmeContentMediaUrl,
  ArkmeMessageContent: ({ item }: { item: { textContent: string } }) => <div>{item.textContent}</div>,
  ArkmeMediaPreview: ({ selected, navigation, onClose }: { selected: { fileAssetUid: string }; navigation?: { next?: () => void }; onClose(): void }) => { mocks.preview(selected.fileAssetUid); return <><div aria-label="媒体预览">{selected.fileAssetUid}</div><button onClick={navigation?.next}>下一附件</button><button onClick={onClose}>关闭预览</button></> },
}))

const source: ArkmeSourceItem = { sourceRef: 'signed-group', kind: 'group_chat', displayName: '项目群', activeAtMillis: 1, unreadCount: 0 }
const result = (id = 'one', nextCursor?: string): ArkmeRecordSearchResult => ({
  items: [{ recordUid: id, recordOwnerUserId: 42, sourceKind: 3, sourceUid: 'session', routeTargetKind: 'chat_timeline', sendAtMillis: 1,
    title: id, textContent: `正文 ${id}`, snippet: `摘要 ${id}`, media: [], files: [], targetSource: source }],
  sourceAggregates: [], hasMore: nextCursor !== undefined, ...(nextCursor === undefined ? {} : { nextCursor }), queryGuard: { state: 'complete' },
})
let root: ReactTestRenderer
function Harness({ target = source, close = () => {} }: { target?: ArkmeSourceItem; close?: () => void }) {
  const [scene, setScene] = useState<ArkmeSearchSceneKind>('image_video')
  const [global, setGlobal] = useState(false)
  return <ArkmeConversationSearchPanel source={target} scene={scene} global={global} onScene={setScene} onGlobal={setGlobal} onClose={close} />
}
async function mount(target = source) { await act(async () => { root = create(<Harness target={target} />) }); await tick(0) }
async function tick(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }
function input() { return root.root.findByProps({ 'aria-label': '搜索聊天关键词' }) }
async function type(text: string) { await act(async () => input().props.onChange({ target: { value: text } })) }
async function click(text: string) {
  const node = root.root.findAllByType('button').find(button => button.props.children === text)
  expect(node, text).toBeDefined()
  await act(async () => node!.props.onClick())
}
beforeEach(() => {
  vi.useFakeTimers(); mocks.callArkme.mockReset(); mocks.locate.mockReset()
  mocks.callArkme.mockImplementation(async (operation: string) => {
    if (operation === 'source.timeline-around') return { items: [{ itemUid: 'one', senderName: '小林', sendAtMillis: 1, textContent: '完整正文' }] }
    if (operation === 'files.assets') return []
    return result()
  })
})
afterEach(async () => { if (root) await act(async () => root.unmount()); vi.useRealTimers() })

describe('conversation search parity', () => {
  it.each(['image', 'video', 'file'])('previews %s without rendering the original message or hiding results', async kind => {
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'source.timeline-around') return { items: [{ itemUid: 'one', senderName: '小林', sendAtMillis: 1, textContent: '完整正文', contentBlocks: [{ kind, fileAssetUid: 'asset', mediaRef: 'signed', fileName: '附件' }] }] }
      const assets = [{ fileAssetUid: 'asset', fileName: '附件', fileKind: kind === 'video' ? 3 : 1 }]
      return { ...result(), items: [{ ...result().items[0], media: kind === 'file' ? [] : assets, files: kind === 'file' ? assets : [] }] }
    })
    await mount()
    if (kind === 'file') { await click('文件'); await tick(0) }
    const label = kind === 'file' ? '打开文件 附件' : kind === 'video' ? '查看视频 附件' : '查看图片 附件'
    await act(async () => root.root.findByProps({ 'aria-label': label }).props.onClick())
    expect(root.root.findByProps({ 'aria-label': '媒体预览' })).toBeDefined()
    expect(root.root.findByProps({ 'aria-label': '聊天搜索结果' }).props.hidden).toBe(false)
    expect(JSON.stringify(root.toJSON())).not.toContain('完整正文')
    expect(root.root.findAllByType('button').some(node => ['返回结果', '定位到消息'].includes(node.props.children))).toBe(false)
    await click('关闭预览')
    expect(root.root.findAllByProps({ 'aria-label': '媒体预览' })).toHaveLength(0)
  })

  it('keeps results accessible through attachment loading, failure, retry and missing attachment', async () => {
    mocks.callArkme.mockImplementation(async () => ({ ...result(), items: [{ ...result().items[0], files: [{ fileAssetUid: 'asset', fileName: '附件' }] }] }))
    await mount(); await click('文件'); await tick(0)
    mocks.callArkme.mockImplementationOnce(() => new Promise(() => {}))
    await act(async () => root.root.findByProps({ 'aria-label': '打开文件 附件' }).props.onClick())
    expect(JSON.stringify(root.toJSON())).toContain('加载详情')
    expect(root.root.findByProps({ 'aria-label': '聊天搜索结果' }).props.hidden).toBe(false)
    await tick(15_000)
    expect(JSON.stringify(root.toJSON())).toContain('详情加载超时')
    mocks.callArkme.mockResolvedValueOnce({ items: [{ itemUid: 'one', textContent: '完整正文', contentBlocks: [] }] })
    await click('重试')
    expect(JSON.stringify(root.toJSON())).toContain('该附件已不存在')
    expect(JSON.stringify(root.toJSON())).not.toContain('完整正文')
    await click('返回结果')
    expect(JSON.stringify(root.toJSON())).not.toContain('该附件已不存在')
    expect(root.root.findByProps({ 'aria-label': '聊天搜索结果' }).props.hidden).toBe(false)
  })

  it('uses the authorized media kind when search metadata is stale', async () => {
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'source.timeline-around') return { items: [{ itemUid: 'one', contentBlocks: [{ kind: 'image', mediaRef: 'signed-image', fileAssetUid: 'asset', fileName: '图片' }] }] }
      return { ...result(), items: [{ ...result().items[0], media: [{ fileAssetUid: 'asset', mimeType: 'video/mp4', fileKind: 3 }] }] }
    })
    await mount()
    expect(root.root.findAllByType('video')).toHaveLength(0)
    expect(root.root.findByProps({ 'aria-label': '查看图片 图片' })).toBeDefined()
  })
  it('never renders the previous asset while switching within the same message', async () => {
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'source.timeline-around') return { items: [{ itemUid: 'one', contentBlocks: ['a', 'b'].map(id => ({ kind: 'image', mediaRef: id, fileAssetUid: id, fileName: id })) }] }
      return { ...result(), items: [{ ...result().items[0], media: ['a', 'b'].map(id => ({ fileAssetUid: id, fileName: id })) }] }
    })
    await mount()
    await act(async () => root.root.findByProps({ 'aria-label': '查看图片 a' }).props.onClick())
    mocks.preview.mockClear()
    await click('下一附件')
    expect(mocks.preview.mock.calls.every(([uid]) => uid === 'b')).toBe(true)
  })

  it('navigates files across records by owner and returns directly to retained results', async () => {
    mocks.callArkme.mockImplementation(async (operation: string, params: Record<string, unknown>) => {
      if (operation === 'source.timeline-around') return { items: [{ itemUid: params.itemUid, senderName: '小林', sendAtMillis: 1, contentBlocks: [{ kind: 'file', fileAssetUid: 'shared', mediaRef: 'signed-file', fileName: '文件.pdf' }] }] }
      return { ...result(), items: [42, 77].map(owner => ({ ...result().items[0], recordOwnerUserId: owner, files: [{ fileAssetUid: 'shared', fileName: '文件.pdf' }, { fileAssetUid: 'shared', fileName: '文件.pdf' }] })) }
    })
    await mount(); await click('文件'); await tick(0)
    const rows = root.root.findAllByProps({ 'aria-label': '打开文件 文件.pdf' })
    expect(rows).toHaveLength(2)
    await act(async () => rows[0]!.props.onClick())
    await click('下一附件')
    expect(mocks.callArkme.mock.calls.filter(([op]) => op === 'source.timeline-around').map(([, params]) => params.recordOwnerUserId)).toEqual([42, 77])
    await click('关闭预览')
    expect(root.root.findByProps({ 'aria-label': '聊天搜索结果' }).props.hidden).toBe(false)
  })

  it('opens the clicked media asset directly after resolving the exact record', async () => {
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'files.assets') return [{ fileAssetUid: 'photo-2', previewUrl: 'https://example.com/photo.png', mimeType: 'image/png' }]
      if (operation === 'source.timeline-around') return { items: [{ itemUid: 'one', senderName: '小林', sendAtMillis: 1, textContent: '完整正文', contentBlocks: [
        { kind: 'image', fileAssetUid: 'photo-1', mediaRef: 'first' }, { kind: 'image', fileAssetUid: 'photo-2', mediaRef: 'second', fileName: '第二张图片' },
      ] }] }
      return { ...result(), items: [{ ...result().items[0], media: [{ fileAssetUid: 'photo-2', fileName: '第二张图片', mimeType: 'image/png' }] }] }
    })
    await mount()
    await act(async () => root.root.findByProps({ 'aria-label': '查看图片 第二张图片' }).props.onClick())
    expect(root.root.findByProps({ 'aria-label': '媒体预览' }).props.children).toBe('photo-2')
    expect(mocks.callArkme.mock.calls.some(([operation]) => operation === 'files.assets')).toBe(false)
  })

  it('defers chat media until visible and cancels its read on unmount', async () => {
    let visible!: IntersectionObserverCallback
    const disconnect = vi.fn()
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: IntersectionObserverCallback) { visible = callback }
      observe() {}
      disconnect = disconnect
    })
    try {
      mocks.callArkme.mockImplementation(async (operation: string) => {
        if (operation === 'source.timeline-around') return new Promise(() => {})
        return { ...result(), items: [{ ...result().items[0], media: [{ fileAssetUid: 'shared-photo' }] }] }
      })
      await act(async () => { root = create(<Harness />, { createNodeMock: () => ({ focus() {} }) }) }); await tick(0)
      expect(mocks.callArkme.mock.calls.some(([operation]) => operation === 'source.timeline-around')).toBe(false)
      await act(async () => visible([{ isIntersecting: true }] as IntersectionObserverEntry[], {} as IntersectionObserver))
      const reads = mocks.callArkme.mock.calls.filter(([operation]) => operation === 'source.timeline-around')
      expect(reads).toHaveLength(1)
      expect(reads[0]![1]).toMatchObject({ recordOwnerUserId: 42, sourceRef: 'signed-group' })
      await act(async () => root.unmount())
      expect((reads[0]![2] as AbortSignal).aborted).toBe(true)
      expect(disconnect).toHaveBeenCalled()
    } finally { vi.unstubAllGlobals() }
  })

  it('shows search results even while thumbnails are unavailable', async () => {
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'files.assets') throw new Error('缩略图服务离线')
      return { ...result(), items: [{ ...result().items[0], sourceKind: 2, media: [{ fileAssetUid: 'photo', fileName: '照片' }] }] }
    })
    await mount()
    expect(root.root.findByProps({ 'aria-label': '查看图片 照片' })).toBeDefined()
    expect(root.root.findAllByProps({ role: 'alert' })).toHaveLength(0)
    await type('正文'); await tick(300)
    expect(mocks.callArkme.mock.calls.filter(([op]) => op === 'files.assets')).toHaveLength(1)
    expect(JSON.stringify(root.toJSON())).toContain('one')
  })

  it('renders the first thumbnail batch while the next stalls and keeps it after timeout', async () => {
    let finish!: (value: unknown) => void
    mocks.callArkme.mockImplementation(async (operation: string, params: { fileAssetUids?: string[] }) => {
      if (operation === 'files.assets') {
        if (params.fileAssetUids?.[0] === '0') return [{ fileAssetUid: '0', previewUrl: 'https://cdn.test/first.png' }]
        return await new Promise(resolve => { finish = resolve })
      }
      return { ...result(), items: [{ ...result().items[0], sourceKind: 2,
        media: Array.from({ length: 51 }, (_, index) => ({ fileAssetUid: String(index), fileName: String(index) })) }] }
    })
    await mount()
    expect(root.root.findAllByType('img').map(image => image.props.src)).toEqual(['https://cdn.test/first.png'])
    await tick(15_000)
    await act(async () => finish([{ fileAssetUid: '50', previewUrl: 'https://cdn.test/late.png' }]))
    expect(root.root.findAllByType('img').map(image => image.props.src)).toEqual(['https://cdn.test/first.png'])
    expect(root.root.findAllByProps({ role: 'alert' })).toHaveLength(0)
  })

  it('uses canonical video kind 3 when MIME is absent', async () => {
    mocks.callArkme.mockImplementation(async (operation: string) => operation === 'files.assets' ? [] : {
      ...result(), items: [{ ...result().items[0], sourceKind: 2, media: [{ fileAssetUid: 'video', fileKind: 3, fileName: '片段' }] }],
    })
    await mount()
    expect(root.root.findByProps({ 'aria-label': '查看视频 片段' })).toBeDefined()
  })

  it('times out a stalled request and ignores its late response after retry', async () => {
    let finish!: (value: ArkmeRecordSearchResult) => void
    mocks.callArkme.mockImplementationOnce(() => new Promise<ArkmeRecordSearchResult>(resolve => { finish = resolve }))
    await mount(); await tick(15_000)
    expect(JSON.stringify(root.toJSON())).toContain('搜索超时')
    await click('重试')
    await act(async () => finish(result('过期消息')))
    expect(JSON.stringify(root.toJSON())).not.toContain('过期消息')
    expect(root.root.findAllByProps({ role: 'alert' })).toHaveLength(0)
  })

  it('does not restart an in-flight request on repeated Enter', async () => {
    await mount(); await type('正文')
    mocks.callArkme.mockImplementationOnce(() => new Promise(() => {}))
    const enter = () => input().props.onKeyDown({ key: 'Enter', nativeEvent: { isComposing: false }, preventDefault() {}, stopPropagation() {} })
    await act(async () => { enter(); enter() })
    await tick(500)
    expect(mocks.callArkme.mock.calls.filter(([op]) => op === 'search.records')).toHaveLength(1)
  })

  it('keeps the new debounce loading state when the old request settles', async () => {
    let finish!: (value: ArkmeRecordSearchResult) => void
    mocks.callArkme.mockImplementationOnce(() => new Promise<ArkmeRecordSearchResult>(resolve => { finish = resolve }))
    await mount(); await type('新词')
    await act(async () => finish(result('旧词')))
    expect(JSON.stringify(root.toJSON())).toContain('加载中')
    expect(JSON.stringify(root.toJSON())).not.toContain('旧词')
    await tick(300)
  })

  it('never locates a hit with missing record ownership', async () => {
    mocks.callArkme.mockResolvedValue({ ...result(), items: result().items.map(({ recordOwnerUserId: _, ...item }) => item) })
    await mount(); await click('查看媒体消息')
    expect(JSON.stringify(root.toJSON())).toContain('缺少消息归属')
    expect(root.root.findAllByType('button').find(node => node.props.children === '定位到消息')?.props.disabled).toBe(true)
    expect(mocks.callArkme.mock.calls.some(([op]) => op === 'source.timeline-around' || op === 'source.timeline')).toBe(false)
  })

  it('offers retry when detail stalls without trapping the results panel', async () => {
    await mount()
    mocks.callArkme.mockImplementationOnce(() => new Promise(() => {}))
    await click('查看媒体消息'); await tick(15_000)
    expect(JSON.stringify(root.toJSON())).toContain('详情加载超时')
    await click('返回结果')
    expect(root.root.findByProps({ 'aria-label': '聊天搜索结果' })).toBeDefined()
  })

  it('submits on Enter without repeating the scheduled query', async () => {
    await mount(); mocks.callArkme.mockClear()
    await type('复盘')
    await act(async () => input().props.onKeyDown({ key: 'Enter', nativeEvent: { isComposing: false }, preventDefault() {}, stopPropagation() {} }))
    await tick(500)
    expect(mocks.callArkme).toHaveBeenCalledTimes(1)
  })
  it('starts scoped and forwards each scene without changing the conversation', async () => {
    await mount()
    expect(mocks.callArkme).toHaveBeenLastCalledWith('search.scene', { scene: 'image_video', limit: 30, sourceRef: 'signed-group' }, expect.any(AbortSignal))
    for (const [label, scene] of [['语音', 'audio'], ['外部链接', 'link'], ['文件', 'file'], ['长文', 'long_article']]) {
      await click(label!); await tick(0)
      expect(mocks.callArkme).toHaveBeenLastCalledWith('search.scene', { scene, limit: 30, sourceRef: 'signed-group' }, expect.any(AbortSignal))
    }
    expect(mocks.locate).not.toHaveBeenCalled()
    await click('全局'); await tick(0)
    expect(mocks.callArkme).toHaveBeenLastCalledWith('search.scene', { scene: 'long_article', limit: 30 }, expect.any(AbortSignal))
    await click('当前范围'); await tick(0)
    expect(mocks.callArkme).toHaveBeenLastCalledWith('search.scene', { scene: 'long_article', limit: 30, sourceRef: 'signed-group' }, expect.any(AbortSignal))
  })

  it('waits for IME composition and debounce, then restores scenes when cleared', async () => {
    await mount(); mocks.callArkme.mockClear()
    await act(async () => input().props.onCompositionStart())
    await type('fu'); await tick(500)
    expect(mocks.callArkme).not.toHaveBeenCalled()
    await act(async () => input().props.onCompositionEnd({ currentTarget: { value: '复盘' } }))
    await tick(299); expect(mocks.callArkme).not.toHaveBeenCalled()
    await tick(1)
    expect(mocks.callArkme).toHaveBeenLastCalledWith('search.records', { query: '复盘', limit: 50, sourceRef: 'signed-group' }, expect.any(AbortSignal))
    expect(root.root.findAllByProps({ role: 'tablist' })).toHaveLength(0)
    await act(async () => root.root.findByProps({ 'aria-label': '清空搜索' }).props.onClick()); await tick(0)
    expect(mocks.callArkme).toHaveBeenLastCalledWith('search.scene', { scene: 'image_video', limit: 30, sourceRef: 'signed-group' }, expect.any(AbortSignal))
  })

  it('keeps earlier pages and retries the same failed cursor without duplicate hits', async () => {
    mocks.callArkme.mockResolvedValueOnce(result('one', 'cursor-2')).mockRejectedValueOnce(new Error('断网')).mockResolvedValueOnce({ ...result('two'), items: [...result('one').items, ...result('two').items] })
    await mount(); await click('加载更多')
    expect(JSON.stringify(root.toJSON())).toContain('断网')
    await click('重试')
    expect(mocks.callArkme).toHaveBeenLastCalledWith('search.scene', { scene: 'image_video', sourceRef: 'signed-group', limit: 30, cursor: 'cursor-2' }, expect.any(AbortSignal))
    expect(root.root.findAllByType('button').filter(node => node.props.children === '查看媒体消息')).toHaveLength(2)
  })

  it('discards late results when changing conversation and aborts on close', async () => {
    let resolve!: (value: ArkmeRecordSearchResult) => void
    mocks.callArkme.mockImplementationOnce(() => new Promise<ArkmeRecordSearchResult>(done => { resolve = done }))
    await mount()
    const oldSignal = mocks.callArkme.mock.calls[0]![2] as AbortSignal
    await act(async () => root.update(<Harness target={{ ...source, sourceRef: 'signed-private', kind: 'private_chat' }} />)); await tick(0)
    expect(oldSignal.aborted).toBe(true)
    await act(async () => resolve(result('old-message')))
    expect(JSON.stringify(root.toJSON())).not.toContain('old-message')
    const currentSignal = mocks.callArkme.mock.calls.at(-1)![2] as AbortSignal
    await act(async () => root.unmount())
    expect(currentSignal.aborted).toBe(true)
  })

  it('retains the paginated result container across detail and back', async () => {
    mocks.callArkme.mockResolvedValueOnce(result('one', 'page-2')).mockResolvedValueOnce(result('two'))
    await mount(); await click('加载更多')
    const container = root.root.findByProps({ 'aria-label': '聊天搜索结果' })
    const calls = mocks.callArkme.mock.calls.filter(([op]) => op === 'search.scene').length
    await act(async () => root.root.findAllByType('button').find(node => node.props.children === '查看媒体消息')!.props.onClick())
    expect(root.root.findByProps({ 'aria-label': '聊天搜索结果' })).toBe(container)
    expect(container.props.hidden).toBe(true)
    await click('返回结果')
    expect(container.props.hidden).toBe(false)
    expect(root.root.findAllByType('button').filter(node => node.props.children === '查看媒体消息')).toHaveLength(2)
    expect(mocks.callArkme.mock.calls.filter(([op]) => op === 'search.scene')).toHaveLength(calls)
  })

  it('leaves Escape to a portaled modal instead of closing the search', async () => {
    await mount()
    vi.stubGlobal('document', { querySelector: () => ({}) })
    try {
      const stopPropagation = vi.fn()
      await act(async () => root.root.findByProps({ 'aria-label': '聊天记录搜索' }).props.onKeyDown({ key: 'Escape', nativeEvent: { isComposing: false }, stopPropagation }))
      expect(stopPropagation).not.toHaveBeenCalled()
    } finally { vi.unstubAllGlobals() }
  })

  it('pauses unfinished gallery reads during detail and retains completed thumbnails on return', async () => {
    const pendingSignals: AbortSignal[] = []
    mocks.callArkme.mockImplementation(async (operation: string, params: Record<string, unknown>, signal: AbortSignal) => {
      if (operation === 'source.timeline-around') {
        if (params.itemUid === 'two') { pendingSignals.push(signal); return new Promise(() => {}) }
        return { items: [{ itemUid: 'one', senderName: '小林', textContent: '完整正文', sendAtMillis: 1, contentBlocks: [] }] }
      }
      return { ...result(), items: ['one', 'two'].map(id => ({ ...result(id).items[0], media: [{ fileAssetUid: id }] })) }
    })
    await mount()
    await act(async () => root.root.findAllByType('button').find(node => node.props['aria-label'] === '查看图片 ')!.props.onClick())
    expect(pendingSignals[0]!.aborted).toBe(true)
    expect(JSON.stringify(root.toJSON())).toContain('该附件已不存在或暂不可访问')
    await click('返回结果')
    expect(mocks.callArkme.mock.calls.filter(([op, params]) => op === 'source.timeline-around' && params.itemUid === 'one')).toHaveLength(2)
  })

  it('keeps owner-distinct records when record IDs match across pages', async () => {
    mocks.callArkme.mockResolvedValueOnce(result('one', 'next')).mockResolvedValueOnce({ ...result(), items: [{ ...result().items[0], recordOwnerUserId: 77 }] })
    await mount(); await click('加载更多')
    expect(root.root.findAllByType('button').filter(node => node.props.children === '查看媒体消息')).toHaveLength(2)
  })

  it('rejects a repeating cursor without losing the successful first page', async () => {
    mocks.callArkme.mockResolvedValueOnce(result('one', 'next')).mockResolvedValueOnce(result('two', 'next'))
    await mount(); await click('加载更多')
    expect(JSON.stringify(root.toJSON())).toContain('搜索分页暂不可继续')
    expect(root.root.findAllByType('button').filter(node => node.props.children === '查看媒体消息')).toHaveLength(1)
  })

  it('shows incomplete-query guidance separately from empty results', async () => {
    mocks.callArkme.mockResolvedValue({ ...result(), items: [], queryGuard: { state: 'refine_required', reason: 'capacity' } })
    await mount()
    expect(JSON.stringify(root.toJSON())).toContain('缩小范围或调整关键词')
    expect(JSON.stringify(root.toJSON())).not.toContain('暂无搜索结果')
    expect(mocks.locate).not.toHaveBeenCalled()
  })

  it('loads the original record for detail before locating its target', async () => {
    await mount(); await type('复盘'); await tick(300)
    const hit = root.root.findAllByType('button').find(node => node.props.children?.some?.((child: { props?: { children?: string } }) => child?.props?.children === 'one'))
    expect(hit).toBeDefined()
    await act(async () => hit!.props.onClick())
    expect(mocks.callArkme).toHaveBeenLastCalledWith('source.timeline-around', { sourceRef: 'signed-group', itemUid: 'one', recordOwnerUserId: 42, beforeLimit: 1, afterLimit: 1 }, expect.any(AbortSignal))
    expect(JSON.stringify(root.toJSON())).toContain('完整正文')
    await click('定位到消息')
    expect(mocks.locate).toHaveBeenCalledWith(source, 'one', 1, 42)
  })
})
