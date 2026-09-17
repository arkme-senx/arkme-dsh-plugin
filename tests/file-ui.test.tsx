import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ArkmeFileActions, ArkmeFileViewer, arkmeClipboardImageBlob, useArkmeOriginal } from '../src/client/ArkmeFileViewer.js'
import type { ReactNode } from 'react'
import { ArkmeSdk } from '../src/sdk/index.js'
import { ArkmeFileQuickView } from '../src/client/ArkmeFileQuickView.js'
import { ArkmeFileCard } from '../src/client/ArkmeRichContent.js'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'

const api = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: api.call }))
vi.mock('react-dom', async importOriginal => ({ ...await importOriginal<typeof import('react-dom')>(), createPortal: (children: ReactNode) => children }))
const block = { kind: 'file' as const, mediaRef: '', fileName: 'a.pdf', mimeType: 'application/pdf', size: 3, sortOrder: 0 }
const original = { localRef: 'arkme-file-v1.00000000-0000-4000-8000-000000000001', reception: { state: 'ready' as const, receivedBytes: 3, totalBytes: 3 }, receive: vi.fn() }
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks(); vi.clearAllMocks() })

describe('file save UI', () => {
  it('keeps absent resources idle and cancels reception when the resource disappears', async () => {
    let signal: AbortSignal | undefined
    const receive = vi.spyOn(ArkmeSdk.prototype, 'receiveFile').mockImplementation(async (_ref, _start, incomingSignal) => {
      signal = incomingSignal
      return { state: 'missing', receivedBytes: 0, totalBytes: 3 }
    })
    let current!: ReturnType<typeof useArkmeOriginal>
    function Probe({ present }: { present: boolean }) {
      current = useArkmeOriginal(present ? { ...block, originalRef: 'original' } : undefined)
      return null
    }
    let view!: ReactTestRenderer
    try {
      await act(async () => { view = create(<Probe present={false} />) })
      await act(async () => current.receive())
      expect(receive).not.toHaveBeenCalled()
      expect(current.localRef).toBeUndefined()
      await act(async () => view.update(<Probe present />))
      expect(receive).toHaveBeenCalledWith('original', false, expect.any(AbortSignal))
      await act(async () => current.receive())
      expect(receive).toHaveBeenLastCalledWith('original', true, expect.any(AbortSignal))
      const activeSignal = signal!
      await act(async () => view.update(<Probe present={false} />))
      expect(activeSignal.aborted).toBe(true)
      const count = receive.mock.calls.length
      await act(async () => current.receive())
      expect(receive).toHaveBeenCalledTimes(count)
      expect(current.localRef).toBeUndefined()
    } finally {
      await act(async () => view.unmount())
    }
  })

  it('uses cross-record file navigation without falling back to current-record selection', async () => {
    vi.stubGlobal('document', { body: {}, activeElement: null })
    const next = vi.fn(), select = vi.fn()
    let view!: ReactTestRenderer
    await act(async () => { view = create(<ArkmeFileViewer block={block} navigation={{ next }} onSelect={select} onClose={() => {}} />) })
    expect(view.root.findByProps({ 'aria-label': '上一个文件' }).props.disabled).toBe(true)
    const button = view.root.findByProps({ 'aria-label': '下一个文件' })
    expect(button.props.disabled).toBe(false)
    await act(async () => button.props.onClick())
    expect(next).toHaveBeenCalledOnce()
    expect(select).not.toHaveBeenCalled()
    await act(async () => view.unmount())
  })

  it('uses the client download icon before reception, and cancelling never starts a download', async () => {
    const receive = vi.spyOn(ArkmeSdk.prototype, 'receiveFile')
    vi.stubGlobal('window', { showSaveFilePicker: async () => { throw new DOMException('cancelled', 'AbortError') } })
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    let view!: ReactTestRenderer
    await act(async () => { view = create(<ArkmeFileActions block={{ ...block, originalRef: 'arkme-media-v1.original' }} original={{ reception: { state: 'missing', receivedBytes: 0, totalBytes: 3 }, localRef: undefined, receive: vi.fn() }} />) })
    expect(view.root.findByType('button').props['aria-label']).toBe('下载文件')
    expect(view.root.findAllByType('svg')).toHaveLength(1)
    expect(JSON.stringify(view.toJSON())).not.toContain('另存为')
    await act(async () => { view.root.findByType('button').props.onClick(); await Promise.resolve() })
    expect(receive).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled()
    expect(JSON.stringify(view.toJSON())).not.toContain('保存成功')
    await act(async () => view.unmount())
  })
  it('selects a save destination before receiving the original and writing it', async () => {
    const order: string[] = []
    vi.spyOn(ArkmeSdk.prototype, 'receiveFile').mockImplementation(async () => {
      order.push('receive')
      return { state: 'ready', receivedBytes: 3, totalBytes: 3, file: { fileRef: original.localRef, fileName: 'a.pdf', mimeType: 'application/pdf', size: 3, fileKind: 4 } }
    })
    const writable = { write: vi.fn(async () => { order.push('write') }), close: vi.fn(async () => { order.push('close') }), abort: vi.fn() }
    vi.stubGlobal('window', { showSaveFilePicker: async () => { order.push('picker'); return { createWritable: async () => writable } } })
    vi.stubGlobal('fetch', async () => { order.push('read original'); return new Response('abc') })
    let view!: ReactTestRenderer
    await act(async () => { view = create(<ArkmeFileActions block={{ ...block, originalRef: 'arkme-media-v1.original' }} original={{ reception: { state: 'missing', receivedBytes: 0, totalBytes: 3 }, localRef: undefined, receive: vi.fn() }} />) })
    await act(async () => { view.root.findByType('button').props.onClick(); await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(order).toEqual(['picker', 'receive', 'read original', 'write', 'close'])
    expect(JSON.stringify(view.toJSON())).toContain('保存成功')
    expect(view.root.findAllByType('button')).toHaveLength(0)
    await act(async () => view.unmount())
  })
  it('cancelling Save As does not fetch bytes or claim success', async () => {
    const picker = vi.fn(async () => { throw new DOMException('cancelled', 'AbortError') })
    const fetcher = vi.fn()
    vi.stubGlobal('window', { showSaveFilePicker: picker }); vi.stubGlobal('fetch', fetcher)
    let view!: ReactTestRenderer
    await act(async () => { view = create(<ArkmeFileActions block={block} original={original} />) })
    await act(async () => { view.root.findByType('button').props.onClick(); await Promise.resolve() })
    expect(picker).toHaveBeenCalledWith({ suggestedName: 'a.pdf' })
    expect(fetcher).not.toHaveBeenCalled()
    expect(JSON.stringify(view.toJSON())).not.toContain('保存成功')
    await act(async () => view.unmount())
  })
  it('reports only browser handoff when the native picker is unavailable', async () => {
    const anchor = { href: '', download: '', click: vi.fn(), remove: vi.fn() }
    vi.stubGlobal('window', {}); vi.stubGlobal('document', { createElement: () => anchor, body: { append: vi.fn() } })
    let view!: ReactTestRenderer
    await act(async () => { view = create(<ArkmeFileActions block={block} original={original} />) })
    await act(async () => { view.root.findByType('button').props.onClick(); await Promise.resolve() })
    expect(anchor.click).toHaveBeenCalledOnce()
    expect(anchor.href).toContain('/files/local?ref=')
    expect(anchor.href).toContain('download=1')
    expect(JSON.stringify(view.toJSON())).toContain('已交给浏览器下载')
    expect(JSON.stringify(view.toJSON())).not.toContain('保存成功')
    await act(async () => view.unmount())
  })
  it.each(['remote', 'preview', 'local', 'local-failed'] as const)('copies from explicit source %s', async mode => {
    const originalUnavailable = mode === 'preview' || mode === 'local-failed'
    const localRef = mode.startsWith('local') ? 'arkme-file-v1.11111111-1111-4111-8111-111111111111' : undefined
    const payloads: Array<Record<string, Promise<Blob>>> = []
    const notices: unknown[] = []
    class TestClipboardItem {
      constructor(readonly items: Record<string, Promise<Blob>>) {
        payloads.push(items)
      }
    }
    const write = vi.fn(async (items: TestClipboardItem[]) => { await items[0]!.items['image/png'] })
    vi.stubGlobal('createImageBitmap', async () => ({ width: 2, height: 2, close: vi.fn() }))
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => ({ drawImage: vi.fn() }), toBlob: (callback: (blob: Blob) => void) => callback(new Blob(['png'], { type: 'image/png' })) }) })
    const fetcher = vi.fn(async (url: string) => originalUnavailable && (url.includes('arkme-media-v1.original') || url.includes('/files/local?')) ? new Response('', { status: 404 }) : new Response('image-bytes', { headers: { 'Content-Type': 'image/jpeg' } }))
    vi.stubGlobal('ClipboardItem', TestClipboardItem)
    vi.stubGlobal('navigator', { clipboard: { write } })
    vi.stubGlobal('fetch', fetcher)
    const receive = vi.fn()
    const image = {
      kind: 'image' as const,
      mediaRef: 'image-ref',
      originalRef: 'arkme-media-v1.original',
      fileName: 'photo.png',
      mimeType: 'image/png',
      size: 11,
      sortOrder: 0,
    }
    let view!: ReactTestRenderer
    await act(async () => {
      view = create(<ArkmeFileActions
        block={image}
        original={{ reception: { state: 'missing', receivedBytes: 0, totalBytes: 11 }, localRef, receive }}
        copySourceUrl="/arkme-self/api/media?ref=image-ref"
        onImageCopyNotice={notice => { notices.push(notice) }}
      />)
    })

    const copy = view.root.findByProps({ 'aria-label': '复制图片' })
    expect(view.root.findByProps({ 'aria-label': '下载图片' })).toBeDefined()
    expect(JSON.stringify(view.toJSON())).toContain('M17.001 7.73273')
    await act(async () => { copy.props.onClick(); await new Promise(resolve => setTimeout(resolve, 0)) })

    if (mode !== 'local') expect(fetcher).toHaveBeenCalledWith('/arkme-self/api/media?ref=arkme-media-v1.original', { signal: expect.any(AbortSignal) })
    if (localRef) expect(fetcher).toHaveBeenNthCalledWith(1, `/arkme-self/api/files/local?ref=${localRef}`, { signal: expect.any(AbortSignal) })
    expect(fetcher).toHaveBeenCalledTimes(mode === 'local-failed' ? 3 : originalUnavailable ? 2 : 1)
    if (originalUnavailable) expect(fetcher).toHaveBeenLastCalledWith('/arkme-self/api/media?ref=image-ref', { signal: expect.any(AbortSignal) })
    expect(write).toHaveBeenCalledWith([expect.any(TestClipboardItem)])
    expect(payloads[0]).toHaveProperty('image/png')
    expect(receive).not.toHaveBeenCalled()
    expect(notices).toEqual([
      { message: '复制中...', kind: 'progress' },
      { message: '已复制', kind: 'success' },
    ])
    expect(JSON.stringify(view.toJSON())).not.toContain('已复制')
    expect(JSON.stringify(view.toJSON())).not.toContain('复制中')
    await act(async () => view.unmount())
  })
  it('cancels a pending copy on image change and permits the new copy without duplicate writes', async () => {
    const notices: unknown[] = []
    class Item { constructor(readonly items: Record<string, Promise<Blob>>) {} }
    const write = vi.fn(async (items: Item[]) => { await items[0]!.items['image/png'] })
    const fetcher = vi.fn((url: string, options: { signal: AbortSignal }) => {
      if (url === '/old') return new Promise<Response>((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')))
      })
      return Promise.resolve(new Response('jpeg'))
    })
    vi.stubGlobal('ClipboardItem', Item)
    vi.stubGlobal('navigator', { clipboard: { write } })
    vi.stubGlobal('fetch', fetcher)
    vi.stubGlobal('createImageBitmap', async () => ({ width: 2, height: 2, close: vi.fn() }))
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => ({ drawImage: vi.fn() }), toBlob: (callback: (blob: Blob) => void) => callback(new Blob(['png'], { type: 'image/png' })) }) })
    const render = (ref: string) => <ArkmeFileActions block={{ ...block, kind: 'image', mediaRef: ref }} original={{ reception: { state: 'missing', receivedBytes: 0, totalBytes: 3 }, localRef: undefined, receive: vi.fn() }} copySourceUrl={ref} onImageCopyNotice={notice => notices.push(notice)} />
    let view!: ReactTestRenderer
    try {
      await act(async () => { view = create(render('/old')) })
      await act(async () => {
        const button = view.root.findByProps({ 'aria-label': '复制图片' })
        button.props.onClick(); button.props.onClick()
      })
      expect(write).toHaveBeenCalledOnce()
      await act(async () => view.update(render('/new')))
      expect(view.root.findByProps({ 'aria-label': '复制图片' }).props.disabled).toBe(false)
      await act(async () => { view.root.findByProps({ 'aria-label': '复制图片' }).props.onClick(); await new Promise(resolve => setTimeout(resolve, 0)) })
      expect(write).toHaveBeenCalledTimes(2)
      expect(notices).toEqual([{ message: '复制中...', kind: 'progress' }, { message: '复制中...', kind: 'progress' }, { message: '已复制', kind: 'success' }])
    } finally { await act(async () => view.unmount()) }
  })
  it('finishes the current copy when the same image receives its original and renews its URL', async () => {
    const notices: unknown[] = []
    let resolveFetch!: (response: Response) => void
    let signal!: AbortSignal
    const fetcher = vi.fn((_url: string, options: { signal: AbortSignal }) => {
      signal = options.signal
      return new Promise<Response>(resolve => { resolveFetch = resolve })
    })
    class Item { constructor(readonly items: Record<string, Promise<Blob>>) {} }
    const write = vi.fn(async (items: Item[]) => { await items[0]!.items['image/png'] })
    vi.stubGlobal('ClipboardItem', Item)
    vi.stubGlobal('navigator', { clipboard: { write } })
    vi.stubGlobal('fetch', fetcher)
    vi.stubGlobal('createImageBitmap', async () => ({ width: 2, height: 2, close: vi.fn() }))
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => ({ drawImage: vi.fn() }), toBlob: (callback: (blob: Blob) => void) => callback(new Blob(['png'], { type: 'image/png' })) }) })
    const render = (ready: boolean) => <ArkmeFileActions block={{ ...block, kind: 'image', fileAssetUid: 'same-image', mediaRef: ready ? 'renewed-ref' : 'old-ref' }} original={{ reception: { state: 'missing', receivedBytes: 0, totalBytes: 3 }, localRef: ready ? 'arkme-file-v1.11111111-1111-4111-8111-111111111111' : undefined, receive: vi.fn() }} copySourceUrl={ready ? '/renewed' : '/old'} onImageCopyNotice={notice => notices.push(notice)} />
    let view!: ReactTestRenderer
    try {
      await act(async () => { view = create(render(false)) })
      await act(async () => view.root.findByProps({ 'aria-label': '复制图片' }).props.onClick())
      await act(async () => view.update(render(true)))
      expect(signal.aborted).toBe(false)
      expect(view.root.findByProps({ 'aria-label': '复制图片' }).props.disabled).toBe(true)
      await act(async () => { resolveFetch(new Response('jpeg')); await new Promise(resolve => setTimeout(resolve, 0)) })
      expect(fetcher).toHaveBeenCalledTimes(1)
      expect(fetcher).toHaveBeenCalledWith('/old', { signal: expect.any(AbortSignal) })
      expect(write).toHaveBeenCalledOnce()
      expect(view.root.findByProps({ 'aria-label': '复制图片' }).props.disabled).toBe(false)
      expect(notices).toEqual([{ message: '复制中...', kind: 'progress' }, { message: '已复制', kind: 'success' }])
    } finally { await act(async () => view.unmount()) }
  })
  it('aborts image preparation when clipboard permission is rejected and permits retry', async () => {
    const notices: unknown[] = []
    let signal: AbortSignal | undefined
    const fetcher = vi.fn((_url: string, options: { signal: AbortSignal }) => {
      signal = options.signal
      return new Promise<Response>((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError'))))
    })
    vi.stubGlobal('ClipboardItem', class { constructor(_items: unknown) {} })
    const write = vi.fn(async () => { throw new DOMException('denied', 'NotAllowedError') })
    vi.stubGlobal('navigator', { clipboard: { write } })
    vi.stubGlobal('fetch', fetcher)
    let view!: ReactTestRenderer
    try {
      await act(async () => { view = create(<ArkmeFileActions block={{ ...block, kind: 'image' }} original={{ reception: { state: 'missing', receivedBytes: 0, totalBytes: 3 }, localRef: undefined, receive: vi.fn() }} copySourceUrl="/image" onImageCopyNotice={notice => notices.push(notice)} />) })
      await act(async () => view.root.findByProps({ 'aria-label': '复制图片' }).props.onClick())
      expect(signal?.aborted).toBe(true)
      expect(view.root.findByProps({ 'aria-label': '复制图片' }).props.disabled).toBe(false)
      expect(notices).toEqual([{ message: '复制中...', kind: 'progress' }, { message: '复制失败', kind: 'error' }])
      await act(async () => view.root.findByProps({ 'aria-label': '复制图片' }).props.onClick())
      expect(write).toHaveBeenCalledTimes(2)
    } finally { await act(async () => view.unmount()) }
  })
  it('releases decoded pixels if PNG encoding fails', async () => {
    const close = vi.fn()
    vi.stubGlobal('createImageBitmap', async () => ({ width: 2, height: 2, close }))
    const canvas = { width: 0, height: 0, getContext: () => ({ drawImage: vi.fn() }), toBlob: (callback: (blob: Blob | null) => void) => callback(null) }
    vi.stubGlobal('document', { createElement: () => canvas })
    await expect(arkmeClipboardImageBlob(new Blob(['input']))).rejects.toThrow('图片转换失败')
    expect(close).toHaveBeenCalledOnce()
    expect(canvas.width).toBe(0)
    expect(canvas.height).toBe(0)
  })
  it.each(['image/jpeg', 'image/png', 'application/octet-stream'])('encodes %s pixels as PNG and releases the bitmap', async type => {
    const close = vi.fn(), drawImage = vi.fn()
    const bitmap = { width: 20, height: 10, close }
    const encoded = new Blob(['encoded-png'], { type: 'image/png' })
    const canvas = { width: 0, height: 0, getContext: () => ({ drawImage }), toBlob: vi.fn((callback: (blob: Blob) => void) => callback(encoded)) }
    vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap))
    vi.stubGlobal('document', { createElement: () => canvas })
    expect(await arkmeClipboardImageBlob(new Blob(['input'], { type }))).toBe(encoded)
    expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0)
    expect(canvas.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/png')
    expect(close).toHaveBeenCalledOnce()
    expect(canvas.width).toBe(0)
  })
  it('aborts an incomplete disk write and never reports success', async () => {
    const writable = { write: vi.fn(async () => { throw new Error('disk full') }), close: vi.fn(), abort: vi.fn(async () => {}) }
    vi.stubGlobal('window', { showSaveFilePicker: async () => ({ createWritable: async () => writable }) })
    vi.stubGlobal('fetch', async () => new Response('abc'))
    let view!: ReactTestRenderer
    await act(async () => { view = create(<ArkmeFileActions block={block} original={original} />) })
    await act(async () => { view.root.findByType('button').props.onClick(); await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(writable.abort).toHaveBeenCalledOnce(); expect(writable.close).not.toHaveBeenCalled()
    expect(JSON.stringify(view.toJSON())).toContain('disk full')
    expect(JSON.stringify(view.toJSON())).not.toContain('保存成功')
    await act(async () => view.unmount())
  })
})

