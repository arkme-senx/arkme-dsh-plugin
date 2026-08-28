import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it } from 'vitest'
import { ArkmeMessageContent } from '../src/client/ArkmeRichContent.js'
import type { ArkmeTimelineItem } from '../src/types.js'

const complete: ArkmeTimelineItem = {
  itemUid: 'file-record', senderName: 'sender', isMe: false, sendAtMillis: 1,
  title: 'report.pdf', textContent: '', status: 1, version: 7,
  contentBlocks: [{ kind: 'file', mediaRef: 'remote-file', fileAssetUid: 'asset', fileName: 'report.pdf', mimeType: 'application/pdf', size: 100, sortOrder: 0 }],
}
const unavailable: ArkmeTimelineItem = { ...complete, contentBlocks: [], mediaUnavailable: true }
const cardCount = (view: ReactTestRenderer) => view.root.findAll(node => node.type === 'button' && node.props['data-arkme-file-card'] === 'file').length

describe('file message refresh stability', () => {
  it('keeps a mounted file card through a same-version media lookup failure and recovery', async () => {
    let view!: ReactTestRenderer
    const counts: number[] = []
    for (const item of [complete, unavailable, complete]) {
      await act(async () => { if (view === undefined) view = create(<ArkmeMessageContent sourceRef="source-a" item={item} />); else view.update(<ArkmeMessageContent sourceRef="source-a" item={item} />) })
      counts.push(cardCount(view))
    }
    await act(async () => view.unmount())
    expect(counts).toEqual([1, 1, 1])
  })
  it.each([
    ['authoritative attachment removal', { ...complete, contentBlocks: [] }, 'source-a'],
    ['newer record revision', { ...unavailable, version: 8 }, 'source-a'],
    ['unknown revision', { ...unavailable, version: undefined }, 'source-a'],
    ['deleted record', { ...unavailable, status: 2 }, 'source-a'],
    ['another record', { ...unavailable, itemUid: 'other-record' }, 'source-a'],
    ['another source', unavailable, 'source-b'],
  ])('does not retain old media for %s', async (_name, next, sourceRef) => {
    let view!: ReactTestRenderer
    await act(async () => { view = create(<ArkmeMessageContent sourceRef="source-a" item={complete} />) })
    await act(async () => { view.update(<ArkmeMessageContent sourceRef={sourceRef} item={next} />) })
    expect(cardCount(view)).toBe(0)
    await act(async () => view.unmount())
  })
  it('replaces retained references on recovery and does not resurrect removed media later', async () => {
    let view!: ReactTestRenderer
    await act(async () => { view = create(<ArkmeMessageContent item={complete} />) })
    await act(async () => { view.update(<ArkmeMessageContent item={unavailable} />) })
    expect(cardCount(view)).toBe(1)
    expect(JSON.stringify(view.toJSON())).toContain('部分媒体暂时无法加载')
    await act(async () => { view.update(<ArkmeMessageContent item={{ ...complete, contentBlocks: [{ ...complete.contentBlocks![0]!, fileName: 'recovered.pdf', mediaRef: 'renewed-ref' }] }} />) })
    expect(JSON.stringify(view.toJSON())).toContain('recovered.pdf')
    await act(async () => { view.update(<ArkmeMessageContent item={{ ...complete, contentBlocks: [] }} />) })
    await act(async () => { view.update(<ArkmeMessageContent item={unavailable} />) })
    expect(cardCount(view)).toBe(0)
    await act(async () => view.unmount())
  })
})

