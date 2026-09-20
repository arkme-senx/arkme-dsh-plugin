import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ArkmeRecordReeditSubmissionView } from '../src/record-reedit-contract.js'
import type { ArkmeTimelineItem } from '../src/types.js'
import { ArkmeMessageContent } from '../src/client/ArkmeRichContent.js'
import { projectRecordReedit } from '../src/client/record-reedit-submissions.js'
import { MediaService } from '../src/services/media-service.js'

describe('re-edit candidate media completeness', () => {
  let renderer: ReactTestRenderer | undefined
  afterEach(() => { act(() => { renderer?.unmount() }); renderer = undefined })

  it('uses a renewed image capability after a Host restart while retaining the other same-version image', async () => {
    const runtime = { config: { environment: 'test' }, requireSession: async () => ({ userId: 42 }),
      fetchImpl: vi.fn(async () => new Response('image-bytes')) }
    const media = () => new MediaService(runtime as never, {} as never, {} as never, { recordUid: () => 'r' })
    const display = ['a', 'b'].map((id, sort_order) => ({ file_asset_uid: id, file_name: `${id}.png`,
      file_kind: 1, mime_type: 'image/png', size: 10, sort_order,
      download_url: `https://jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com/${id}.png` }))
    const raw = { record_core: { record_uid: 'r', content_payload: {
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
    const original: ArkmeTimelineItem = { itemUid: 'r', title: '', textContent: '', status: 1, sendAtMillis: 1,
      recordVersion: 8, mediaUnavailable: false, contentBlocks: oldBlocks }
    act(() => { renderer = create(<ArkmeMessageContent item={original} sourceRef="source" />) })
    act(() => { renderer!.update(<ArkmeMessageContent item={{ ...original, mediaUnavailable: true,
      contentBlocks: freshBlocks }} sourceRef="source" />) })
    const images = renderer!.root.findAllByType('img')
    expect(images).toHaveLength(2)
    expect(images[0]!.props.src).toContain(encodeURIComponent(freshBlocks[0]!.mediaRef))
    expect(images[1]!.props.src).toContain(encodeURIComponent(oldBlocks[1]!.mediaRef))
    expect(JSON.stringify(renderer!.toJSON())).toContain('部分媒体暂时无法加载')
  })

  it('accumulates same-version partial image reads without claiming a complete response', () => {
    const blocks = ['a', 'b'].map((id, sortOrder) => ({ kind: 'image' as const, fileAssetUid: id,
      mediaRef: `fresh-${id}`, fileName: `${id}.png`, mimeType: 'image/png', size: 10, sortOrder }))
    const partial: ArkmeTimelineItem = { itemUid: 'r', title: '', textContent: '', status: 1, sendAtMillis: 1,
      recordVersion: 8, mediaUnavailable: true, contentBlocks: blocks.slice(0, 1) }
    act(() => { renderer = create(<ArkmeMessageContent item={partial} sourceRef="source" />) })
    for (const contentBlocks of [blocks.slice(1), [], blocks.slice(0, 1)]) {
      act(() => { renderer!.update(<ArkmeMessageContent item={{ ...partial, contentBlocks }} sourceRef="source" />) })
      expect(renderer!.root.findAllByType('img').map(image => image.props.src))
        .toEqual(blocks.map(block => `/arkme-self/api/media?ref=${block.mediaRef}`))
      expect(JSON.stringify(renderer!.toJSON())).toContain('部分媒体暂时无法加载')
    }
  })

  it.each(['explicit-empty', 'new-version', 'deleted', 'other-record', 'other-source'] as const)(
    'does not carry retained same-version images into %s', boundary => {
      const block = { kind: 'image' as const, fileAssetUid: 'a', mediaRef: 'old-a', fileName: 'a.png',
        mimeType: 'image/png', size: 10, sortOrder: 0 }
      const original: ArkmeTimelineItem = { itemUid: 'r', title: '', textContent: '', status: 1, sendAtMillis: 1,
        recordVersion: 8, mediaUnavailable: true, contentBlocks: [block] }
      act(() => { renderer = create(<ArkmeMessageContent item={original} sourceRef="source" />) })
      const incoming = { ...original, contentBlocks: [],
        ...(boundary === 'new-version' ? { recordVersion: 9 } : {}),
        ...(boundary === 'deleted' ? { status: -1 } : {}),
        ...(boundary === 'other-record' ? { itemUid: 'other' } : {}),
      }
      act(() => { renderer!.update(<ArkmeMessageContent item={incoming}
        sourceRef={boundary === 'other-source' ? 'other-source' : 'source'}
        mediaSelectionIsExplicit={boundary === 'explicit-empty'} />) })
      expect(renderer!.root.findAllByType('img')).toHaveLength(0)
    },
  )

  it('retains an already loaded subset through an empty failed read without mistaking it for complete media', () => {
    const blocks = ['a', 'b'].map((id, sortOrder) => ({ kind: 'image' as const, mediaRef: id,
      fileAssetUid: id, fileName: `${id}.png`, mimeType: 'image/png', size: 10, sortOrder }))
    const partial: ArkmeTimelineItem = { itemUid: 'r', title: '', textContent: '', status: 1, sendAtMillis: 1,
      recordVersion: 8, mediaUnavailable: true, contentBlocks: blocks.slice(0, 1) }
    act(() => { renderer = create(<ArkmeMessageContent item={partial} sourceRef="source" />) })
    act(() => { renderer!.update(<ArkmeMessageContent item={{ ...partial, contentBlocks: [] }} sourceRef="source" />) })
    expect(renderer!.root.findAllByType('img')).toHaveLength(1)
    act(() => { renderer!.update(<ArkmeMessageContent item={{ ...partial, contentBlocks: [] }} sourceRef="source" />) })
    expect(renderer!.root.findAllByType('img')).toHaveLength(1)
    act(() => { renderer!.update(<ArkmeMessageContent item={{ ...partial, contentBlocks: blocks }} sourceRef="source" />) })
    expect(renderer!.root.findAllByType('img')).toHaveLength(2)
  })

  it('does not retain incomplete media or carry complete media across versions or sources', () => {
    const blocks = ['a', 'b'].map((id, sortOrder) => ({ kind: 'image' as const, mediaRef: id,
      fileAssetUid: id, fileName: `${id}.png`, mimeType: 'image/png', size: 10, sortOrder }))
    const base: ArkmeTimelineItem = { itemUid: 'r', title: '', textContent: '', status: 1, sendAtMillis: 1,
      recordVersion: 8, mediaUnavailable: true, contentBlocks: blocks.slice(0, 1) }
    act(() => { renderer = create(<ArkmeMessageContent item={base} sourceRef="source" />) })
    act(() => { renderer!.update(<ArkmeMessageContent item={{ ...base, contentBlocks: blocks }} sourceRef="source" />) })
    expect(renderer!.root.findAllByType('img')).toHaveLength(2)
    act(() => { renderer!.update(<ArkmeMessageContent item={{ ...base, contentBlocks: blocks, mediaUnavailable: false }} sourceRef="source" />) })
    act(() => { renderer!.update(<ArkmeMessageContent item={{ ...base, recordVersion: 9 }} sourceRef="source" />) })
    expect(renderer!.root.findAllByType('img')).toHaveLength(1)
    act(() => { renderer!.update(<ArkmeMessageContent item={{ ...base, contentBlocks: blocks, mediaUnavailable: false }} sourceRef="source" />) })
    act(() => { renderer!.update(<ArkmeMessageContent item={base} sourceRef="other-source" />) })
    expect(renderer!.root.findAllByType('img')).toHaveLength(1)
  })

  it('keeps two images through commit, partial media, acknowledgement and a later partial same-version read', () => {
    const blocks = ['a', 'b'].map((id, sortOrder) => ({ kind: 'image' as const, mediaRef: id,
      fileAssetUid: id, fileName: `${id}.png`, mimeType: 'image/png', size: 10, sortOrder }))
    const original: ArkmeTimelineItem = { itemUid: 'record', title: '', textContent: '',
      status: 1, sendAtMillis: 1, recordVersion: 7, contentBlocks: blocks.slice(0, 1) }
    const pending: ArkmeRecordReeditSubmissionView = { submissionId: 's', itemUid: original.itemUid,
      state: 'pending', baseVersion: 7, title: '', textContent: '', attachments: blocks.map(block => ({
        selection: { fileAssetUid: block.fileAssetUid }, block,
        asset: { fileAssetUid: block.fileAssetUid, fileName: block.fileName, mimeType: block.mimeType, size: 10, fileKind: 1 },
      })) }
    const committed: ArkmeRecordReeditSubmissionView = { ...pending, state: 'committed', result: {
      status: 'committed', itemUid: original.itemUid, version: 8, revisionUid: 'revision', projectionState: 'pending',
    } }
    const partial = { ...original, recordVersion: 8, mediaUnavailable: true }
    const full = { ...partial, mediaUnavailable: false, contentBlocks: blocks }
    const steps = [projectRecordReedit(original, [pending]), projectRecordReedit(partial, [committed]), full, partial, partial]
    for (const item of steps) {
      act(() => {
        const element = <ArkmeMessageContent item={item} sourceRef="source" />
        if (renderer) renderer.update(element)
        else renderer = create(element)
      })
      expect(renderer!.root.findAllByType('img')).toHaveLength(2)
    }
    act(() => { renderer!.update(<ArkmeMessageContent item={{ ...full, contentBlocks: [] }} sourceRef="source" />) })
    expect(renderer!.root.findAllByType('img')).toHaveLength(0)
  })

  it.each(['pending', 'committed'] as const)('shows an explicit attachment removal while %s instead of restoring stale media', state => {
    const original: ArkmeTimelineItem = {
      itemUid: 'record', senderName: '我', isMe: true, title: '', textContent: '原文',
      recordVersion: 7, version: 5, status: 1, sendAtMillis: 1,
      contentBlocks: [{ kind: 'image', mediaRef: 'authorized-media', fileAssetUid: 'asset-original',
        fileName: 'removed.png', mimeType: 'image/png', size: 10, sortOrder: 0 }],
    }
    act(() => { renderer = create(<ArkmeMessageContent item={original} sourceRef="source" />) })
    const sparse = { ...original, contentBlocks: [], mediaUnavailable: true }
    act(() => { renderer!.update(<ArkmeMessageContent item={sparse} sourceRef="source" />) })
    expect(renderer!.root.findAllByType('img')).toHaveLength(1)

    const job: ArkmeRecordReeditSubmissionView = {
      submissionId: 'submission', itemUid: original.itemUid, state, baseVersion: 7,
      title: '', textContent: '保留正文并移除图片', attachments: [],
      ...(state === 'committed' ? { result: { status: 'committed', itemUid: original.itemUid,
        version: 8, revisionUid: 'revision', projectionState: 'pending' } } : {}),
    }
    const projected = projectRecordReedit(sparse, [job])
    act(() => { renderer!.update(<ArkmeMessageContent item={projected} sourceRef="source" />) })
    expect(renderer!.root.findAllByType('img')).toHaveLength(0)
    expect(projected).toMatchObject({ recordVersion: 7, version: 5, sendAtMillis: 1 })
  })

  it.each(['pending', 'committed'] as const)('does not revive removed images when a %s candidate is missing only its main voice', state => {
    const original: ArkmeTimelineItem = { itemUid: 'record', title: '', textContent: '原文',
      templateKind: 4, status: 1, sendAtMillis: 1, recordVersion: 7,
      contentBlocks: [
        { kind: 'image', mediaRef: 'image-ref', fileAssetUid: 'image', fileName: 'removed.png', mimeType: 'image/png', size: 10, sortOrder: 0 },
        { kind: 'audio', mediaRef: 'voice-ref', fileAssetUid: 'voice', fileName: 'voice.m4a', mimeType: 'audio/mp4', size: 10, sortOrder: 1 },
      ] }
    act(() => { renderer = create(<ArkmeMessageContent item={original} sourceRef="source" />) })
    expect(renderer!.root.findAllByType('img')).toHaveLength(1)

    const sparse = { ...original, contentBlocks: [], mediaUnavailable: true }
    const job: ArkmeRecordReeditSubmissionView = { submissionId: 'submission', itemUid: 'record',
      baseVersion: 7, state, title: '', textContent: '保留主语音并移除图片', attachments: [], voiceFileAssetUid: 'voice',
      ...(state === 'committed' ? { result: { status: 'committed', itemUid: 'record', version: 8,
        revisionUid: 'revision', projectionState: 'pending' } } : {}) }
    const projected = projectRecordReedit(sparse, [job])
    expect(projected.mediaUnavailable).toBe(true)
    const selectionProps = { mediaSelectionIsExplicit: projected !== sparse }
    act(() => { renderer!.update(<ArkmeMessageContent item={projected} sourceRef="source" {...selectionProps} />) })
    expect(renderer!.root.findAllByType('img')).toHaveLength(0)
  })
})
