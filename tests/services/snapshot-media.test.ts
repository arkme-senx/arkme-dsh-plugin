import { describe, expect, it, vi } from 'vitest'
import { MediaService } from '../../src/services/media-service.js'

const session = { userId: 42, accessToken: 'test', refreshToken: 'test' }
const ref = (uid: string, extra = {}) => ({ file_asset_uid: uid, file_name: `${uid}.png`, mime_type: 'image/png', ...extra })
const snapshot = (refs: unknown[]) => ({ content_payload: { media_refs: refs } })
const chat = { chatSessionUid: 'chat', relationUid: 'rel', recordUid: 'record', recordOwnerUserId: 99 }
function fixture() {
  const runtime = { config: { environment: 'test', richMediaRenderEnabled: true },
    requireSession: vi.fn(async () => session),
    authenticatedPost: vi.fn(async (_path: string, body: { file_asset_uids: string[] }) => ({ items: body.file_asset_uids.map(uid => ({ ...ref(uid), download_url: `https://example.test/${uid}` })) })),
    authenticatedChatPost: vi.fn(async () => ({ record_uid: 'record', chat_session_uid: 'chat', media_display_items: [
      { ...ref('retained'), download_url: 'https://example.test/retained' }, { ...ref('new'), download_url: 'https://example.test/new' },
    ] })),
    authenticatedAuthGet: vi.fn(async () => ({ access_key_id: 'test', access_key_secret: 'test', security_token: 'test', expiration: '2099-01-01T00:00:00Z' })),
  }
  return { runtime, media: new MediaService(runtime as never, {} as never, {} as never, {} as never) }
}