describe('visual media failure stability', () => {
  const visualItem = (kind: 'image' | 'video', version = 1): ArkmeTimelineItem => ({
    itemUid: `visual-${kind}`, senderName: 'sender', isMe: false, sendAtMillis: 1,
    title: '', textContent: '', status: 1, version,
    contentBlocks: [{
      kind, mediaRef: `visual-${kind}-ref`, fileName: kind === 'image' ? 'photo.jpg' : 'movie.mp4',
      mimeType: kind === 'image' ? 'image/jpeg' : 'video/mp4', size: 100, sortOrder: 0,
    }],
  })

  it.each(['image', 'video'] as const)('keeps a failed %s in its visual presentation and retries it', async kind => {
    let view!: ReactTestRenderer
    await act(async () => { view = create(<ArkmeMessageContent sourceRef="source-a" item={visualItem(kind)} />) })
    const mediaType = kind === 'image' ? 'img' : 'video'
    const media = view.root.findAll(node => node.type === mediaType && typeof node.props.onError === 'function')[0]!
    await act(async () => { media.props.onError(kind === 'video' ? { currentTarget: { error: { code: 2 } } } : undefined) })

    expect(view.root.findAll(node => node.props['data-arkme-file-card'] === 'fallback')).toHaveLength(0)
    expect(view.root.findAll(node => node.props['data-arkme-media-fallback'] === kind)).toHaveLength(1)
    const retry = view.root.findByProps({ 'aria-label': `重新加载${kind === 'image' ? '图片' : '视频'} ${visualItem(kind).contentBlocks![0]!.fileName}` })
    await act(async () => { retry.props.onClick() })

    expect(view.root.findAll(node => node.props['data-arkme-media-fallback'] === kind)).toHaveLength(0)
    const retried = view.root.findAll(node => node.type === mediaType && typeof node.props.onError === 'function')[0]!
    expect(retried.props.src).toContain('retry=1')
    await act(async () => view.unmount())
  })

  it.each(['image', 'video'] as const)('clears stale %s failure state when the record refreshes', async kind => {
    let view!: ReactTestRenderer
    await act(async () => { view = create(<ArkmeMessageContent sourceRef="source-a" item={visualItem(kind)} />) })
    const mediaType = kind === 'image' ? 'img' : 'video'
    await act(async () => { view.root.findAll(node => node.type === mediaType && typeof node.props.onError === 'function')[0]!.props.onError(kind === 'video' ? { currentTarget: { error: { code: 2 } } } : undefined) })
    await act(async () => { view.update(<ArkmeMessageContent sourceRef="source-a" item={visualItem(kind, 2)} />) })

    expect(view.root.findAll(node => node.props['data-arkme-media-fallback'] === kind)).toHaveLength(0)
    expect(view.root.findAll(node => node.type === mediaType && (kind === 'video' || node.props.alt === visualItem(kind).contentBlocks![0]!.fileName))).toHaveLength(1)
    await act(async () => view.unmount())
  })

  it('offers file reception instead of an endless retry for an unsupported video codec', async () => {
    let view!: ReactTestRenderer
    await act(async () => { view = create(<ArkmeMessageContent sourceRef="source-a" item={visualItem('video')} />) })
    const video = view.root.findAll(node => node.type === 'video' && typeof node.props.onError === 'function')[0]!
    await act(async () => { video.props.onError({ currentTarget: { error: { code: 4 } } }) })

    expect(view.root.findAll(node => node.props['aria-label'] === '重新加载视频 movie.mp4')).toHaveLength(0)
    const receive = view.root.findByProps({ 'aria-label': '接收视频 movie.mp4' })
    expect(receive.props['data-arkme-media-fallback']).toBe('video-unsupported')
    expect(receive.props.onClick).toEqual(expect.any(Function))
    await act(async () => view.unmount())
  })

  it.each([
    ['image', 'photo.heic', 'image/heic', '接收图片 photo.heic', 'image-unsupported'],
    ['image', 'diagram.svg', 'image/svg+xml', '接收图片 diagram.svg', 'image-unsupported'],
    ['video', 'movie.mkv', 'video/x-matroska', '接收视频 movie.mkv', 'video-unsupported'],
  ] as const)('keeps browser-unsupported %s media in its media-shaped reception state', async (kind, fileName, mimeType, label, fallback) => {
    const item = visualItem(kind)
    item.contentBlocks = [{ ...item.contentBlocks![0]!, fileName, mimeType }]
    let view!: ReactTestRenderer
    await act(async () => { view = create(<ArkmeMessageContent sourceRef="source-a" item={item} />) })
    const mediaType = kind === 'image' ? 'img' : 'video'
    const media = view.root.findAll(node => node.type === mediaType && typeof node.props.onError === 'function')[0]!
    await act(async () => { media.props.onError(kind === 'video' ? { currentTarget: { error: { code: 4 } } } : undefined) })

    const receive = view.root.findByProps({ 'aria-label': label })
    expect(receive.props['data-arkme-media-fallback']).toBe(fallback)
    expect(view.root.findAll(node => node.props['data-arkme-file-card'] === 'file')).toHaveLength(0)
    expect(view.root.findAll(node => node.type === mediaType)).toHaveLength(0)
    await act(async () => view.unmount())
  })
})
