import { describe, expect, it, vi } from 'vitest'
import { ConversationLocationService } from '../../src/services/conversation-location-service.js'
import type { ServiceRuntime } from '../../src/services/service.js'
import type { SourceService } from '../../src/services/source-service.js'
import type { ArkmePrivacyVisibilityService } from '../../src/services/privacy-visibility.js'

const manual = { lat: -33.9, lon: 151.2, poi_name: '手动地点', address: '地址' }
const core = (uid: string, extra = {}) => ({ record_uid: uid, owner_user_id: 42, status: 1, content_access_state: 1,
  send_at: 1793600000000, text_content: '正文'.repeat(500), content_payload: { location_mentions: [manual] }, ...extra })
function setup(kind = 'send_to_self', locked: string[] = []) {
  let userId = 42
  const opened = (ref: string) => ({ version: 1, userId, kind: ref.startsWith('topic') ? 'topic' : ref === 'other' ? 'private_chat' : kind,
    ownerRef: ref, displayName: ref })
  const source = { openSourceRef: vi.fn(async (ref: string) => opened(ref)), sourceItem: vi.fn(async (raw: any) => ({ sourceRef: raw.ownerRef, kind: raw.kind, displayName: raw.displayName })),
    topicSubtreeSources: vi.fn(async () => [{ sourceRef: 'topic-root' }, { sourceRef: 'topic-child' }]) }
  const post = vi.fn(async (_path: string, _body: any, _session?: unknown, _signal?: unknown, _options?: unknown) => ({ items: [core('one')], has_more: false }) as any)
  const runtime = { config: { recordBaseUrl: 'record', chatBaseUrl: 'chat' }, requireSession: async () => ({ userId }),
    authenticatedPost: post, authenticatedChatPost: post } as unknown as ServiceRuntime
  const snapshot = vi.fn(async (_uid: string) => ({ locationCapture: { latitude: 30, longitude: 114, capturedAtMillis: 1793600000000 }, locationLabel: '快照地点' }))
  const service = new ConversationLocationService(runtime, source as unknown as SourceService,
    { lockedRecordUids: async () => new Set(locked) } as unknown as ArkmePrivacyVisibilityService, snapshot)
  return { service, post, snapshot, runtime, source, switchAccount: () => { userId = 43 } }
}
describe('conversation location history ownership', () => {
  it('keeps a message snapshot and every explicitly sent place, with bounded snippets', async () => {
    const { service, post } = setup()
    const page = await service.page({ sourceRef: 'self' })
    expect(post.mock.calls[0]!.slice(0, 2)).toEqual(['/api/v1/home/feed/query', { source_kinds: [1, 2], limit: 20 }])
    expect(page).toMatchObject({ scanned: 1, hasMore: false })
    expect(page.items.map(item => item.locationKind)).toEqual(['message', 'snapshot'])
    expect(new Set(page.items.map(item => item.key)).size).toBe(2)
    expect(page.items[0]).toMatchObject({ latitude: -33.9, longitude: 151.2, source: 'quick_note', record: { textContent: '', targetSource: { sourceRef: 'self' } } })
    expect(page.items[0]!.record.snippet.length).toBe(500)
  })
  it('uses the authoritative uncategorized container and removes inaccessible rows before any snapshot read', async () => {
    const { service, post, snapshot } = setup('default_category', ['locked'])
    post.mockResolvedValue({ items: [core('locked'), core('other', { owner_user_id: 99 }), core('deleted', { status: 2 }), core('secret', { content_access_state: 2 }), core('ok')], has_more: false })
    const page = await service.page({ sourceRef: 'uncategorized' })
    expect(post.mock.calls[0]![0]).toBe('/api/v1/records/uncategorized/query')
    expect(snapshot.mock.calls.map(call => call[0])).toEqual(['ok'])
    expect(page.items.every(item => item.record.recordUid === 'ok')).toBe(true)
  })
  it.each(['private_chat', 'group_chat'])('reads only received explicit locations in %s and preserves relation identity', async kind => {
    const { service, post, snapshot } = setup(kind)
    post.mockResolvedValue({ items: [
      { relation: { rel_uid: 'received', record_uid: 'received', record_owner_user_id: '6690025278483443577', seq: 9, attach_at: 1793600000000 }, record: { status: 1, payload: core('received', { owner_user_id: '6690025278483443577' }) } },
      { relation: { rel_uid: 'mine', record_owner_user_id: 42, seq: 8, attach_at: 1793600000000 }, record: { status: 1, payload: core('mine') } },
    ], has_more: false })
    const page = await service.page({ sourceRef: 'chat' })
    expect(snapshot.mock.calls.map(call => call[0])).toEqual(['mine'])
    expect(page.items.filter(item => item.record.recordUid === 'received')).toHaveLength(1)
    expect(page.items[0]).toMatchObject({ source: kind === 'group_chat' ? 'received_group' : 'received_private', locationKind: 'message',
      record: { recordOwnerUserId: '6690025278483443577', routeTargetKind: 'chat_timeline', targetSource: { sourceRef: 'chat' } } })
    expect(post.mock.calls.every(call => call[0] === '/api/v1/chat/timeline/page')).toBe(true)
  })
  it('does not recurse into forwarded records or borrow received device facts', async () => {
    const { service, post, snapshot } = setup('private_chat')
    post.mockResolvedValue({ items: [{ relation: { rel_uid: 'rel', record_owner_user_id: 77 }, record: { payload: core('received', {
      owner_user_id: 77, content_payload: { forward_records: [{ location_mentions: [manual] }] }, location: { lat: 31, lon: 115 } }) } }], has_more: false })
    expect((await service.page({ sourceRef: 'chat' })).items).toEqual([])
    expect(snapshot).not.toHaveBeenCalled()
  })
  it('classifies forwarded messages by their sender, while private captures remain owner-only', async () => {
    const { service, post, snapshot } = setup('group_chat')
    post.mockResolvedValue({ items: [
      { relation: { rel_uid: 'my-forward', record_owner_user_id: 77, sender_user_id: 42 }, record: { payload: core('foreign', { owner_user_id: 77 }) } },
      { relation: { rel_uid: 'their-forward', record_owner_user_id: 42, sender_user_id: 77 }, record: { payload: core('owned') } },
    ], has_more: false })
    const page = await service.page({ sourceRef: 'chat' })
    expect(page.items.map(item => item.source)).toEqual(['my_sent', 'received_group'])
    expect(page.items.every(item => item.locationKind === 'message')).toBe(true)
    expect(snapshot).not.toHaveBeenCalled()
  })
  it('binds continuation to account, container and environment, and reads past the first page', async () => {
    const { service, post, switchAccount, runtime } = setup()
    post.mockImplementation(async (_path, body) => ({ items: [core(body.cursor_record_uid ? 'old' : 'new')], has_more: !body.cursor_record_uid,
      next_cursor_send_at: 1793500000000, next_cursor_record_uid: 'old-page' }))
    const first = await service.page({ sourceRef: 'self' })
    expect(first.hasMore).toBe(true)
    const next = await service.page({ sourceRef: 'self', cursor: first.nextCursor! })
    expect(next.hasMore).toBe(false); expect(next.items[0]!.record.recordUid).toBe('old')
    await expect(service.page({ sourceRef: 'other', cursor: first.nextCursor! })).rejects.toThrow('位置读取进度已过期')
    switchAccount()
    await expect(service.page({ sourceRef: 'self', cursor: first.nextCursor! })).rejects.toThrow('位置读取进度已过期')
    runtime.config!.recordBaseUrl = 'changed'
    await expect(service.page({ sourceRef: 'self', cursor: first.nextCursor! })).rejects.toThrow('位置读取进度已过期')
  })
  it('enumerates the authorized topic subtree, rejecting privacy-locked roots', async () => {
    const { service, post } = setup('topic')
    post.mockImplementation(async (path, body) => path.endsWith('/metadata')
      ? { topic_core: { topic_uid: body.topic_uid, kind: 1, privacy_state: 1, show_in_home: true } }
      : { topic_uid: body.topic_uid, records: [core(body.topic_uid)], privacy_state: 1, has_more: false })
    const first = await service.page({ sourceRef: 'topic-root' })
    const second = await service.page({ sourceRef: 'topic-root', cursor: first.nextCursor! })
    expect(first.items[0]!.record.recordUid).toBe('topic-root')
    expect(second.items[0]!.record.recordUid).toBe('topic-child'); expect(second.hasMore).toBe(false)
    post.mockResolvedValue({ topic_core: { topic_uid: 'topic-root', kind: 1, privacy_state: 2, show_in_home: true } })
    await expect(service.page({ sourceRef: 'topic-root' })).rejects.toThrow('隐私锁主题')
  })
  it('bounds snapshot concurrency and rejects incomplete location reads instead of claiming completion', async () => {
    const { service, post, snapshot } = setup()
    post.mockResolvedValue({ items: Array.from({ length: 12 }, (_, index) => core(String(index))), has_more: false })
    let active = 0, maximum = 0
    snapshot.mockImplementation(async () => { maximum = Math.max(maximum, ++active); await new Promise(resolve => setTimeout(resolve, 0)); active--; return { locationCapture: { latitude: 30, longitude: 114, capturedAtMillis: 1 }, locationLabel: '' } })
    expect((await service.page({ sourceRef: 'self' })).scanned).toBe(12)
    expect(maximum).toBe(4)
    snapshot.mockRejectedValue(new Error('位置服务暂不可用'))
    await expect(service.page({ sourceRef: 'self' })).rejects.toThrow('位置服务暂不可用')
  })
  it('rejects a stalled upstream cursor', async () => {
    const { service, post } = setup('group_chat')
    post.mockResolvedValue({ items: [], has_more: true, next_before_seq: 10 })
    const first = await service.page({ sourceRef: 'chat' })
    await expect(service.page({ sourceRef: 'chat', cursor: first.nextCursor! })).rejects.toThrow('位置读取进度已过期')
  })
})