describe('snapshot media through existing APIs', () => {
  it('deduplicates a page, batches beyond 50 and preserves each snapshot membership', async () => {
    const f = fixture()
    const refs = Array.from({ length: 51 }, (_, i) => ref(`file-${i}`))
    const pages = await f.media.hydrateRecordSnapshotMediaPage([snapshot(refs), snapshot([refs[0]])], session)
    expect(f.runtime.authenticatedPost).toHaveBeenCalledTimes(2)
    expect(f.runtime.authenticatedPost.mock.calls.map(call => call[1].file_asset_uids.length)).toEqual([50, 1])
    expect(f.runtime.authenticatedPost.mock.calls.every(call => call[0] === '/api/v1/files/assets/query')).toBe(true)
    expect(pages.map(page => page.length)).toEqual([51, 1])
  })
  it('preserves native asset kind and size when the snapshot has no filename or MIME', async () => {
    const f = fixture()
    f.runtime.authenticatedPost.mockResolvedValueOnce({ items: [{ file_asset_uid: 'voice', file_name: '录音',
      file_kind: 2, size: 8192, download_url: 'https://example.test/voice' }] } as never)
    const raw = snapshot([{ file_asset_uid: 'voice', content_file_role: 2, sort_order: 0 }])
    const [display] = await f.media.hydrateRecordSnapshotMediaPage([raw], session)
    expect(f.media.richContentBlocks(raw, 42, display)).toEqual([expect.objectContaining({
      kind: 'audio', size: 8192, fileName: '录音', fileAssetUid: 'voice',
    })])
  })
  it('uses chat only for foreign-owner addresses, never replaces history with current membership', async () => {
    const f = fixture()
    const raw = snapshot([ref('retained'), ref('removed')])
    const [display] = await f.media.hydrateRecordSnapshotMediaPage([raw, snapshot([])], session, chat)
    expect(f.runtime.authenticatedChatPost).toHaveBeenCalledWith('/api/v1/chats/records/media-display', {
      chat_session_uid: 'chat', rel_uid: 'rel', record_uid: 'record', record_owner_user_id: 99,
    }, session, undefined)
    expect(display).toHaveLength(1)
    const blocks = f.media.richContentBlocks(raw, 42, display)
    expect(blocks.map(block => block.fileAssetUid)).toEqual(['retained'])
    expect(f.media.recordMediaUnavailable(raw, blocks)).toBe(true)
    expect(f.runtime.authenticatedPost).not.toHaveBeenCalled()
    expect(f.runtime.authenticatedAuthGet).not.toHaveBeenCalled()
  })
  it('keeps unavailable media explicit when the chat read fails, without an owner fallback', async () => {
    const f = fixture(); f.runtime.authenticatedChatPost.mockRejectedValueOnce(new Error('forbidden'))
    expect(await f.media.hydrateRecordSnapshotMediaPage([snapshot([ref('removed')])], session, chat)).toEqual([[]])
    expect(f.runtime.authenticatedPost).not.toHaveBeenCalled()
  })
  it('rejects unrelated chat projections and unrelated assets', async () => {
    const f = fixture(); f.runtime.authenticatedChatPost.mockResolvedValueOnce({ record_uid: 'wrong', chat_session_uid: 'chat', media_display_items: [{ ...ref('retained'), download_url: 'https://example.test/leak' }] })
    expect(await f.media.hydrateRecordSnapshotMediaPage([snapshot([ref('retained')])], session, chat)).toEqual([[]])
    f.runtime.authenticatedPost.mockResolvedValueOnce({ items: [{ ...ref('other'), download_url: 'https://example.test/other' }] })
    expect(await f.media.hydrateRecordSnapshotMediaPage([snapshot([ref('wanted')])], session)).toEqual([[]])
  })
  it('does not read media for text-only, disabled or author-background snapshots', async () => {
    const f = fixture()
    expect(await f.media.hydrateRecordSnapshotMediaPage([snapshot([]), snapshot([ref('private', { content_file_role: 4 })])], session)).toEqual([[], []])
    f.runtime.config.richMediaRenderEnabled = false
    expect(await f.media.hydrateRecordSnapshotMediaPage([snapshot([ref('image')])], session)).toEqual([[]])
    expect(f.runtime.authenticatedPost).not.toHaveBeenCalled()
    expect(f.runtime.authenticatedChatPost).not.toHaveBeenCalled()
    expect(f.runtime.authenticatedAuthGet).not.toHaveBeenCalled()
  })
  it('uses existing inline addresses without extra reads', async () => {
    const f = fixture()
    const raw = snapshot([ref('image', { download_url: 'https://example.test/image' })])
    expect((await f.media.hydrateRecordSnapshotMediaPage([raw], session))[0]).toHaveLength(1)
    expect(f.runtime.authenticatedPost).not.toHaveBeenCalled()
  })
  it('only signs explicitly uploaded own legacy files, never local-only or path traversal', async () => {
    const f = fixture()
    const old = (uid: string, extra = {}) => ref(uid, { file_uid: uid, legacy_file_ref: true, legacy_remote_available: true, ...extra })
    const [display] = await f.media.hydrateRecordSnapshotMediaPage([snapshot([old('old.png'), old('local.png', { legacy_remote_available: false }), old('../escape')])], session)
    expect(display).toHaveLength(1)
    expect(display?.[0]).toMatchObject({ file_asset_uid: 'old.png', download_url: expect.stringContaining('/42/old.png?') })
    expect(f.runtime.authenticatedAuthGet).toHaveBeenCalledTimes(1)
    expect(f.runtime.authenticatedPost).not.toHaveBeenCalled()
    expect(f.runtime.authenticatedAuthGet.mock.calls[0]?.[0]).toContain('/api/v1/synch/get/sts-credentials?')
  })
  it('preserves text-read progress after a media batch failure and still resolves later batches', async () => {
    const f = fixture(); f.runtime.authenticatedPost.mockRejectedValueOnce(new Error('unavailable'))
    const pages = await f.media.hydrateRecordSnapshotMediaPage([snapshot(Array.from({ length: 51 }, (_, i) => ref(`f-${i}`)))], session)
    expect(pages[0]).toHaveLength(1)
    expect(pages[0]?.[0]).toMatchObject({ file_asset_uid: 'f-50' })
  })
  it('does not deliver media after cancellation or an account switch', async () => {
    const f = fixture(); const controller = new AbortController()
    f.runtime.authenticatedPost.mockImplementationOnce(async () => { controller.abort(); throw new Error('aborted') })
    await expect(f.media.hydrateRecordSnapshotMediaPage([snapshot([ref('f')])], session, undefined, controller.signal)).rejects.toThrow()
    const changed = fixture()
    changed.runtime.authenticatedPost.mockImplementationOnce(async () => {
      changed.runtime.requireSession.mockResolvedValue({ ...session, userId: 77 }); return { items: [] }
    })
    await expect(changed.media.hydrateRecordSnapshotMediaPage([snapshot([ref('f')])], session)).rejects.toThrow()
  })
})
