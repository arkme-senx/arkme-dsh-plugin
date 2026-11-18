import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ArkmeMessageContent } from '../src/client/ArkmeRichContent.js'
import { MediaService } from '../src/services/media-service.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { ArkmeMediaAccessContext } from '../src/client/media-access.js'
import type { ArkmeTimelineItem } from '../src/types.js'

const block = { kind: 'video' as const, fileAssetUid: 'clip-asset', mediaRef: 'clip-ref',
  fileName: 'clip.mp4', mimeType: 'video/mp4', size: 100, sortOrder: 0 }
const item: ArkmeTimelineItem = { itemUid: 'video-message', status: 1, sendAtMillis: 1,
  title: '', textContent: '', contentBlocks: [block] }
let view: ReactTestRenderer | undefined
afterEach(async () => { if (view) await act(async () => view!.unmount()); view = undefined; arkmeAuthStore.setAuth({ status: 'logged-out', environment: 'test' }); vi.unstubAllGlobals(); vi.useRealTimers() })

function videoNode(duration = 12) {
  const attributes = new Map<string, string>()
  return { duration, currentTime: 0, readyState: 1, videoWidth: 1920, videoHeight: 1080, seeking: false, error: null,
    pause: vi.fn(), load: vi.fn(),
    getAttribute: (key: string) => attributes.get(key) ?? null,
    setAttribute: vi.fn((key: string, value: string) => { attributes.set(key, value) }),
    removeAttribute: vi.fn((key: string) => { attributes.delete(key) }),
  }
}
async function mount(node: ReturnType<typeof videoNode>, value = item) {
  await act(async () => { view = create(<ArkmeMessageContent item={value} />,
    { createNodeMock: element => element.type === 'video' ? node : null }) })
}
async function metadata(node: ReturnType<typeof videoNode>) {
  await act(async () => view!.root.findByType('video').props.onLoadedMetadata?.({ currentTarget: node }))
}

describe('returning to a video message', () => {
  it('paints the prior thumbnail before a returning video decodes and drops it on a failed read', async () => {
    arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 42 })
    const canvas = { width: 0, height: 0, getContext: () => ({ drawImage: vi.fn() }), toDataURL: vi.fn(() => 'data:image/jpeg;base64,cached-frame') }
    vi.stubGlobal('document', { createElement: () => canvas })
    const node = videoNode()
    await mount(node)
    await metadata(node)
    node.readyState = 2
    await act(async () => view!.root.findByType('video').props.onSeeked?.({ currentTarget: node }))
    expect(canvas.toDataURL).toHaveBeenCalledOnce()
    expect(canvas.width).toBe(0)
    await act(async () => view!.unmount()); view = undefined
    await mount(videoNode())
    const poster = view!.root.findByType('img')
    expect(poster.props.src).toBe('data:image/jpeg;base64,cached-frame')
    expect(JSON.stringify(view!.toJSON())).toContain('00:12')
    const returned = view!.root.findByType('video')
    await act(async () => returned.props.onError({ currentTarget: videoNode() }))
    expect(view!.root.findAllByType('img')).toHaveLength(0)
    await act(async () => view!.unmount()); view = undefined
    await mount(videoNode())
    expect(view!.root.findAllByType('img')).toHaveLength(0)
  })

  it('never reuses a thumbnail after an account transition or for an independent read-state owner', async () => {
    arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 42 })
    const toDataURL = vi.fn(() => 'data:image/jpeg;base64,private-frame')
    vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ({ drawImage: vi.fn() }), toDataURL }) })
    const node = videoNode(); node.readyState = 2
    await mount(node)
    await act(async () => view!.root.findByType('video').props.onSeeked?.({ currentTarget: node }))
    expect(toDataURL).toHaveBeenCalledOnce()
    await act(async () => view!.unmount()); view = undefined
    arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 99 })
    await mount(videoNode())
    expect(view!.root.findAllByType('img')).toHaveLength(0)
    await act(async () => view!.unmount()); view = undefined
    arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 42 })
    await mount(videoNode())
    expect(view!.root.findAllByType('img')).toHaveLength(0)
    await act(async () => view!.update(<ArkmeMediaAccessContext.Provider value={{ url: () => '/independent', subscribeReadState: () => () => {} }}><ArkmeMessageContent item={item} /></ArkmeMediaAccessContext.Provider>))
    await act(async () => view!.root.findByType('video').props.onSeeked?.({ currentTarget: node }))
    expect(toDataURL).toHaveBeenCalledOnce()
  })

  it('requests a frame after metadata on both the first visit and A → B → A, and reads missing duration', async () => {
    for (let visit = 0; visit < 2; visit++) {
      const node = videoNode()
      await mount(node)
      await metadata(node)
      expect(node.currentTime).toBeGreaterThan(0)
      expect(node.currentTime).toBeLessThan(1)
      expect(JSON.stringify(view!.toJSON())).toContain('00:12')
      // Repeated metadata must not seek a second time or change the metadata preload policy.
      node.currentTime = 1
      await metadata(node)
      expect(node.currentTime).toBe(1)
      expect(view!.root.findByType('video').props.preload).toBe('metadata')
      await act(async () => view!.update(<div>conversation B</div>))
      expect(node.pause).toHaveBeenCalledOnce()
      expect(node.removeAttribute).toHaveBeenCalledWith('src')
      expect(node.load).toHaveBeenCalledOnce()
      await act(async () => view!.unmount()); view = undefined
    }
  })

  it('ignores a late metadata event after switching away and releases an unfinished request', async () => {
    const node = videoNode()
    await mount(node)
    const onMetadata = view!.root.findByType('video').props.onLoadedMetadata
    await act(async () => view!.update(<div>conversation B</div>))
    await act(async () => onMetadata?.({ currentTarget: node }))
    expect(node.currentTime).toBe(0)
    expect(node.removeAttribute).toHaveBeenCalledWith('src')
    expect(node.load).toHaveBeenCalledOnce()
  })

  it('keeps the existing failure/retry action and requests a fresh frame on retry', async () => {
    const node = videoNode()
    await mount(node)
    await act(async () => view!.root.findByType('video').props.onError({ currentTarget: node }))
    const fallback = view!.root.findByProps({ 'data-arkme-media-fallback': 'video' })
    expect(JSON.stringify(view!.toJSON())).toContain('视频加载失败，点击重试')
    await act(async () => fallback.props.onClick())
    expect(view!.root.findByType('video').props.src).toContain('retry=1')
    await metadata(node)
    expect(node.currentTime).toBeGreaterThan(0)
    expect(JSON.stringify(view!.toJSON())).toContain('00:12')
  })

  it.each([NaN, Infinity, 0])('does not seek invalid metadata duration %s or replace known message duration', async duration => {
    const node = videoNode(duration)
    await mount(node, { ...item, contentBlocks: [{ ...block, durationSec: 18 }] })
    await metadata(node)
    expect(node.currentTime).toBe(0)
    expect(JSON.stringify(view!.toJSON())).toContain('00:18')
  })
})