describe('shared original-file reception display', () => {
  it('updates the message card when reception is started in its viewer', async () => {
    vi.useFakeTimers()
    const receive = vi.spyOn(ArkmeSdk.prototype, 'receiveFile').mockResolvedValue({ state: 'missing', receivedBytes: 0, totalBytes: 3 })
    function Probe({ name }: { name: string }) {
      const value = useArkmeOriginal({ ...block, originalRef: 'arkme-media-v1.shared' })
      return <button aria-label={name} onClick={value.receive}>{value.reception.state}</button>
    }
    let view!: ReactTestRenderer
    await act(async () => { view = create(<><Probe name="card" /><Probe name="viewer" /></>) })
    receive.mockResolvedValue({ state: 'receiving', receivedBytes: 1, totalBytes: 3 })
    await act(async () => view.root.findByProps({ 'aria-label': 'viewer' }).props.onClick())
    expect(view.root.findByProps({ 'aria-label': 'card' }).props.children).toBe('receiving')
    receive.mockResolvedValue({ state: 'ready', receivedBytes: 3, totalBytes: 3 })
    await act(async () => { await vi.advanceTimersByTimeAsync(750) })
    expect(view.root.findByProps({ 'aria-label': 'card' }).props.children).toBe('ready')
    await act(async () => view.unmount())
  })
})

