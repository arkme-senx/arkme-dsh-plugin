import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArkmeFileActions, ArkmeFileViewer, useArkmeOriginal } from '../src/client/ArkmeFileViewer.js'
import type { ReactNode } from 'react'
import { ArkmeSdk } from '../src/sdk/index.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { ArkmeMediaAccessContext, type ArkmeMediaAccess } from '../src/client/media-access.js'
import { AttachmentPreviewSurface } from '../src/client/attachment-preview-window.js'
import type { ArkmeContentBlock } from '../src/types.js'

vi.mock('react-dom', async importOriginal => ({ ...await importOriginal<typeof import('react-dom')>(), createPortal: (children: ReactNode) => children }))

const localRef = 'arkme-file-v1.00000000-0000-4000-8000-000000000001'
const video: ArkmeContentBlock = { kind: 'video', mediaRef: 'arkme-media-v1.preview', originalRef: 'arkme-media-v1.original', fileName: 'clip.mp4', mimeType: 'video/mp4', size: 3, sortOrder: 0 }
const missing = { state: 'missing' as const, receivedBytes: 0, totalBytes: 3 }
const ready = { state: 'ready' as const, receivedBytes: 3, totalBytes: 3, file: { fileRef: localRef, fileName: video.fileName, mimeType: video.mimeType, size: 3, fileKind: 3 as const } }
let view: ReactTestRenderer | undefined
let bridge: { version: number; supported: boolean; begin: ReturnType<typeof vi.fn>; copy: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> }
let receive: ReturnType<typeof vi.spyOn>
const notice = vi.fn()
function Surface({ block = video, access }: { block?: ArkmeContentBlock; access?: ArkmeMediaAccess }) {
  const original = useArkmeOriginal(block)
  return <ArkmeMediaAccessContext.Provider value={access}><ArkmeFileActions block={block} original={original} onImageCopyNotice={notice} /></ArkmeMediaAccessContext.Provider>
}
async function mount(block = video, access?: ArkmeMediaAccess) { await act(async () => { view = create(<Surface block={block} {...(access ? { access } : {})} />) }) }
async function click() { await act(async () => { view!.root.findByProps({ 'aria-label': '复制视频' }).props.onClick() }) }
beforeEach(() => {
  vi.useFakeTimers()
  bridge = { version: 1, supported: true, begin: vi.fn(async () => {}), copy: vi.fn(async () => ({ copied: true })), cancel: vi.fn(async () => {}) }
  vi.stubGlobal('window', { arkmeDesktop: { videoClipboard: bridge } })
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Browser must not fetch video bytes') }))
  receive = vi.spyOn(ArkmeSdk.prototype, 'receiveFile').mockResolvedValue(missing)
  arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 42 })
})
afterEach(async () => {
  if (view) await act(async () => { view!.unmount(); view = undefined })
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); notice.mockClear()
  arkmeAuthStore.setAuth({ status: 'logged-out', environment: 'test' })
})