describe('video media projection identity', () => {
  it('retains the video element through receipt refresh, uses the refreshed grant, and keeps account and expiry checks', async () => {
    vi.useFakeTimers()
    let userId = 42
    const fetchImpl = vi.fn(async () => new Response('video', { status: 206 }))
    const runtime = { config: { environment: 'test' }, requireSession: async () => ({ userId }), fetchImpl }
    const media = new MediaService(runtime as never, {} as never, {} as never, { recordUid: () => '' })
    const project = (signature: string, asset = 'clip-asset') => media.richContentBlocks({ media_display_items: [{
      file_asset_uid: asset, file_name: 'clip.mp4', file_kind: 3, mime_type: 'video/mp4', size: 100,
      download_url: `https://jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com/${asset}.mp4?Signature=${signature}`,
    }] }, userId)[0]!
    const first = project('first')
    await mount(videoNode(), { ...item, contentBlocks: [first] })
    const element = view!.root.findByType('video')
    const second = project('refreshed')
    expect(second.mediaRef).toBe(first.mediaRef)
    await act(async () => view!.update(<ArkmeMessageContent item={{ ...item, contentBlocks: [second] }} />))
    expect(view!.root.findByType('video')).toBe(element)
    const abort = new AbortController()
    await media.fetchMedia(first.mediaRef, 'bytes=0-10', abort.signal)
    expect(fetchImpl).toHaveBeenCalledWith(new URL('https://jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com/clip-asset.mp4?Signature=refreshed'),
      expect.objectContaining({ headers: { Range: 'bytes=0-10' }, signal: abort.signal }))
    expect(project('other', 'other-asset').mediaRef).not.toBe(first.mediaRef)
    userId = 99
    expect(project('other-account').mediaRef).not.toBe(first.mediaRef)
    await expect(media.fetchMedia(first.mediaRef)).rejects.toMatchObject({ code: 'media-ref-invalid' })
    userId = 42
    const expiring = project('expiring')
    vi.advanceTimersByTime(30 * 60_000 + 1)
    await expect(media.fetchMedia(expiring.mediaRef)).rejects.toMatchObject({ code: 'media-ref-invalid' })
  })
})