describe('client file preview interaction', () => {
  it.each([
    ['code block', '```text\nreceived code\n```', 'received code'],
    ['footnote', '正文[^note]\n\n[^note]: received footnote', 'received footnote'],
  ])('renders a received Markdown %s without crashing the conversation', async (_kind, text, expected) => {
    const size = new TextEncoder().encode(text).byteLength
    vi.stubGlobal('document', { body: {}, activeElement: null })
    const receive = vi.spyOn(ArkmeSdk.prototype, 'receiveFile').mockImplementation(async (_ref, start) => start
      ? { state: 'ready', receivedBytes: size, totalBytes: size, file: { fileRef: original.localRef, fileName: 'received.md', mimeType: 'text/markdown', size, fileKind: 4 } }
      : { state: 'missing', receivedBytes: 0, totalBytes: size })
    const fetcher = vi.fn(async () => new Response(text))
    vi.stubGlobal('fetch', fetcher)
    let view!: ReactTestRenderer
    try {
      await act(async () => { view = create(<ArkmeFileViewer block={{ ...block, fileName: 'received.md', mimeType: 'text/markdown', originalRef: 'arkme-media-v1.markdown', size }} onClose={() => {}} />) })
      await act(async () => {
        view.root.findAllByType('button').find(button => button.props.children === '打开')!.props.onClick()
        await new Promise(resolve => setTimeout(resolve, 0))
      })
      expect(receive).toHaveBeenCalledWith('arkme-media-v1.markdown', true, expect.any(AbortSignal))
      expect(fetcher).toHaveBeenCalledWith(`/arkme-self/api/files/local?ref=${original.localRef}`, { signal: expect.any(AbortSignal) })
      expect(view.root.findByProps({ role: 'dialog' })).toBeDefined()
      expect(JSON.stringify(view.toJSON())).toContain(expected)
      // Keep checking the current host contract even when CI uses the older optional-label renderer.
      expect(view.root.findByType(MarkdownText.type).props.labels).toEqual({ code: { copyLabel: '复制', copiedLabel: '复制成功' }, footnotes: '脚注' })
      if (_kind === 'code block') expect(JSON.stringify(view.toJSON())).toContain('复制')
    } finally {
      if (view) await act(async () => view.unmount())
    }
  })

  it.each([false, true])('copies cached Markdown code and permits retry after clipboard rejection: %s', async rejectFirst => {
    vi.useFakeTimers()
    vi.stubGlobal('document', { body: {}, activeElement: null })
    vi.stubGlobal('window', { setTimeout })
    const writeText = vi.fn().mockResolvedValue(undefined)
    if (rejectFirst) writeText.mockRejectedValueOnce(new Error('clipboard denied'))
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const receive = vi.spyOn(ArkmeSdk.prototype, 'receiveFile')
    vi.stubGlobal('fetch', async () => new Response('```text\n代码原文\n```\n\n正文[^n]\n\n[^n]: 脚注原文'))
    let view!: ReactTestRenderer
    try {
      await act(async () => { view = create(<ArkmeFileViewer block={{ ...block, fileName: 'cached.MARKDOWN', mimeType: 'text/x-web-markdown', localFileRef: original.localRef }} openLocalFile onClose={() => {}} />) })
      const copyButton = () => view.root.findAllByType('button').find(button => button.props.children === '复制')!
      await act(async () => copyButton().props.onClick())
      if (rejectFirst) {
        expect(JSON.stringify(view.toJSON())).not.toContain('复制成功')
        await act(async () => copyButton().props.onClick())
      }
      expect(writeText).toHaveBeenLastCalledWith('代码原文')
      expect(JSON.stringify(view.toJSON())).toContain('复制成功')
      expect(JSON.stringify(view.toJSON())).toContain('脚注原文')
      expect(receive).not.toHaveBeenCalled()
      await act(async () => vi.advanceTimersByTime(1000))
      expect(copyButton()).toBeDefined()
    } finally { if (view) await act(async () => view.unmount()) }
  })

  it('retries failed Markdown reception with the same original reference before rendering', async () => {
    vi.stubGlobal('document', { body: {}, activeElement: null })
    const receive = vi.spyOn(ArkmeSdk.prototype, 'receiveFile')
      .mockResolvedValueOnce({ state: 'missing', receivedBytes: 0, totalBytes: 3 })
      .mockResolvedValueOnce({ state: 'failed', receivedBytes: 0, totalBytes: 3, error: '接收失败，请重试' })
      .mockResolvedValue({ state: 'ready', receivedBytes: 3, totalBytes: 3, file: { fileRef: original.localRef, fileName: 'retry.md', mimeType: 'text/markdown', size: 3, fileKind: 4 } })
    const fetcher = vi.fn(async () => new Response('# A'))
    vi.stubGlobal('fetch', fetcher)
    let view!: ReactTestRenderer
    try {
      await act(async () => { view = create(<ArkmeFileViewer block={{ ...block, fileName: 'retry.md', mimeType: 'text/markdown', originalRef: 'arkme-media-v1.retry' }} onClose={() => {}} />) })
      const receiveButton = () => view.root.findAllByType('button').find(button => button.props.children === '打开')!
      await act(async () => receiveButton().props.onClick())
      expect(JSON.stringify(view.toJSON())).toContain('接收失败，请重试')
      expect(fetcher).not.toHaveBeenCalled()
      await act(async () => receiveButton().props.onClick())
      expect(receive).toHaveBeenNthCalledWith(3, 'arkme-media-v1.retry', true, expect.any(AbortSignal))
      expect(view.root.findByType('h1').props.children).toBe('A')
      expect(JSON.stringify(view.toJSON())).not.toContain('接收失败，请重试')
    } finally { if (view) await act(async () => view.unmount()) }
  })

  it.each(['http', 'network'])('keeps download and dismissal available after Markdown read %s failure', async failure => {
    vi.stubGlobal('document', { body: {}, activeElement: null })
    vi.stubGlobal('fetch', async () => {
      if (failure === 'network') throw new Error('offline')
      return new Response('', { status: 404 })
    })
    const onClose = vi.fn()
    let view!: ReactTestRenderer
    try {
      await act(async () => { view = create(<ArkmeFileViewer block={{ ...block, fileName: 'missing.md', localFileRef: original.localRef }} openLocalFile onClose={onClose} />) })
      expect(JSON.stringify(view.toJSON())).toContain('文件预览失败，请重试或另存为后打开')
      expect(view.root.findByProps({ 'aria-label': '另存为文件' }).props.disabled).toBe(false)
      await act(async () => view.root.findByProps({ 'aria-label': '关闭文件预览' }).props.onClick())
      expect(onClose).toHaveBeenCalledOnce()
    } finally { if (view) await act(async () => view.unmount()) }
  })

  it('aborts old Markdown reads on file switch and close without replacing the next document', async () => {
    vi.stubGlobal('document', { body: {}, activeElement: null })
    const pending: Array<{ resolve: (response: Response) => void; signal: AbortSignal }> = []
    vi.stubGlobal('fetch', (_url: string, { signal }: { signal: AbortSignal }) => new Promise<Response>(resolve => { pending.push({ resolve, signal }) }))
    const first = { ...block, fileName: 'first.md', mediaRef: 'first', localFileRef: original.localRef }
    const second = { ...first, fileName: 'second.md', mediaRef: 'second', localFileRef: 'arkme-file-v1.00000000-0000-4000-8000-000000000002' }
    let view!: ReactTestRenderer
    try {
      await act(async () => { view = create(<ArkmeFileViewer block={first} openLocalFile onClose={() => {}} />) })
      await act(async () => view.update(<ArkmeFileViewer block={second} openLocalFile onClose={() => {}} />))
      expect(pending[0]!.signal.aborted).toBe(true)
      await act(async () => pending[1]!.resolve(new Response('# Current')))
      await act(async () => pending[0]!.resolve(new Response('# Stale')))
      expect(view.root.findByType('h1').props.children).toBe('Current')
      await act(async () => view.unmount())
      expect(pending[1]!.signal.aborted).toBe(true)
    } finally { if (view) await act(async () => view.unmount()) }
  })

  it('keeps Markdown-looking TXT content plain and large Markdown files on the native-open path', async () => {
    vi.stubGlobal('document', { body: {}, activeElement: null })
    const fetcher = vi.fn(async () => new Response('```text\nplain content\n```'))
    vi.stubGlobal('fetch', fetcher)
    const open = vi.spyOn(ArkmeSdk.prototype, 'openLocalFile').mockResolvedValue({ opened: true, file: { fileRef: original.localRef, fileName: 'large.md', mimeType: 'text/markdown', size: 2 * 1024 * 1024 + 1, fileKind: 4 } })
    let view!: ReactTestRenderer
    try {
      await act(async () => { view = create(<ArkmeFileViewer block={{ ...block, fileName: 'plain.txt', localFileRef: original.localRef }} openLocalFile onClose={() => {}} />) })
      expect(view.root.findByType('pre').props.children).toBe('```text\nplain content\n```')
      expect(view.root.findAllByType(MarkdownText.type)).toHaveLength(0)
      await act(async () => view.update(<ArkmeFileViewer block={{ ...block, fileName: 'large.md', size: 2 * 1024 * 1024 + 1, localFileRef: original.localRef }} openLocalFile onClose={() => {}} />))
      await act(async () => view.root.findAllByType('button').find(button => button.props.children === '打开')!.props.onClick())
      expect(open).toHaveBeenCalledWith(original.localRef, expect.any(AbortSignal))
      expect(fetcher).toHaveBeenCalledTimes(1)
    } finally { if (view) await act(async () => view.unmount()) }
  })

  it('reopens received Markdown in the same preview after closing it', async () => {
    vi.stubGlobal('document', { body: {}, activeElement: null })
    const file = { fileRef: original.localRef, fileName: 'received.md', mimeType: 'text/markdown', size: 7, fileKind: 4 as const }
    let received = false
    vi.spyOn(ArkmeSdk.prototype, 'receiveFile').mockImplementation(async (_ref, start) => {
      if (start) received = true
      return received ? { state: 'ready', receivedBytes: 7, totalBytes: 7, file } : { state: 'missing', receivedBytes: 0, totalBytes: 7 }
    })
    const open = vi.spyOn(ArkmeSdk.prototype, 'openLocalFile').mockResolvedValue({ opened: true, file })
    vi.stubGlobal('fetch', async () => new Response('# Again'))
    let view!: ReactTestRenderer
    try {
      await act(async () => { view = create(<ArkmeFileCard block={{ ...block, fileName: file.fileName, mimeType: file.mimeType, size: 7, originalRef: 'arkme-media-v1.reopen' }} />) })
      const clickCard = async () => { await act(async () => view.root.findByProps({ 'data-arkme-file-card': 'file' }).props.onClick({ stopPropagation: vi.fn() })) }
      await clickCard()
      await act(async () => view.root.findAllByType('button').find(button => button.props.children === '打开')!.props.onClick())
      expect(view.root.findByType('h1').props.children).toBe('Again')
      await act(async () => view.root.findByProps({ 'aria-label': '关闭文件预览' }).props.onClick())
      expect(view.root.findAllByProps({ role: 'dialog' })).toHaveLength(0)
      await clickCard()
      expect(view.root.findByType('h1').props.children).toBe('Again')
      expect(open).not.toHaveBeenCalled()
    } finally { if (view) await act(async () => view.unmount()) }
  })

  it.each([
    ['cached.MARKDOWN', 'text/x-web-markdown', 2 * 1024 * 1024, true],
    ['notes.txt', 'text/plain', 12, true],
    ['table.csv', 'text/csv', 12, true],
    ['app.log', 'text/plain', 12, true],
    ['photo.png', 'application/octet-stream', 12, true],
    ['video.mp4', 'application/octet-stream', 12, true],
    ['sound.mp3', 'audio/mpeg', 12, true],
    ['large.md', 'text/markdown', 2 * 1024 * 1024 + 1, false],
    ['report.pdf', 'application/pdf', 12, false],
    ['report.docx', 'application/octet-stream', 12, false],
    ['dump.xml', 'application/xml', 12, false],
    ['photo.heic', 'image/heic', 12, false],
  ])('routes cached %s using the existing viewer capability', async (fileName, mimeType, size, preview) => {
    const file = { fileRef: original.localRef, fileName, mimeType, size, fileKind: 4 as const }
    const open = vi.spyOn(ArkmeSdk.prototype, 'openLocalFile').mockResolvedValue({ opened: true, file })
    const onOpen = vi.fn()
    let view!: ReactTestRenderer
    try {
      await act(async () => { view = create(<ArkmeFileCard block={{ ...block, fileName, mimeType, size, localFileRef: original.localRef }} onOpen={onOpen} />) })
      await act(async () => view.root.findByProps({ 'data-arkme-file-card': 'file' }).props.onClick({ stopPropagation: vi.fn() }))
      expect(onOpen).toHaveBeenCalledTimes(preview ? 1 : 0)
      expect(open).toHaveBeenCalledTimes(preview ? 0 : 1)
    } finally { if (view) await act(async () => view.unmount()) }
  })

  it('opens an already received file directly from its card without rendering the file dialog', async () => {
    const open = vi.spyOn(ArkmeSdk.prototype, 'openLocalFile').mockResolvedValue({ opened: true, file: { fileRef: original.localRef, fileName: 'a.pdf', mimeType: 'application/pdf', size: 3, fileKind: 4 } })
    const onOpen = vi.fn()
    let view!: ReactTestRenderer
    await act(async () => { view = create(<ArkmeFileCard block={{ ...block, localFileRef: original.localRef }} onOpen={onOpen} />) })

    await act(async () => { view.root.findByProps({ 'data-arkme-file-card': 'file' }).props.onClick({ stopPropagation: vi.fn() }); await Promise.resolve() })

    expect(open).toHaveBeenCalledWith(original.localRef, expect.any(AbortSignal))
    expect(onOpen).not.toHaveBeenCalled()
    expect(view.root.findAllByProps({ role: 'dialog' })).toHaveLength(0)
    expect(JSON.stringify(view.toJSON())).not.toContain('未下载')
    await act(async () => view.unmount())
  })
  it.each(['refresh', 'switch'] as const)('keeps the card usable after an in-flight native-open %s', async mode => {
    let finish!: () => void
    const open = vi.spyOn(ArkmeSdk.prototype, 'openLocalFile').mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({ opened: true } as never) })).mockResolvedValue({ opened: true } as never)
    const onOpen = vi.fn()
    const first = { ...block, localFileRef: original.localRef, fileAssetUid: 'asset-a', mediaRef: 'old' }
    let view!: ReactTestRenderer
    try {
      await act(async () => { view = create(<ArkmeFileCard block={first} onOpen={onOpen} />) })
      await act(async () => view.root.findByProps({ 'data-arkme-file-card': 'file' }).props.onClick({ stopPropagation: vi.fn() }))
      const signal = open.mock.calls[0]![1]!
      await act(async () => view.update(<ArkmeFileCard block={{ ...first, mediaRef: 'new', fileAssetUid: mode === 'switch' ? 'asset-b' : 'asset-a' }} onOpen={onOpen} />))
      expect(signal.aborted).toBe(mode === 'switch')
      if (mode === 'switch') expect(view.root.findByProps({ 'data-arkme-file-card': 'file' }).props.disabled).toBe(false)
      await act(async () => finish())
      expect(view.root.findByProps({ 'data-arkme-file-card': 'file' }).props.disabled).toBe(false)
      await act(async () => view.root.findByProps({ 'data-arkme-file-card': 'file' }).props.onClick({ stopPropagation: vi.fn() }))
      expect(open).toHaveBeenCalledTimes(2)
      expect(onOpen).not.toHaveBeenCalled()
    } finally { await act(async () => view.unmount()) }
  })

  it('keeps the reception dialog entry for a file that has not been received yet', async () => {
    vi.spyOn(ArkmeSdk.prototype, 'receiveFile').mockResolvedValue({ state: 'missing', receivedBytes: 0, totalBytes: 3 })
    const onOpen = vi.fn()
    let view!: ReactTestRenderer
    await act(async () => { view = create(<ArkmeFileCard block={{ ...block, originalRef: 'arkme-media-v1.not-received' }} onOpen={onOpen} />) })

    await act(async () => view.root.findByProps({ 'data-arkme-file-card': 'file' }).props.onClick({ stopPropagation: vi.fn() }))

    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ originalRef: 'arkme-media-v1.not-received' }))
    await act(async () => view.unmount())
  })
  it('shows a real reception percentage with a compact themed track instead of native progress', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('document', { body: {}, activeElement: null })
    vi.spyOn(ArkmeSdk.prototype, 'receiveFile').mockResolvedValue({ state: 'receiving', receivedBytes: 37, totalBytes: 100 })
    let view!: ReactTestRenderer
    await act(async () => { view = create(<ArkmeFileViewer block={{ ...block, originalRef: 'arkme-media-v1.progress', size: 100 }} onClose={() => {}} />) })
    expect(view.root.findAllByType('progress')).toHaveLength(0)
    const track = view.root.findByProps({ role: 'progressbar' })
    expect(track.props['aria-valuenow']).toBe(37)
    expect(track.props.style).toMatchObject({ height: 4, borderRadius: 999 })
    expect(JSON.stringify(view.toJSON())).toContain('正在接收文件 37%')
    await act(async () => view.unmount())
  })
  it.each(['window_dump.xml', 'report.pdf', 'report.docx'])('opens received %s with the DSH native opener', async fileName => {
    vi.stubGlobal('document', { body: {}, activeElement: null })
    const receive = vi.spyOn(ArkmeSdk.prototype, 'receiveFile')
    const open = vi.spyOn(ArkmeSdk.prototype, 'openLocalFile').mockResolvedValue({ opened: true, file: { fileRef: original.localRef, fileName, mimeType: 'application/octet-stream', size: 3, fileKind: 4 } })
    const onClose = vi.fn()
    let view!: ReactTestRenderer
    await act(async () => { view = create(<ArkmeFileViewer block={{ ...block, fileName, mimeType: 'application/octet-stream', localFileRef: original.localRef }} onClose={onClose} />) })
    const buttons = view.root.findAllByType('button')
    const openButton = buttons.find(button => button.props.children === '打开')
    expect(openButton).toBeDefined()
    expect(view.root.findByProps({ 'aria-label': '另存为文件' }).props.children).toBe('另存为')
    await act(async () => { openButton!.props.onClick(); await Promise.resolve() })
    expect(open).toHaveBeenCalledWith(original.localRef, expect.any(AbortSignal))
    expect(onClose).toHaveBeenCalledOnce()
    expect(receive).not.toHaveBeenCalled()
    await act(async () => view.unmount())
  })
  it('opens a received PDF with the system application instead of a blank browser iframe', async () => {
    vi.stubGlobal('document', { body: {}, activeElement: null })
    vi.spyOn(ArkmeSdk.prototype, 'openLocalFile').mockResolvedValue({ opened: true, file: { fileRef: original.localRef, fileName: 'a.pdf', mimeType: 'application/pdf', size: 3, fileKind: 4 } })
    let view!: ReactTestRenderer
    await act(async () => { view = create(<ArkmeFileViewer block={{ ...block, localFileRef: original.localRef }} onClose={() => {}} />) })
    expect(view.root.findAllByType('iframe')).toHaveLength(0)
    expect(view.root.findAllByType('button').some(button => button.props.children === '预览')).toBe(false)
    expect(view.root.findAllByType('button').some(button => button.props.children === '打开')).toBe(true)
    expect(JSON.stringify(view.toJSON())).toContain('a.pdf')
    await act(async () => view.unmount())
  })
  it.each([
    ['image', 'photo.jpg', 'image/jpeg', 'img'],
    ['video', 'movie.mp4', 'video/mp4', 'video'],
    ['audio', 'track.mp3', 'audio/mpeg', 'audio'],
    ['audio with mixed-case MIME', 'track.mp3', 'Audio/MPEG', 'audio'],
    ['audio with padded MIME', 'track.mp3', ' audio/mpeg ', 'audio'],
  ])('uses the real %s preview even when an old block was marked as a generic file', async (_label, fileName, mimeType, element) => {
    vi.stubGlobal('window', {})
    vi.stubGlobal('document', { body: {}, activeElement: null })
    let view!: ReactTestRenderer
    await act(async () => { view = create(<ArkmeFileViewer block={{ ...block, fileName, mimeType, localFileRef: original.localRef }} onClose={() => {}} />) })
    const preview = view.root.findAllByType('button').find(button => button.props.children === '打开')
    expect(preview).toBeDefined()
    await act(async () => preview!.props.onClick())
    expect(view.root.findAllByType(element)).toHaveLength(1)
    await act(async () => view.unmount())
  })
  it('receives a generic file, reports progress, and opens it automatically when ready', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('document', { body: {}, activeElement: null })
    const receive = vi.spyOn(ArkmeSdk.prototype, 'receiveFile').mockResolvedValue({ state: 'missing', receivedBytes: 0, totalBytes: 3 })
    const open = vi.spyOn(ArkmeSdk.prototype, 'openLocalFile').mockResolvedValue({ opened: true, file: { fileRef: original.localRef, fileName: 'a.xml', mimeType: 'application/xml', size: 3, fileKind: 4 } })
    const onClose = vi.fn()
    let view!: ReactTestRenderer
    await act(async () => { view = create(<ArkmeFileViewer block={{ ...block, fileName: 'a.xml', mimeType: 'application/xml', originalRef: 'arkme-media-v1.document' }} onClose={onClose} />) })
    receive.mockResolvedValue({ state: 'receiving', receivedBytes: 1, totalBytes: 3 })
    await act(async () => { view.root.findAllByType('button').find(button => button.props.children === '打开')!.props.onClick(); await Promise.resolve() })
    expect(receive).toHaveBeenCalledWith('arkme-media-v1.document', true, expect.any(AbortSignal))
    expect(view.root.findByProps({ role: 'progressbar' }).props['aria-valuenow']).toBe(33)
    receive.mockResolvedValue({ state: 'ready', receivedBytes: 3, totalBytes: 3, file: { fileRef: original.localRef, fileName: 'a.xml', mimeType: 'application/xml', size: 3, fileKind: 4 } })
    await act(async () => { await vi.advanceTimersByTimeAsync(750); await Promise.resolve() })
    expect(open).toHaveBeenCalledWith(original.localRef, expect.any(AbortSignal))
    expect(onClose).toHaveBeenCalledOnce()
    expect(view.root.findAllByProps({ role: 'alert' })).toHaveLength(0)
    await act(async () => view.unmount())
  })
  it.each([
    ['an unsupported video extension', { fileName: 'movie.mkv', mimeType: 'video/x-matroska' }, false],
    ['an unsupported codec fallback', { fileName: 'movie.mp4', mimeType: 'video/mp4' }, true],
  ])('uses system Open for %s when browser inline preview is unavailable', async (_label, media, forceDownload) => {
    vi.stubGlobal('document', { body: {}, activeElement: null })
    let view!: ReactTestRenderer
    await act(async () => { view = create(<ArkmeFileViewer block={{ ...block, ...media, kind: 'video', localFileRef: original.localRef }} forceDownload={forceDownload} onClose={() => {}} />) })
    expect(view.root.findAllByType('video')).toHaveLength(0)
    expect(view.root.findAllByType('button').some(button => button.props.children === '打开')).toBe(true)
    await act(async () => view.unmount())
  })
  it.each([[0, 0, undefined], [-1, 100, 0], [101, 100, 100]])('keeps reception progress honest for %s / %s bytes', async (receivedBytes, totalBytes, expected) => {
    vi.useFakeTimers()
    vi.stubGlobal('document', { body: {}, activeElement: null })
    vi.spyOn(ArkmeSdk.prototype, 'receiveFile').mockResolvedValue({ state: 'receiving', receivedBytes: receivedBytes!, totalBytes: totalBytes! })
    let view!: ReactTestRenderer
    await act(async () => { view = create(<ArkmeFileViewer block={{ ...block, originalRef: 'arkme-media-v1.unknown-progress' }} onClose={() => {}} />) })
    expect(view.root.findByProps({ role: 'progressbar' }).props['aria-valuenow']).toBe(expected)
    if (expected === undefined) expect(view.root.findByProps({ role: 'status' }).props.children).toBe('正在接收文件')
    await act(async () => view.unmount())
  })
  it('does not carry a pending native-open intent into a different received file', async () => {
    vi.stubGlobal('document', { body: {}, activeElement: null })
    vi.spyOn(ArkmeSdk.prototype, 'receiveFile').mockImplementation(async (_ref, start) => ({ state: start ? 'receiving' : 'missing', receivedBytes: 0, totalBytes: 3 }))
    const open = vi.spyOn(ArkmeSdk.prototype, 'openLocalFile').mockResolvedValue({ opened: true } as never)
    const close = vi.fn()
    let view!: ReactTestRenderer
    try {
      await act(async () => { view = create(<ArkmeFileViewer block={{ ...block, originalRef: 'pending-a' }} onClose={close} />) })
      // Start an open while reception is not yet ready.
      await act(async () => view.root.findByProps({ 'aria-label': '打开文件' }).props.onClick())
      await act(async () => view.update(<ArkmeFileViewer block={{ ...block, localFileRef: original.localRef, mediaRef: 'b' }} onClose={close} />))
      expect(open).not.toHaveBeenCalled()
      expect(close).not.toHaveBeenCalled()
      await act(async () => view.root.findByProps({ 'aria-label': '打开文件' }).props.onClick())
      expect(open).toHaveBeenCalledWith(original.localRef, expect.any(AbortSignal))
    } finally { await act(async () => view.unmount()) }
  })

  it('keeps panel download working independently of the open flow', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('document', { body: {}, activeElement: null })
    const writable = { write: vi.fn(async () => {}), close: vi.fn(async () => {}), abort: vi.fn(async () => {}) }
    vi.stubGlobal('window', { showSaveFilePicker: async () => ({ createWritable: async () => writable }) })
    vi.stubGlobal('fetch', async () => new Response('abc'))
    const receive = vi.spyOn(ArkmeSdk.prototype, 'receiveFile').mockResolvedValue({ state: 'missing', receivedBytes: 0, totalBytes: 3 })
    let view!: ReactTestRenderer
    await act(async () => { view = create(<ArkmeFileViewer block={{ ...block, fileName: 'a.dmg', mimeType: 'application/octet-stream', originalRef: 'arkme-media-v1.toolbar-switch' }} onClose={() => {}} />) })
    receive.mockResolvedValue({ state: 'receiving', receivedBytes: 1, totalBytes: 3 })
    await act(async () => { view.root.findByProps({ 'aria-label': '另存为文件' }).props.onClick(); await Promise.resolve() })
    expect(view.root.findByProps({ role: 'progressbar' }).props['aria-valuenow']).toBe(33)
    receive.mockResolvedValue({ state: 'ready', receivedBytes: 3, totalBytes: 3, file: { fileRef: original.localRef, fileName: 'a.dmg', mimeType: 'application/octet-stream', size: 3, fileKind: 4 } })
    await act(async () => { await vi.advanceTimersByTimeAsync(750) })
    expect(writable.write).toHaveBeenCalledOnce()
    expect(writable.close).toHaveBeenCalledOnce()
    expect(writable.abort).not.toHaveBeenCalled()
    expect(view.root.findAllByProps({ 'aria-label': '另存为文件' })).toHaveLength(1)
    expect(JSON.stringify(view.toJSON())).toContain('保存成功')
    await act(async () => view.unmount())
  })
  it('keeps the close control inside the file panel and preserves click and Escape dismissal', async () => {
    vi.stubGlobal('document', { body: {}, activeElement: null })
    const onClose = vi.fn()
    let view!: ReactTestRenderer
    await act(async () => { view = create(<ArkmeFileViewer block={block} onClose={onClose} />) })
    const dialog = view.root.findByProps({ role: 'dialog' })
    const close = view.root.findByProps({ 'aria-label': '关闭文件预览' })
    expect(close.props.style).toMatchObject({ position: 'absolute', right: 12, top: 12, width: 32, height: 32 })
    expect(close.props.style.color).not.toBe('white')
    expect(dialog.props.style.padding).toBe('48px 40px 32px')
    await act(async () => close.props.onClick())
    expect(onClose).toHaveBeenCalledOnce()
    const stopPropagation = vi.fn()
    await act(async () => dialog.props.onKeyDown({ key: 'Escape', stopPropagation }))
    expect(stopPropagation).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledTimes(2)
    await act(async () => view.unmount())
  })
  it('keeps folder opening distinct from preview and download and prevents duplicate dispatch', async () => {
    vi.stubGlobal('document', { body: {}, activeElement: null })
    const onClose = vi.fn()
    const open = vi.spyOn(ArkmeSdk.prototype, 'openLocalFile')
    let finish!: () => void
    const folder = vi.spyOn(ArkmeSdk.prototype, 'openLocalFileFolder').mockImplementation(() => new Promise(resolve => { finish = () => resolve({ folderOpened: true }) }))
    let view!: ReactTestRenderer
    await act(async () => { view = create(<ArkmeFileViewer block={{ ...block, localFileRef: original.localRef }} onClose={onClose} />) })
    const button = view.root.findByProps({ 'aria-label': '打开文件夹' })
    await act(async () => { button.props.onClick(); button.props.onClick() })
    expect(folder).toHaveBeenCalledOnce()
    expect(folder).toHaveBeenCalledWith(original.localRef, expect.any(AbortSignal))
    expect(button.props.disabled).toBe(true)
    await act(async () => finish())
    expect(onClose).not.toHaveBeenCalled()
    expect(open).not.toHaveBeenCalled()
    expect(button.props.disabled).toBe(false)
    await act(async () => view.unmount())
  })
  it('retries folder failures and clears errors after a successful retry', async () => {
    vi.stubGlobal('document', { body: {}, activeElement: null })
    const folder = vi.spyOn(ArkmeSdk.prototype, 'openLocalFileFolder')
      .mockRejectedValueOnce(new Error('文件夹打开失败，请重试')).mockResolvedValue({ folderOpened: true })
    let view!: ReactTestRenderer
    await act(async () => { view = create(<ArkmeFileViewer block={{ ...block, localFileRef: original.localRef }} onClose={() => {}} />) })
    const button = () => view.root.findByProps({ 'aria-label': '打开文件夹' })
    await act(async () => button().props.onClick())
    expect(view.root.findByProps({ role: 'alert' }).props.children).toBe('文件夹打开失败，请重试')
    expect(button().props.disabled).toBe(false)
    await act(async () => button().props.onClick())
    expect(folder).toHaveBeenCalledTimes(2)
    expect(view.root.findAllByProps({ role: 'alert' })).toHaveLength(0)
    await act(async () => view.unmount())
  })
  it('aborts folder requests on file change and close and ignores stale failures', async () => {
    vi.stubGlobal('document', { body: {}, activeElement: null })
    const pending: { signal: AbortSignal; reject: (error: Error) => void }[] = []
    vi.spyOn(ArkmeSdk.prototype, 'openLocalFileFolder').mockImplementation((_ref, signal) => new Promise((_resolve, reject) => { pending.push({ signal: signal!, reject }) }))
    let view!: ReactTestRenderer
    await act(async () => { view = create(<ArkmeFileViewer block={{ ...block, localFileRef: original.localRef }} onClose={() => {}} />) })
    await act(async () => view.root.findByProps({ 'aria-label': '打开文件夹' }).props.onClick())
    await act(async () => view.update(<ArkmeFileViewer block={{ ...block, localFileRef: 'arkme-file-v1.00000000-0000-4000-8000-000000000002' }} onClose={() => {}} />))
    expect(pending[0]!.signal.aborted).toBe(true)
    await act(async () => view.root.findByProps({ 'aria-label': '打开文件夹' }).props.onClick())
    await act(async () => pending[0]!.reject(new Error('stale error')))
    expect(JSON.stringify(view.toJSON())).not.toContain('stale error')
    expect(view.root.findByProps({ 'aria-label': '打开文件夹' }).props.disabled).toBe(true)
    await act(async () => view.unmount())
    expect(pending[1]!.signal.aborted).toBe(true)
    await act(async () => pending[1]!.reject(new Error('closed')))
  })
  it('does not open two save pickers for synchronous duplicate clicks', async () => {
    vi.stubGlobal('document', { body: {}, activeElement: null })
    let cancel!: (error: Error) => void
    const picker = vi.fn(() => new Promise((_resolve, reject) => { cancel = reject }))
    vi.stubGlobal('window', { showSaveFilePicker: picker })
    let view!: ReactTestRenderer
    await act(async () => { view = create(<ArkmeFileViewer block={{ ...block, localFileRef: original.localRef }} onClose={() => {}} />) })
    const button = view.root.findByProps({ 'aria-label': '另存为文件' })
    await act(async () => { button.props.onClick(); button.props.onClick() })
    expect(picker).toHaveBeenCalledOnce()
    await act(async () => cancel(new DOMException('cancelled', 'AbortError')))
    expect(button.props.disabled).toBe(false)
    expect(JSON.stringify(view.toJSON())).not.toContain('保存成功')
    await act(async () => view.unmount())
  })
  it.each(['local', 'remote'] as const)('resets download busy state on %s file change without an old picker clearing a new save', async source => {
    vi.stubGlobal('document', { body: {}, activeElement: null })
    vi.spyOn(ArkmeSdk.prototype, 'receiveFile').mockResolvedValue({ state: 'missing', receivedBytes: 0, totalBytes: 3 })
    const selected = (ref: string) => ({ ...block, ...(source === 'local' ? { localFileRef: ref } : { originalRef: ref }) })
    const pending: ((error: Error) => void)[] = []
    vi.stubGlobal('window', { showSaveFilePicker: () => new Promise((_resolve, reject) => pending.push(reject)) })
    let view!: ReactTestRenderer
    await act(async () => { view = create(<ArkmeFileViewer block={selected(original.localRef)} onClose={() => {}} />) })
    await act(async () => view.root.findByProps({ 'aria-label': '另存为文件' }).props.onClick())
    await act(async () => view.update(<ArkmeFileViewer block={selected('arkme-file-v1.00000000-0000-4000-8000-000000000002')} onClose={() => {}} />))
    expect(view.root.findByProps({ 'aria-label': '打开文件' }).props.disabled).toBe(false)
    await act(async () => view.root.findByProps({ 'aria-label': '另存为文件' }).props.onClick())
    await act(async () => pending[0]!(new DOMException('cancelled', 'AbortError')))
    expect(view.root.findByProps({ 'aria-label': '另存为文件' }).props.disabled).toBe(true)
    await act(async () => pending[1]!(new DOMException('cancelled', 'AbortError')))
    expect(view.root.findByProps({ 'aria-label': '另存为文件' }).props.disabled).toBe(false)
    await act(async () => view.unmount())
  })
  it.each(['image', 'video'] as const)('preserves the %s toolbar download', async kind => {
    vi.stubGlobal('document', { body: {}, activeElement: null })
    let view!: ReactTestRenderer
    await act(async () => { view = create(<ArkmeFileViewer block={{ ...block, kind, fileName: kind === 'image' ? 'photo.jpg' : 'clip.mp4', mimeType: kind === 'image' ? 'image/jpeg' : 'video/mp4', localFileRef: original.localRef }} onClose={() => {}} />) })
    expect(view.root.findAllByProps({ 'aria-label': '文件操作' })).toHaveLength(0)
    expect(view.root.findByProps({ 'aria-label': kind === 'image' ? '下载图片' : '下载视频' }).findAllByType('svg')).toHaveLength(1)
    await act(async () => view.unmount())
  })
  it('keeps preview and folder access available during an independent save', async () => {
    vi.stubGlobal('document', { body: {}, activeElement: null })
    let cancel!: (error: Error) => void
    vi.stubGlobal('window', { showSaveFilePicker: () => new Promise((_resolve, reject) => { cancel = reject }) })
    vi.stubGlobal('fetch', async () => new Response('# independent preview'))
    let view!: ReactTestRenderer
    await act(async () => { view = create(<ArkmeFileViewer block={{ ...block, fileName: 'a.md', localFileRef: original.localRef }} onClose={() => {}} />) })
    await act(async () => view.root.findByProps({ 'aria-label': '另存为文件' }).props.onClick())
    expect(view.root.findByProps({ 'aria-label': '打开文件' }).props.disabled).toBe(false)
    expect(view.root.findByProps({ 'aria-label': '打开文件夹' }).props.disabled).toBe(false)
    await act(async () => view.root.findByProps({ 'aria-label': '打开文件' }).props.onClick())
    expect(view.root.findByType('h1').props.children).toBe('independent preview')
    await act(async () => cancel(new DOMException('cancelled', 'AbortError')))
    await act(async () => view.unmount())
  })
  it('retains an opened preview when the same asset renews its access reference', async () => {
    vi.stubGlobal('document', { body: {}, activeElement: null })
    const fetcher = vi.fn(async () => new Response('# retained'))
    vi.stubGlobal('fetch', fetcher)
    const file = { ...block, fileAssetUid: 'asset-md', fileName: 'a.md', localFileRef: original.localRef, mediaRef: 'old' }
    let view!: ReactTestRenderer
    try {
      await act(async () => { view = create(<ArkmeFileViewer block={file} onClose={() => {}} />) })
      await act(async () => view.root.findByProps({ 'aria-label': '打开文件' }).props.onClick())
      await act(async () => view.update(<ArkmeFileViewer block={{ ...file, mediaRef: 'renewed' }} onClose={() => {}} />))
      expect(view.root.findAllByProps({ 'aria-label': '打开文件' })).toHaveLength(0)
      expect(view.root.findByType('h1').props.children).toBe('retained')
      expect(fetcher).toHaveBeenCalledOnce()
      await act(async () => view.update(<ArkmeFileViewer block={{ ...file, fileAssetUid: 'different', localFileRef: 'arkme-file-v1.00000000-0000-4000-8000-000000000002' }} onClose={() => {}} />))
      expect(view.root.findByProps({ 'aria-label': '打开文件' })).toBeDefined()
    } finally { await act(async () => view.unmount()) }
  })

  it('hides Open while previewing and keeps download and folder actions', async () => {
    vi.stubGlobal('document', { body: {}, activeElement: null })
    vi.stubGlobal('fetch', async () => new Response('# preview'))
    let view!: ReactTestRenderer
    try {
      await act(async () => { view = create(<ArkmeFileViewer block={{ ...block, fileName: 'a.md', localFileRef: original.localRef }} openLocalFile onClose={() => {}} />) })
      expect(view.root.findAllByProps({ 'aria-label': '打开文件' })).toHaveLength(0)
      expect(view.root.findByProps({ 'aria-label': '另存为文件' })).toBeDefined()
      expect(view.root.findByProps({ 'aria-label': '打开文件夹' })).toBeDefined()
    } finally { await act(async () => view.unmount()) }
  })

  it('reloads failed Markdown through the explicit preview retry action', async () => {
    vi.stubGlobal('document', { body: {}, activeElement: null })
    const fetcher = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(new Response('# recovered'))
    vi.stubGlobal('fetch', fetcher)
    let view!: ReactTestRenderer
    await act(async () => { view = create(<ArkmeFileViewer block={{ ...block, fileName: 'a.md', localFileRef: original.localRef }} onClose={() => {}} />) })
    await act(async () => view.root.findByProps({ 'aria-label': '打开文件' }).props.onClick())
    expect(view.root.findByProps({ role: 'alert' })).toBeDefined()
    expect(view.root.findAllByProps({ 'aria-label': '打开文件' })).toHaveLength(0)
    await act(async () => view.root.findAllByType('button').find(button => button.props.children === '重试预览')!.props.onClick())
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(view.root.findByType('h1').props.children).toBe('recovered')
    await act(async () => view.unmount())
  })
  it('aborts rather than committing a stale save after switching files during write', async () => {
    vi.stubGlobal('document', { body: {}, activeElement: null })
    let finish!: () => void
    const writable = { write: vi.fn(() => new Promise<void>(resolve => { finish = resolve })), close: vi.fn(), abort: vi.fn(async () => {}) }
    vi.stubGlobal('window', { showSaveFilePicker: async () => ({ createWritable: async () => writable }) })
    vi.stubGlobal('fetch', async () => new Response('abc'))
    let view!: ReactTestRenderer
    await act(async () => { view = create(<ArkmeFileViewer block={{ ...block, localFileRef: original.localRef }} onClose={() => {}} />) })
    await act(async () => view.root.findByProps({ 'aria-label': '另存为文件' }).props.onClick())
    expect(writable.write).toHaveBeenCalledOnce()
    await act(async () => view.update(<ArkmeFileViewer block={{ ...block, localFileRef: 'arkme-file-v1.00000000-0000-4000-8000-000000000002' }} onClose={() => {}} />))
    await act(async () => finish())
    expect(writable.close).not.toHaveBeenCalled()
    expect(writable.abort).toHaveBeenCalledOnce()
    expect(JSON.stringify(view.toJSON())).not.toContain('保存成功')
    await act(async () => view.unmount())
  })
  it('does not publish a completed old save into the next file', async () => {
    vi.stubGlobal('document', { body: {}, activeElement: null })
    let finish!: () => void
    const writable = { write: vi.fn(async () => {}), close: vi.fn(() => new Promise<void>(resolve => { finish = resolve })), abort: vi.fn(async () => {}) }
    vi.stubGlobal('window', { showSaveFilePicker: async () => ({ createWritable: async () => writable }) })
    vi.stubGlobal('fetch', async () => new Response('abc'))
    let view!: ReactTestRenderer
    await act(async () => { view = create(<ArkmeFileViewer block={{ ...block, localFileRef: original.localRef }} onClose={() => {}} />) })
    await act(async () => view.root.findByProps({ 'aria-label': '另存为文件' }).props.onClick())
    expect(writable.close).toHaveBeenCalledOnce()
    await act(async () => view.update(<ArkmeFileViewer block={{ ...block, localFileRef: 'arkme-file-v1.00000000-0000-4000-8000-000000000002' }} onClose={() => {}} />))
    await act(async () => finish())
    expect(JSON.stringify(view.toJSON())).not.toContain('保存成功')
    await act(async () => view.unmount())
  })
  it('keeps an in-flight save on the same asset when only access references refresh', async () => {
    vi.stubGlobal('document', { body: {}, activeElement: null })
    let choose!: (handle: unknown) => void
    const writable = { write: vi.fn(async () => {}), close: vi.fn(async () => {}), abort: vi.fn(async () => {}) }
    vi.stubGlobal('window', { showSaveFilePicker: () => new Promise(resolve => { choose = resolve }) })
    vi.stubGlobal('fetch', async () => new Response('abc'))
    let view!: ReactTestRenderer
    const stable = { ...block, fileAssetUid: 'asset-one', localFileRef: original.localRef }
    await act(async () => { view = create(<ArkmeFileViewer block={{ ...stable, mediaRef: 'old-url', originalRef: 'old-access' }} onClose={() => {}} />) })
    await act(async () => view.root.findByProps({ 'aria-label': '另存为文件' }).props.onClick())
    await act(async () => view.update(<ArkmeFileViewer block={{ ...stable, mediaRef: 'new-url', originalRef: 'new-access' }} onClose={() => {}} />))
    expect(view.root.findByProps({ 'aria-label': '另存为文件' }).props.disabled).toBe(true)
    await act(async () => choose({ createWritable: async () => writable }))
    expect(writable.close).toHaveBeenCalledOnce()
    await act(async () => view.unmount())
  })
  it('shows a loading state for a pending Markdown read without blocking download', async () => {
    vi.stubGlobal('document', { body: {}, activeElement: null })
    let finish!: (response: Response) => void
    vi.stubGlobal('fetch', () => new Promise(resolve => { finish = resolve }))
    let view!: ReactTestRenderer
    await act(async () => { view = create(<ArkmeFileViewer block={{ ...block, fileName: 'a.md', localFileRef: original.localRef }} onClose={() => {}} />) })
    await act(async () => view.root.findByProps({ 'aria-label': '打开文件' }).props.onClick())
    expect(view.root.findByProps({ role: 'status' }).props.children).toBe('正在加载文件...')
    expect(view.root.findByProps({ 'aria-label': '另存为文件' }).props.disabled).toBe(false)
    await act(async () => finish(new Response('')))
    expect(view.root.findAllByProps({ role: 'status' })).toHaveLength(0)
    await act(async () => view.unmount())
  })
  it('shows three panel actions and no duplicate toolbar download', async () => {
    vi.stubGlobal('document', { body: {}, activeElement: null })
    const receive = vi.spyOn(ArkmeSdk.prototype, 'receiveFile').mockResolvedValue({ state: 'missing', receivedBytes: 0, totalBytes: 3 })
    let view!: ReactTestRenderer
    await act(async () => { view = create(<ArkmeFileViewer block={{ ...block, originalRef: 'arkme-media-v1.panel' }} onClose={() => {}} />) })
    expect(view.root.findAllByType('button').some(button => button.props.children === '打开')).toBe(true)
    expect(view.root.findByProps({ 'aria-label': '另存为文件' })).toBeDefined()
    const actions = view.root.findByProps({ role: 'group', 'aria-label': '文件操作' })
    expect(actions.findAllByType('button').map(button => button.props.children)).toEqual(['打开', '另存为', '打开文件夹'])
    expect(view.root.findAllByProps({ 'aria-label': '另存为文件' })).toHaveLength(1)
    expect(actions.findByProps({ 'aria-label': '打开文件夹' }).props.disabled).toBe(true)
    expect(actions.findByProps({ 'aria-label': '打开文件夹' }).props.title).toBe('请先打开或另存为文件')
    const fileIcon = view.root.findByType('img')
    expect(fileIcon.props['data-arkme-file-icon-set']).toBe('untitled-solid')
    expect(fileIcon.props.width).toBe(64)
    expect(fileIcon.props.height).toBe(64)
    expect(fileIcon.props.style).toMatchObject({ width: 64, height: 64, objectFit: 'contain' })
    expect(actions.findAllByType('button').some(button => button.props.children === '下载')).toBe(false)
    expect(receive).toHaveBeenCalledWith('arkme-media-v1.panel', false, expect.any(AbortSignal))
    await act(async () => view.unmount())
  })
  it('opens a staged Markdown file using the public formatted renderer without uploading it', async () => {
    vi.stubGlobal('document', { body: {}, activeElement: null })
    const receive = vi.spyOn(ArkmeSdk.prototype, 'receiveFile')
    vi.stubGlobal('fetch', async () => new Response('# 标题\n\n**重点**\n\n<script>unsafe()</script>'))
    let view!: ReactTestRenderer
    await act(async () => { view = create(<ArkmeFileViewer block={{ ...block, fileName: 'a.md', mimeType: 'text/markdown', localFileRef: original.localRef }} onClose={() => {}} />) })
    await act(async () => { view.root.findAllByType('button').find(button => button.props.children === '打开')!.props.onClick(); await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(view.root.findByType('h1').props.children).toBe('标题')
    expect(view.root.findByType('strong').props.children).toEqual(['重点'])
    expect(view.root.findByProps({ role: 'dialog' }).props.style.padding).toBe('56px 20px 20px')
    expect(view.root.findByProps({ 'aria-label': '关闭文件预览' }).props.style).toMatchObject({ top: 12, right: 12 })
    expect(view.root.findAllByType('script')).toHaveLength(0)
    expect(receive).not.toHaveBeenCalled()
    await act(async () => view.unmount())
  })
})

