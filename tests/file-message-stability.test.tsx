import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { ArkmeMessageContent, ArkmeMediaPreview } from '../src/client/ArkmeRichContent.js'
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


vi.mock('react-dom', async importOriginal => ({
  ...await importOriginal<typeof import('react-dom')>(),
  createPortal: (children: unknown) => children,
}))

describe('open preview follows current message media', () => {
  it.each(['asset', 'reference'] as const)('refreshes Live metadata by %s and does not reopen removed attachments', async identity => {
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
    vi.stubGlobal('document', { body: { style: { overflow: '' } } })
    const cover = { kind: 'image' as const, mediaRef: 'cover', ...(identity === 'asset' ? { fileAssetUid: 'cover-asset' } : {}), fileName: 'photo.jpg', mimeType: 'image/jpeg', size: 1, sortOrder: 0 }
    const item = { ...complete, title: '', contentBlocks: [cover] }
    let view: ReactTestRenderer | undefined
    try {
      await act(async () => { view = create(<ArkmeMessageContent sourceRef="source-a" item={item} />) })
      await act(async () => view!.root.findByProps({ 'aria-label': '预览图片 photo.jpg' }).props.onClick())
      expect(view!.root.findByType(ArkmeMediaPreview).props.selected.dynamicPhoto).toBeUndefined()
      const updated = { ...cover, mediaRef: identity === 'asset' ? 'renewed-cover' : cover.mediaRef, dynamicPhoto: { logicalUid: 'pair' } }
      await act(async () => view!.update(<ArkmeMessageContent sourceRef="source-a" item={{ ...item, contentBlocks: [updated] }} />))
      expect(view!.root.findByType(ArkmeMediaPreview).props.selected).toBe(updated)
      expect(view!.root.findByProps({ 'data-arkme-live-photo-control': true }).props.disabled).toBe(true)
      const motion = { kind: 'video' as const, mediaRef: 'motion', localFileRef: 'arkme-file-v1.11111111-1111-4111-8111-111111111111', fileName: 'motion.mp4', mimeType: 'video/mp4', size: 1, sortOrder: 1 }
      const ready = { ...updated, dynamicPhoto: { logicalUid: 'pair', motion } }
      await act(async () => view!.update(<ArkmeMessageContent sourceRef="source-a" item={{ ...item, contentBlocks: [ready] }} />))
      expect(view!.root.findByProps({ 'data-arkme-live-photo-control': true }).props.disabled).toBe(false)
      await act(async () => view!.update(<ArkmeMessageContent sourceRef="source-a" item={{ ...item, contentBlocks: [] }} />))
      expect(view!.root.findAllByType(ArkmeMediaPreview)).toHaveLength(0)
      await act(async () => view!.update(<ArkmeMessageContent sourceRef="source-a" item={item} />))
      expect(view!.root.findAllByType(ArkmeMediaPreview)).toHaveLength(0)
      for (const [nextSource, nextItem] of [
        ['source-b', item],
        ['source-a', { ...item, itemUid: 'other-record' }],
        ['source-a', { ...item, status: 2 }],
      ] as const) {
        await act(async () => view!.update(<ArkmeMessageContent sourceRef="source-a" item={item} />))
        await act(async () => view!.root.findByProps({ 'aria-label': '预览图片 photo.jpg' }).props.onClick())
        expect(view!.root.findAllByType(ArkmeMediaPreview)).toHaveLength(1)
        await act(async () => view!.update(<ArkmeMessageContent sourceRef={nextSource} item={nextItem} />))
        expect(view!.root.findAllByType(ArkmeMediaPreview)).toHaveLength(0)
      }
    } finally {
      if (view) await act(async () => view!.unmount())
      vi.unstubAllGlobals()
    }
  })
})


describe('stable conversation media identity', () => {
  it.each(['refresh', 'local-original', 'partial-media', 'new-version', 'unknown-version', 'explicit-removal', 'other-conversation', 'other-message', 'deleted', 'removed'] as const)(
    'keeps access-reference rotation separate from %s', async boundary => {
      vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
      vi.stubGlobal('document', { body: { style: { overflow: '' } } })
      const cover = { kind: 'image' as const, mediaRef: 'cover', fileAssetUid: 'asset',
        fileName: 'photo.jpg', mimeType: 'image/jpeg', size: 1, sortOrder: 0 }
      const item = { ...complete, title: '', contentBlocks: [cover] }
      let view: ReactTestRenderer | undefined
      try {
        await act(async () => { view = create(<ArkmeMessageContent sourceRef="old-ref" sourceIdentityKey="chat-a" item={item} />) })
        await act(async () => view!.root.findByProps({ 'aria-label': '预览图片 photo.jpg' }).props.onClick())
        expect(view!.root.findAllByType(ArkmeMediaPreview)).toHaveLength(1)
        const next = { ...item,
          ...(boundary === 'refresh' ? { contentBlocks: [{ ...cover, mediaRef: 'fresh-cover' }] } : {}),
          ...(boundary === 'local-original' ? { contentBlocks: [{ ...cover, localFileRef: 'arkme-file-v1.11111111-1111-4111-8111-111111111111' }] } : {}),
          ...(['partial-media', 'new-version', 'unknown-version', 'explicit-removal'].includes(boundary) ? { contentBlocks: [], mediaUnavailable: true } : {}),
          ...(boundary === 'new-version' ? { version: 8 } : {}),
          ...(boundary === 'unknown-version' ? { version: undefined } : {}),
          ...(boundary === 'other-message' ? { itemUid: 'other' } : {}),
          ...(boundary === 'deleted' ? { status: 2 } : {}),
          ...(boundary === 'removed' ? { contentBlocks: [] } : {}),
        }
        await act(async () => view!.update(<ArkmeMessageContent sourceRef="new-ref"
          sourceIdentityKey={boundary === 'other-conversation' ? 'chat-b' : 'chat-a'}
          mediaSelectionIsExplicit={boundary === 'explicit-removal'} item={next} />))
        const remainsOpen = boundary === 'refresh' || boundary === 'partial-media' || boundary === 'local-original'
        expect(view!.root.findAllByType(ArkmeMediaPreview)).toHaveLength(remainsOpen ? 1 : 0)
        if (remainsOpen) {
          expect(view!.root.findByType(ArkmeMediaPreview).props.selected.mediaRef)
            .toBe(boundary === 'refresh' ? 'fresh-cover' : 'cover')
          await act(async () => view!.root.findByType(ArkmeMediaPreview).props.onClose())
        }
        await act(async () => view!.update(<ArkmeMessageContent sourceRef="latest-ref" sourceIdentityKey="chat-a" item={item} />))
        expect(view!.root.findAllByType(ArkmeMediaPreview)).toHaveLength(0)
      } finally {
        if (view) await act(async () => view!.unmount())
        vi.unstubAllGlobals()
      }
    },
  )
})