it('keeps group location pages in the selected admission and never reads personal GPS snapshots',async()=>{
 const f=setup('group_chat')
 f.source.openSourceRef.mockImplementation(async ref=>({version:1,userId:42,kind:'group_chat',ownerRef:'group',displayName:'群',groupDelegation:{accessRef:ref,teamId:ref==='teamB'?'43':'42',membershipKind:'member',membershipRevision:1,groupMembershipUid:ref==='teamB'?'B':'A',groupMembershipRevision:1,visibleFromSeq:57}}) as never)
 Object.assign(f.source,{sourceScopeKey:async(raw:any)=>'scope:'+raw.groupDelegation.groupMembershipUid})
 f.post.mockResolvedValue({items:[{relation:{sender_user_id:42,record_owner_user_id:42,record_uid:'message',seq:60,rel_uid:'rel'},record:{status:1,payload:core('message')}}],has_more:true,next_before_seq:59})
 const first=await f.service.page({sourceRef:'teamA'})
 expect(first.items).toHaveLength(1)
 expect(first.items[0]?.locationKind).toBe('message')
 expect(f.snapshot).not.toHaveBeenCalled()
 expect(f.post.mock.calls[0]?.[4]).toMatchObject({chatAccessRef:'teamA',bypassCache:true})
 await expect(f.service.page({sourceRef:'teamB',cursor:first.nextCursor})).rejects.toThrow('位置读取进度已过期')
 f.post.mockResolvedValue({items:[],has_more:false})
 await f.service.page({sourceRef:'teamA-rotated',cursor:first.nextCursor})
 expect(f.post.mock.calls.at(-1)?.[4]).toMatchObject({chatAccessRef:'teamA-rotated'})
 expect(f.snapshot).not.toHaveBeenCalled()
})