describe('file quick search UI', () => {
  it('uses the existing file lane, paginates, and exposes source navigation', async () => {
    vi.useFakeTimers()
    const item = { recordUid: 'record', sourceKind: 1, routeTargetKind: 'topic', sendAtMillis: 1, title: '', textContent: '', snippet: '', media: [], files: [{ fileAssetUid: 'asset', fileName: 'report.pdf', size: 20 }], targetSource: { sourceRef: 'source', kind: 'topic' } }
    api.call.mockResolvedValueOnce({ items: [item], hasMore: true, nextCursor: 'next', sourceAggregates: [] }).mockResolvedValueOnce({ items: [], hasMore: false, sourceAggregates: [] })
    const onOpen = vi.fn(); let view!: ReactTestRenderer
    await act(async () => { view = create(<ArkmeFileQuickView query="" onOpenRecord={onOpen} />) })
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(api.call).toHaveBeenCalledWith('files.search', { query: '', limit: 30 }, expect.any(AbortSignal))
    await act(async () => view.root.findAllByType('button').find(button => button.props.children === '查看来源')!.props.onClick())
    expect(onOpen).toHaveBeenCalledWith(item)
    await act(async () => view.root.findAllByType('button').find(button => button.props.children === '加载更多')!.props.onClick())
    expect(api.call).toHaveBeenLastCalledWith('files.search', { query: '', limit: 30, cursor: 'next' }, expect.any(AbortSignal))
    expect(JSON.stringify(view.toJSON())).toContain('report.pdf')
    await act(async () => view.unmount())
  })
})
