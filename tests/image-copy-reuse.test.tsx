import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArkmeFileActions, ArkmeFileViewer, arkmeClipboardImageBlob } from '../src/client/ArkmeFileViewer.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { ArkmeMediaAccessContext, type ArkmeMediaReadState } from '../src/client/media-access.js'

vi.mock('react-dom', async importOriginal => ({ ...await importOriginal<typeof import('react-dom')>(), createPortal: (children: import('react').ReactNode) => children }))

const block = { kind: 'image' as const, fileAssetUid: 'asset-a', mediaRef: 'preview-a', originalRef: 'original-a', fileName: 'a.jpg', mimeType: 'image/jpeg', size: 10, sortOrder: 0 }
const original = { localRef: undefined, reception: { state: 'missing' as const, receivedBytes: 0, totalBytes: 10 }, receive: vi.fn() }
const base = 'http://fixture.local/'
const originalUrl = `${base}arkme-self/api/media?ref=original-a`
let view: ReactTestRenderer | undefined
let encode: (done: (blob: Blob | null) => void) => void
let written: Blob[]
let canvas: { width: number; height: number; getContext: ReturnType<typeof vi.fn>; toBlob: ReturnType<typeof vi.fn> }
const png = new Blob(['png'], { type: 'image/png' })
const draw = vi.fn()
const bitmap = vi.fn(async () => ({ width: 4, height: 3, close: vi.fn() }))
const fetcher = vi.fn(async () => new Response('jpeg', { headers: { 'Content-Type': 'image/jpeg' } }))
const notice = vi.fn()
function loaded(overrides: Partial<HTMLImageElement> = {}): HTMLImageElement {
  return { isConnected: true, complete: true, naturalWidth: 4000, naturalHeight: 3000, src: originalUrl, currentSrc: originalUrl, ownerDocument: { baseURI: base }, ...overrides } as HTMLImageElement
}
async function click() { await act(async () => { view!.root.findByProps({ 'aria-label': '复制图片' }).props.onClick() }) }
beforeEach(() => {
  written = []; encode = done => { done(png) }
  canvas = { width: 0, height: 0, getContext: vi.fn(() => ({ drawImage: draw })), toBlob: vi.fn(done => encode(done)) }
  vi.stubGlobal('document', { createElement: () => canvas })
  vi.stubGlobal('createImageBitmap', bitmap)
  vi.stubGlobal('fetch', fetcher)
  class Item { constructor(readonly values: Record<string, Promise<Blob>>) {} }
  vi.stubGlobal('ClipboardItem', Item)
  vi.stubGlobal('navigator', { clipboard: { write: vi.fn(async (items: Item[]) => { written.push(await items[0]!.values['image/png']!) }) } })
  arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 42 })
})
afterEach(async () => {
  if (view) await act(async () => view!.unmount()); view = undefined
  arkmeAuthStore.setAuth({ status: 'logged-out', environment: 'test' })
  vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks()
})
describe('copying already decoded original images', () => {
  it('uses the matching original pixels at their natural dimensions without fetching or decoding again', async () => {
    const image = loaded()
    encode = done => { expect(canvas.width).toBe(4000); expect(canvas.height).toBe(3000); done(png) }
    await act(async () => { view = create(<ArkmeFileActions block={block} original={original} copyImage={() => image} onImageCopyNotice={notice} />) })
    await click()
    expect(fetcher).not.toHaveBeenCalled(); expect(bitmap).not.toHaveBeenCalled()
    expect(draw).toHaveBeenCalledWith(image, 0, 0); expect(written).toEqual([png])
    expect(canvas.width).toBe(0); expect(canvas.height).toBe(0)
    expect(notice).toHaveBeenLastCalledWith({ message: '已复制', kind: 'success' })
  })
  it.each([
    { complete: false }, { isConnected: false }, { naturalWidth: 0 }, { naturalHeight: 0 },
    { src: `${base}other.jpg` }, { currentSrc: `${base}other.jpg` },
  ])('does not reuse a detached, incomplete, zero-sized or changed original: %j', async overrides => {
    await act(async () => { view = create(<ArkmeFileActions block={block} original={original} copyImage={() => loaded(overrides)} />) })
    await click()
    expect(fetcher).toHaveBeenCalledOnce(); expect(bitmap).toHaveBeenCalledOnce(); expect(written).toEqual([png])
  })
  it('does not let a decoded preview bypass the original, but reuses it after original failure', async () => {
    const preview = loaded({ src: `${base}arkme-self/api/media?ref=preview-a`, currentSrc: `${base}arkme-self/api/media?ref=preview-a` })
    await act(async () => { view = create(<ArkmeFileActions block={block} original={original} copyImage={() => preview} />) })
    await click(); expect(fetcher).toHaveBeenCalledOnce(); expect(draw).not.toHaveBeenCalledWith(preview, 0, 0)
    fetcher.mockResolvedValueOnce(new Response('', { status: 404 }))
    await click()
    expect(fetcher).toHaveBeenCalledTimes(2); expect(draw).toHaveBeenLastCalledWith(preview, 0, 0)
  })
  it('falls back to fetching the same original if drawing loaded pixels fails', async () => {
    draw.mockImplementationOnce(() => { throw new DOMException('tainted', 'SecurityError') })
    await act(async () => { view = create(<ArkmeFileActions block={block} original={original} copyImage={() => loaded()} />) })
    await click()
    expect(fetcher).toHaveBeenCalledWith('/arkme-self/api/media?ref=original-a', { signal: expect.any(AbortSignal) })
    expect(bitmap).toHaveBeenCalledOnce(); expect(written).toEqual([png]); expect(canvas.width).toBe(0)
  })
  it.each(['asset', 'account', 'logout', 'unmount'] as const)('drops a pending PNG on %s change and disposes temporary scope listeners', async change => {
    let complete!: (blob: Blob | null) => void; encode = done => { complete = done }
    const authSubscriptions = new Set<() => void>(); const subscribe = arkmeAuthStore.subscribe
    vi.spyOn(arkmeAuthStore, 'subscribe').mockImplementation(listener => { authSubscriptions.add(listener); const off = subscribe(listener); return () => { authSubscriptions.delete(listener); off() } })
    const access = { url: () => originalUrl }
    const render = (image = block) => <ArkmeMediaAccessContext.Provider value={access}><ArkmeFileActions block={image} original={original} copyImage={() => loaded()} onImageCopyNotice={notice} /></ArkmeMediaAccessContext.Provider>
    await act(async () => { view = create(render()) }); await click()
    await act(async () => {
      if (change === 'asset') view!.update(render({ ...block, fileAssetUid: 'asset-b', mediaRef: 'preview-b' }))
      if (change === 'account') arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 99 })
      if (change === 'logout') arkmeAuthStore.setAuth({ status: 'logged-out', environment: 'test' })
      if (change === 'unmount') { view!.unmount(); view = undefined }
      complete(png)
    })
    expect(written).toEqual([])
    expect(notice).toHaveBeenCalledTimes(1)
    expect(authSubscriptions.size).toBe(0)
    expect(canvas.width).toBe(0)
  })
  it.each(['fetch', 'encode'] as const)('keeps an in-flight %s through an equivalent new access object', async phase => {
    let finish!: () => void
    if (phase === 'encode') encode = done => { finish = () => { done(png) } }
    else fetcher.mockImplementationOnce(() => new Promise(resolve => { finish = () => { resolve(new Response('jpeg')) } }))
    const render = () => <ArkmeMediaAccessContext.Provider value={{ url: () => originalUrl }}><ArkmeFileActions block={block} original={original} copyImage={() => phase === 'encode' ? loaded() : null} /></ArkmeMediaAccessContext.Provider>
    await act(async () => { view = create(render()) }); await click()
    await act(async () => { view!.update(render()) })
    await act(async () => { finish() })
    expect(written).toEqual([png])
  })
  it('cancels on a different authorized URL even when the asset identity is unchanged', async () => {
    let finish!: (blob: Blob | null) => void; encode = done => { finish = done }
    const render = (url: string) => <ArkmeMediaAccessContext.Provider value={{ url: () => url }}><ArkmeFileActions block={block} original={original} copyImage={() => loaded()} /></ArkmeMediaAccessContext.Provider>
    await act(async () => { view = create(render(originalUrl)) }); await click()
    await act(async () => { view!.update(render(`${base}other-scope`)) })
    await act(async () => { finish(png) })
    expect(written).toEqual([])
  })
  it('keeps guarded media on the authorized fetch path without starting another checking-first read owner', async () => {
    const stopRead = vi.fn()
    const subscribeReadState = vi.fn((listener: (state: ArkmeMediaReadState) => void) => {
      listener({ status: 'checking' })
      queueMicrotask(() => { listener({ status: 'available' }) })
      return stopRead
    })
    const access = { url: () => originalUrl, subscribeReadState }
    await act(async () => { view = create(<ArkmeMediaAccessContext.Provider value={access}><ArkmeFileActions block={block} original={original} copyImage={() => loaded()} /></ArkmeMediaAccessContext.Provider>) })
    await click()
    expect(written).toEqual([png]); expect(fetcher).toHaveBeenCalledOnce(); expect(bitmap).toHaveBeenCalledOnce()
    expect(subscribeReadState).not.toHaveBeenCalled(); expect(stopRead).not.toHaveBeenCalled()
  })
  it('clears the actual viewer progress notice and unlocks copy when its access URL changes', async () => {
    let finish!: (response: Response) => void
    let signal!: AbortSignal
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) => { signal = init.signal!; return new Promise<Response>(resolve => { finish = resolve }) })
    const image = { ...block, originalRef: undefined, localFileRef: 'arkme-file-v1.11111111-1111-4111-8111-111111111111' }
    const render = (url: string) => <ArkmeMediaAccessContext.Provider value={{ url: () => url }}><ArkmeFileViewer block={image} onClose={() => {}} /></ArkmeMediaAccessContext.Provider>
    await act(async () => { view = create(render(originalUrl)) }); await click()
    expect(JSON.stringify(view!.toJSON())).toContain('复制中')
    expect(view!.root.findByProps({ 'aria-label': '复制图片' }).props.disabled).toBe(true)
    await act(async () => { view!.update(render(`${base}other-scope`)) })
    expect(signal.aborted).toBe(true)
    expect(JSON.stringify(view!.toJSON())).not.toContain('复制中')
    expect(view!.root.findByProps({ 'aria-label': '复制图片' }).props.disabled).toBe(false)
    await act(async () => { finish(new Response('jpeg')) })
    expect(written).toEqual([])
  })
  it('releases the canvas after a loaded image encode fails', async () => {
    encode = done => { done(null) }
    await expect(arkmeClipboardImageBlob(loaded())).rejects.toThrow('图片转换失败')
    expect(bitmap).not.toHaveBeenCalled(); expect(canvas.width).toBe(0)
  })
})
