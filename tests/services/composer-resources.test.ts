import { describe, expect, it, vi } from 'vitest'
import { SearchService } from '../../src/services/search-service.js'
import { prepareComposerDocument } from '../../src/services/composer-document.js'
const runtime = (user = 42) => ({ requireSession: async () => ({ userId: user }) })
const record = (uid: string, owner = 42, creator = 42) => ({ recordUid: uid, recordOwnerUserId: owner, recordCreatorUserId: creator, sendAtMillis: 1,
  files: [{ fileAssetUid: uid, fileName: `${uid}.pdf`, fileKind: 4, size: 1 }], media: [{ fileAssetUid: uid, fileName: `${uid}.png`, fileKind: 1, mimeType: 'image/png', size: 2 }] })
describe('owned composer resources', () => {
  it('filters other owners and imported creators on the Host, retaining pagination', async () => {
    const media = { queryFileAssets: vi.fn(async () => []), issueSearchFileMediaRefs: vi.fn(async () => new Map([['mine\0mine', 'media-ref']])) }
    const service = new SearchService(runtime() as never, {} as never, media as never)
    vi.spyOn(service, 'searchScene').mockResolvedValue({ items: [record('mine'), record('other', 9), record('copy', 42, 9)], hasMore: true, nextCursor: 'next' } as never)
    const page = await service.composerResources({ kind: 'file', limit: 30, expectedUserId: 42 })
    expect(page).toMatchObject({ items: [{ recordUid: 'mine', asset: { fileAssetUid: 'mine', fileKind: 4 }, mediaRef: 'media-ref' }], hasMore: true, nextCursor: 'next' })
    expect(page.items).toHaveLength(1)
    expect(media.issueSearchFileMediaRefs).toHaveBeenCalledWith([{ recordUid: 'mine', fileAssetUid: 'mine' }], undefined)
    await expect(service.composerResources({ kind: 'file', limit: 30, expectedUserId: 9 })).rejects.toMatchObject({ code: 'file-account-changed' })
  })
  it('queries gallery and keyword search using the same owned filter', async () => {
    const service = new SearchService(runtime() as never, {} as never, { queryFileAssets: async () => [], issueSearchFileMediaRefs: async () => new Map() } as never)
    const scene = vi.spyOn(service, 'searchScene').mockResolvedValue({ items: [record('image')], hasMore: false } as never)
    const search = vi.spyOn(service, 'searchRemote').mockResolvedValue({ items: [record('file')], hasMore: false } as never)
    expect((await service.composerResources({ kind: 'gallery', limit: 30, expectedUserId: 42 })).items[0]?.asset.fileKind).toBe(1)
    expect(scene).toHaveBeenCalledWith(expect.objectContaining({ scene: 'image_video' }))
    await service.composerResources({ kind: 'file', query: '查找', limit: 30, expectedUserId: 42 })
    expect(search).toHaveBeenCalledWith(expect.objectContaining({ query: '查找' }))
  })
  it('hydrates legacy gallery hits that contain only an asset UID and name', async () => {
    const service = new SearchService(runtime() as never, {} as never, {
      queryFileAssets: async () => [{ fileAssetUid: 'legacy', mimeType: 'image/jpeg', size: 123, previewUrl: 'https://record.test/thumb.jpg' }],
      issueImageMediaRef: () => 'thumbnail-ref', issueSearchFileMediaRefs: async () => new Map([['legacy-record\0legacy', 'original-ref']]),
    } as never)
    vi.spyOn(service, 'searchScene').mockResolvedValue({ items: [{ ...record('legacy-record'), media: [{ fileAssetUid: 'legacy', fileName: '旧图片.jpg' }] }], hasMore: false } as never)
    expect((await service.composerResources({ kind: 'gallery', limit: 30, expectedUserId: 42 })).items).toMatchObject([
      { asset: { fileAssetUid: 'legacy', mimeType: 'image/jpeg', fileKind: 1, size: 123 }, thumbnailRef: 'thumbnail-ref', mediaRef: 'original-ref' },
    ])
  })
  it('prepares an exact owned document snapshot and rejects version/account drift', async () => {
    const own = vi.fn(async () => ({ detail: { version: 3, title: '文档', textContent: '内容', textFormat: 'markdown', contentBlocks: [] } }))
    const ports = { own, local: vi.fn() }
    const prepared = await prepareComposerDocument(runtime() as never, { expectedUserId: 42, kind: 'existing', itemUid: 'doc', version: 3 }, ports as never)
    expect(prepared).toMatchObject({ fileRefs: [], content: { title: '文档', text_content: '内容', display_kind: 1, content_payload: { text_format: 'markdown' } } })
    await expect(prepareComposerDocument(runtime() as never, { expectedUserId: 42, kind: 'existing', itemUid: 'doc', version: 2 }, ports as never)).rejects.toThrow('已更新')
    await expect(prepareComposerDocument(runtime() as never, { expectedUserId: 9, kind: 'existing', itemUid: 'doc', version: 3 }, ports as never)).rejects.toThrow('账号已切换')
  })
  it('keeps new document image refs local until the durable send owner uploads them', async () => {
    const local = vi.fn(async () => ({ file: { fileKind: 1, mimeType: 'image/png' } }))
    const input = { expectedUserId: 42, kind: 'new' as const, title: '草稿', textContent: '![图](arkme-local:local-ref)', textFormat: 'markdown' as const, images: [{ fileRef: 'local-ref' }] }
    const prepared = await prepareComposerDocument(runtime() as never, input, { own: vi.fn(), local })
    expect(prepared).toMatchObject({ fileRefs: ['local-ref'], content: { display_kind: 1, text_content: input.textContent } })
    expect(local).toHaveBeenCalledWith('local-ref')
    await expect(prepareComposerDocument(runtime() as never, { ...input, images: [] }, { own: vi.fn(), local })).rejects.toThrow('图片尚未准备')
  })
})