describe('video file clipboard UI', () => {
  it('copies a complete local video without receiving or reading browser bytes', async () => {
    await mount({ ...video, originalRef: undefined, localFileRef: localRef })
    await click()
    expect(receive).not.toHaveBeenCalled()
    expect(bridge.begin).toHaveBeenCalledWith({ requestId: expect.any(String), accountKey: 'test:42' })
    expect(bridge.copy).toHaveBeenCalledWith({ requestId: bridge.begin.mock.calls[0]![0].requestId, accountKey: 'test:42', fileRef: localRef })
    expect(fetch).not.toHaveBeenCalled()
    expect(notice).toHaveBeenLastCalledWith({ kind: 'success', message: '已复制' })
  })
  it('preserves the original grant when a received video also has a localFileRef', async () => {
    await mount({ ...video, localFileRef: localRef }); await click()
    expect(receive).not.toHaveBeenCalled()
    expect(bridge.copy).toHaveBeenCalledWith(expect.objectContaining({ fileRef: localRef, mediaRef: video.originalRef }))
  })
  it('reserves the clipboard before receiving, then joins the existing reception poll', async () => {
    let begin!: () => void
    bridge.begin.mockImplementation(() => new Promise<void>(resolve => { begin = resolve }))
    receive.mockResolvedValueOnce(missing).mockResolvedValueOnce({ ...missing, state: 'receiving' }).mockResolvedValue(ready)
    await mount(); await click()
    expect(receive.mock.calls.map(call => call[1])).toEqual([false])
    await act(async () => { begin() })
    expect(receive.mock.calls.map(call => call[1])).toEqual([false, true])
    expect(bridge.copy).not.toHaveBeenCalled()
    await act(async () => { await vi.advanceTimersByTimeAsync(750) })
    expect(receive.mock.calls.map(call => call[1])).toEqual([false, true, false])
    expect(bridge.copy).toHaveBeenCalledWith(expect.objectContaining({ fileRef: localRef, mediaRef: video.originalRef }))
    expect(fetch).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
  it('copies an already received original with no second receive start', async () => {
    receive.mockResolvedValue(ready)
    await mount(); await click()
    expect(receive.mock.calls.map(call => call[1])).toEqual([false])
    expect(bridge.copy).toHaveBeenCalledWith(expect.objectContaining({ fileRef: localRef, mediaRef: video.originalRef }))
  })
  it('uses a Team media ref for reception and native authorization without a second preflight owner', async () => {
    const team = { ...video, originalRef: undefined, mediaRef: 'team-app-media.signed' }
    const watch = vi.fn()
    receive.mockImplementation(async (_ref, start) => start ? ready : missing)
    await mount(team, { url: () => '/arkme-self/api/team/media?ref=signed', readScopeKey: 'team:message:1', subscribeReadState: watch })
    await click()
    expect(receive).toHaveBeenCalledWith(team.mediaRef, true, expect.any(AbortSignal))
    expect(bridge.copy).toHaveBeenCalledWith(expect.objectContaining({ fileRef: localRef, mediaRef: team.mediaRef }))
    expect(watch).not.toHaveBeenCalled()
  })
  it('does not offer ordinary file copying and disables unsupported video copying', async () => {
    await mount({ ...video, kind: 'file' })
    expect(view!.root.findAllByProps({ 'aria-label': '复制视频' })).toHaveLength(0)
    bridge.supported = false
    await act(async () => { view!.update(<Surface block={{ ...video, localFileRef: localRef }} />) })
    expect(view!.root.findByProps({ 'aria-label': '复制视频' }).props.disabled).toBe(true)
    await click()
    expect(bridge.begin).not.toHaveBeenCalled()
    expect(bridge.copy).not.toHaveBeenCalled()
  })
  it('uses the opener bridge for a separate preview document', async () => {
    const child = { defaultView: { navigator: {} } } as unknown as Document
    await act(async () => { view = create(<AttachmentPreviewSurface.Provider value={child}><Surface block={{ ...video, localFileRef: localRef }} /></AttachmentPreviewSurface.Provider>) })
    await click(); expect(bridge.copy).toHaveBeenCalledOnce()
  })
  it('also offers video copying in the fallback file viewer without adding file copying', async () => {
    vi.stubGlobal('document', { body: {}, activeElement: null })
    await act(async () => { view = create(<ArkmeFileViewer block={{ ...video, localFileRef: localRef }} onClose={() => {}} />) })
    await click(); expect(bridge.copy).toHaveBeenCalledOnce()
  })
  it('deduplicates repeated clicks and lets a native failure be retried', async () => {
    let reject!: (reason: unknown) => void
    bridge.copy.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail }))
    await mount({ ...video, localFileRef: localRef }); await click(); await click()
    expect(bridge.begin).toHaveBeenCalledOnce()
    expect(bridge.copy).toHaveBeenCalledOnce()
    await act(async () => { reject(new Error('clipboard changed')) })
    expect(notice).toHaveBeenLastCalledWith({ kind: 'error', message: '复制失败' })
    expect(view!.root.findByProps({ 'aria-label': '复制视频' }).props.disabled).toBe(false)
    await click(); expect(bridge.copy).toHaveBeenCalledTimes(2)
  })
  it.each(['account', 'logout', 'scope', 'selection', 'unmount'] as const)('cancels a late native result after %s changes', async change => {
    let done!: (value: { copied: true }) => void
    bridge.copy.mockImplementationOnce(() => new Promise(resolve => { done = resolve }))
    const block = { ...video, localFileRef: localRef }
    await mount(block, { url: () => '/same-video', readScopeKey: 'scope-a' }); await click()
    const requestId = bridge.begin.mock.calls[0]![0].requestId
    await act(async () => {
      if (change === 'account') arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 43 })
      if (change === 'logout') arkmeAuthStore.setAuth({ status: 'logged-out', environment: 'test' })
      if (change === 'scope') view!.update(<Surface block={block} access={{ url: () => '/same-video', readScopeKey: 'scope-b' }} />)
      if (change === 'selection') view!.update(<Surface block={{ ...block, mediaRef: 'next-video', localFileRef: 'next-local' }} />)
      if (change === 'unmount') { view!.unmount(); view = undefined }
    })
    expect(bridge.cancel).toHaveBeenCalledWith(requestId)
    await act(async () => { done({ copied: true }) })
    expect(notice.mock.calls.some(([value]) => value.kind === 'success')).toBe(false)
  })
  it('cleans reception observers on abort and never copies a later ready result', async () => {
    receive.mockResolvedValueOnce(missing).mockResolvedValue({ ...missing, state: 'receiving' })
    await mount(); await click()
    await act(async () => { view!.unmount(); view = undefined })
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000) })
    expect(bridge.copy).not.toHaveBeenCalled()
    expect(receive).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('does not start reception when native reservation fails', async () => {
    bridge.begin.mockRejectedValueOnce(new Error('unsupported'))
    await mount(); await click()
    expect(receive.mock.calls.map(call => call[1])).toEqual([false])
    expect(bridge.copy).not.toHaveBeenCalled()
    expect(notice).toHaveBeenLastCalledWith({ kind: 'error', message: '复制失败' })
  })
  it('reports a failed reception read immediately and retries through the same owner', async () => {
    receive.mockResolvedValueOnce(missing).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(ready)
    await mount(); await click()
    expect(bridge.copy).not.toHaveBeenCalled()
    expect(notice).toHaveBeenLastCalledWith({ kind: 'error', message: '复制失败' })
    expect(view!.root.findByProps({ 'aria-label': '复制视频' }).props.disabled).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
    await click()
    expect(bridge.copy).toHaveBeenCalledOnce()
  })
  it('cancels a pending reservation before any download can start', async () => {
    let begin!: () => void
    bridge.begin.mockImplementationOnce(() => new Promise<void>(resolve => { begin = resolve }))
    await mount(); await click()
    await act(async () => { view!.unmount(); view = undefined })
    expect(bridge.cancel).toHaveBeenCalledWith(bridge.begin.mock.calls[0]![0].requestId)
    await act(async () => { begin() })
    expect(receive.mock.calls.map(call => call[1])).toEqual([false])
    expect(bridge.copy).not.toHaveBeenCalled()
  })
  it('does not claim success for a malformed native result', async () => {
    bridge.copy.mockResolvedValueOnce({ copied: false })
    await mount({ ...video, localFileRef: localRef }); await click()
    expect(notice).toHaveBeenLastCalledWith({ kind: 'error', message: '复制失败' })
  })
})
