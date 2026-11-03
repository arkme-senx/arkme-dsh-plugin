import { describe, expect, it, vi } from 'vitest'
import { ChatService } from '../../src/services/chat-service.js'

describe('location-only creation snapshot read', () => {
  const setup = (owner = 42, edited = true) => {
    const post = vi.fn(async (path: string, body: any) => {
      if (path.endsWith('/revisions/query')) return { record_uid: 'record', items: [{ version: 1, revision_uid: 'creation', edit_capture_context: {
        schema_version: 1, automatic_location: { lat: 30.1, lon: 114.2, captured_at: 1793600000000 },
      }, content_payload: { media_refs: [{ file_asset_uid: 'ambient', content_file_role: 4 }] } }], has_more: false }
      if (path.endsWith('/context/get')) return { record_uid: 'record', location: { source_kind: 1, lat: body.revision_uid ? 30.1 : 31, lon: body.revision_uid ? 114.2 : 115 }, position_detail: { address: '原始记录地点' } }
      return { record_core: { record_uid: 'record', owner_user_id: owner, status: 1, content_access_state: 1,
        has_manual_edit: edited, version: edited ? 2 : 1, text_content: '最新正文', location: { lat: 31, lon: 115 } } }
    })
    const runtime = { requireSession: async () => ({ userId: 42 }), authenticatedPost: post }
    const media = { issueSearchAudioMedia: vi.fn() }
    const service = new ChatService(runtime as never, {} as never, {} as never, media as never,
      {} as never, {} as never, {} as never, {} as never, {} as never)
    return { post, media, service }
  }
  it('uses version one of an edited record and skips ambient audio hydration', async () => {
    const { post, media, service } = setup()
    const result = await service.ownedRecordLocationSnapshot('record')
    expect(result).toMatchObject({ locationCapture: { latitude: 30.1, longitude: 114.2 }, locationLabel: '原始记录地点' })
    expect(post.mock.calls.find(call => call[0].endsWith('/context/get'))?.[1]).toEqual({ record_uid: 'record', revision_uid: 'creation' })
    expect(media.issueSearchAudioMedia).not.toHaveBeenCalled()
  })
  it('rejects a foreign owner before reading any private location context', async () => {
    const { post, service } = setup(77, false)
    await expect(service.ownedRecordLocationSnapshot('record')).rejects.toThrow('当前记录位置不可访问')
    expect(post).toHaveBeenCalledTimes(1)
  })
  it('reports context failures rather than presenting a complete but empty location result', async () => {
    const { post, service } = setup(42, false)
    const original = post.getMockImplementation()!
    post.mockImplementation(async (path, body) => { if (path.endsWith('/context/get')) throw new Error('地点服务离线'); return original(path, body) })
    await expect(service.ownedRecordLocationSnapshot('record')).rejects.toThrow('地点服务离线')
  })
})
