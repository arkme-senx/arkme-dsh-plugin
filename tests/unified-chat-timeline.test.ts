import { describe, expect, it, vi } from 'vitest'
import { CHAT_TIMELINE_SOURCES, compareUnifiedTimelineEvents, mergeUnifiedTimelineWindow, type ArkmeUnifiedTimelineEvent, type ArkmeUnifiedTimelineWindow } from '../src/unified-chat-timeline.js'
import { parseUnifiedTimelineResponse, UnifiedChatTimelineService } from '../src/services/unified-chat-timeline-service.js'
import { ChatService } from '../src/services/chat-service.js'
import { ArkmeUpstreamResponseError } from '../src/services/service.js'

const statuses = () => CHAT_TIMELINE_SOURCES.map(source => ({ source, status: 'ready' as const, itemCount: 0 }))
function response() { return { protocol_version: 1, chat_session_uid: 'chat', timeline_items: [], sources: statuses().map(s => ({ source: s.source, status: s.status, item_count: 0 })), complete: true, window_token: 'window', has_more: false, older_has_more: false, newer_has_more: false } }
function event(eventId: string, source: ArkmeUnifiedTimelineEvent['source'] = 'messages', occurredAtMillis = 10): ArkmeUnifiedTimelineEvent {
  return { eventId, source, occurredAtMillis, orderTie: eventId, contentStatus: 'available', kind: 'notice', text: eventId }
}
function window(events: ArkmeUnifiedTimelineEvent[] = []): ArkmeUnifiedTimelineWindow {
  return { protocolVersion: 1, events, sources: statuses(), complete: true, windowTokens: ['window'], olderCursor: 'older', newerCursor: 'newer', olderHasMore: true, newerHasMore: false, hasMore: false }
}
describe('unified timeline owner contract', () => {
  it('retains the reverse server total order including same-time source priority and World ties', () => {
    const events = [event('b', 'world_public'), event('a', 'world_public'), event('a'), event('b')].sort(compareUnifiedTimelineEvents)
    expect(events.map(e => `${e.source}:${e.eventId}`)).toEqual(['world_public:b', 'world_public:a', 'messages:a', 'messages:b'])
  })
  it('refreshes stable content, retains gaps and retires not-applicable sources without changing frontiers', () => {
    const before = window([event('old'), event('gap', 'interwoven'), event('retired', 'wechat_import')])
    const next = window([{ ...event('old'), text: 'edited' }])
    next.sources.find(s => s.source === 'interwoven')!.status = 'gap'
    next.sources.find(s => s.source === 'wechat_import')!.status = 'not_applicable'
    next.complete = false
    next.olderCursor = 'refresh-boundary'
    const merged = mergeUnifiedTimelineWindow(before, next, 'refresh')
    expect(merged.events.map(e => e.eventId)).toEqual(['gap', 'old'])
    expect(merged.events.at(-1)).toMatchObject({ text: 'edited' })
    expect(merged.olderCursor).toBe('older')
  })
  it('rejects missing completeness, wrong scope and missing continuation rather than presenting empty history', () => {
    expect(parseUnifiedTimelineResponse(response(), 'chat').events).toEqual([])
    for (const patch of [{ sources: [] }, { chat_session_uid: 'other' }, { has_more: true }, { protocol_version: 2 }]) {
      expect(() => parseUnifiedTimelineResponse({ ...response(), ...patch }, 'chat')).toThrow()
    }
  })
  it('accepts auxiliary-only pages and preserves unavailable message slots', async () => {
    const raw = { ...response(), timeline_items: [{ event_id: 'm', kind: 'message', source: 'messages', occurred_at: 10, order_tie: 'm', content_status: 'unavailable', payload: { secret: 'do not expose' } }] }
    const post = vi.fn().mockResolvedValue(raw)
    const service = new UnifiedChatTimelineService({ requireSession: async () => ({ userId: 1 }), config: { environment: 'test' }, stateStore: { uniqueCode: async () => 'key' }, authenticatedChatPost: post } as never,
      { openSourceRef: async () => ({ kind: 'private_chat', ownerRef: 'chat' }), sourceItem: async () => ({ kind: 'private_chat' }) } as never,
      { projectChatTimelineItems: async () => [] } as never, {} as never)
    const result = await service.read('ref')
    expect(post.mock.calls[0]?.[0]).toBe('/api/v1/chat/timeline/unified')
    expect(result.items).toEqual([])
    expect(result.unified?.events).toEqual([expect.objectContaining({ kind: 'notice', contentStatus: 'unavailable' })])
    expect(JSON.stringify(result)).not.toContain('do not expose')
  })
  it('projects public publications as compact, restart-safe references without copying their full text', async () => {
    const raw = { ...response(), timeline_items: [{ event_id: 'world', kind: 'world_public', source: 'world_public', occurred_at: 10, order_tie: 'world', content_status: 'available', payload: { record_uid: 'private-locator', nick_name: '小明', text_content: 'very long public body' } }] }
    const service = new UnifiedChatTimelineService({ requireSession: async () => ({ userId: 1 }), config: { environment: 'test' }, stateStore: { uniqueCode: async () => 'key' }, authenticatedChatPost: async () => raw } as never,
      { openSourceRef: async () => ({ kind: 'private_chat', ownerRef: 'chat' }), sourceItem: async () => ({ kind: 'private_chat' }) } as never,
      { projectChatTimelineItems: async () => [] } as never, {} as never)
    const result = await service.read('ref')
    expect(result.unified?.events[0]).toMatchObject({ kind: 'world-public', authorName: '小明', recordRef: expect.stringMatching(/^atw1\./) })
    expect(JSON.stringify(result)).not.toContain('very long public body')
    expect(JSON.stringify(result)).not.toContain('private-locator')
  })
  it('classifies only the precise owner recovery reason and never invokes legacy reads', async () => {
    const post = vi.fn().mockRejectedValue(new ArkmeUpstreamResponseError('arkme-code-2002', 'bad', false, 502, { reason: 'chat_timeline_window_invalid' }))
    const service = new UnifiedChatTimelineService({ requireSession: async () => ({ userId: 1 }), config: { environment: 'test' }, stateStore: { uniqueCode: async () => 'key' }, authenticatedChatPost: post } as never,
      { openSourceRef: async () => ({ kind: 'group_chat', ownerRef: 'chat' }), sourceItem: async () => ({ kind: 'group_chat' }) } as never, {} as never, {} as never)
    await expect(service.read('ref')).rejects.toMatchObject({ code: 'chat-timeline-window-invalid' })
    post.mockRejectedValue(new ArkmeUpstreamResponseError('arkme-code-2002', 'bad', false, 502, { reason: 'other' }))
    await expect(service.read('ref')).rejects.toMatchObject({ code: 'arkme-code-2002' })
    expect(post.mock.calls.every(call => call[0] === '/api/v1/chat/timeline/unified')).toBe(true)
  })
})


describe('unified member join names', () => {
  function setup(payloads: Record<string, unknown>[], lookup = vi.fn(async (_ids: readonly number[], _session: unknown, _signal?: AbortSignal) => new Map([[7, { displayName: '小明' }], [8, { displayName: '小红' }]]))) {
    const session = { userId: 1, accessToken: 'fixture', refreshToken: 'fixture' }
    const raw = { ...response(), timeline_items: payloads.map((payload, index) => ({
      event_id: `join-${index}`, kind: 'member_join', source: 'group_metadata', occurred_at: 1700000000000 + index,
      order_tie: `join-${index}`, content_status: 'available', payload,
    })) }
    const post = vi.fn(async () => raw)
    const runtime = { requireSession: async () => session, config: { environment: 'test' }, stateStore: { uniqueCode: async () => 'key' }, authenticatedChatPost: post }
    const source = { openSourceRef: async () => ({ kind: 'group_chat', ownerRef: 'chat' }), sourceItem: async () => ({ kind: 'group_chat' }) }
    const chat = new ChatService(runtime as never, source as never, { publicProfileSummariesByUserIds: lookup } as never,
      {} as never, {} as never, {} as never, {} as never, {} as never, {} as never)
    vi.spyOn(chat, 'projectChatTimelineItems').mockResolvedValue([])
    return { service: new UnifiedChatTimelineService(runtime as never, source as never, chat, {} as never), lookup, post }
  }
  it('hydrates missing roster snapshots once per page and preserves group nicknames', async () => {
    const { service, lookup, post } = setup([
      { user_id: 7, display_name_snapshot: '', group_display_name: '', extra_json: {} },
      { user_id: 8, display_name_snapshot: '', group_display_name: '', extra_json: {} },
      { user_id: 9, display_name_snapshot: '旧名称', group_display_name: '群内昵称', extra_json: {} },
    ])
    const signal = new AbortController().signal
    const page = await service.read('ref', {}, signal)
    expect(page.unified?.events.map(event => event.kind === 'member-join' ? event.item.invitees[0]?.displayName : event.kind)).toEqual(['小明', '小红', '群内昵称'])
    expect(lookup).toHaveBeenCalledExactlyOnceWith([7, 8], expect.objectContaining({ userId: 1 }), expect.any(AbortSignal))
    expect(post).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(page)).not.toContain('user_id')
  })
  it('keeps invitation details after filling an empty invitee snapshot', async () => {
    const { service } = setup([{ user_id: 7, join_at: 1700000000000, display_name_snapshot: '', group_display_name: '',
      extra_json: { inviter_user_id: 1, inviter_display_name: '群主', join_source_type: 'direct_add' } }])
    const page = await service.read('ref')
    expect(page.unified?.events[0]).toMatchObject({ kind: 'member-join', item: { action: 'direct_add',
      inviter: { displayName: '群主', isSelf: true }, invitees: [{ displayName: '小明', isSelf: false, memberRef: expect.any(String) }] } })
  })
  it.each([['direct_add', 'direct_add'], ['invite_accept', 'invite']] as const)('preserves canonical %s actor and hydrates both names in one batch', async (source, action) => {
    const { service, lookup } = setup([{ user_id: 8, display_name_snapshot: '', group_display_name: '',
      extra_json: { join_source: source, join_actor_user_id: 7 } }])
    const page = await service.read('ref')
    expect(page.unified?.events[0]).toMatchObject({ kind: 'member-join', item: { action,
      inviter: { displayName: '小明', memberRef: expect.any(String), isSelf: false },
      invitees: [{ displayName: '小红', memberRef: expect.any(String), isSelf: false }] } })
    expect(lookup).toHaveBeenCalledExactlyOnceWith([8, 7], expect.any(Object), expect.any(AbortSignal))
  })
  it('uses an inviter group nickname available in the same page without extra reads', async () => {
    const { service, lookup } = setup([
      { user_id: 7, group_display_name: '群主昵称', extra_json: {} },
      { user_id: 8, group_display_name: '成员昵称', extra_json: JSON.stringify({ join_source: 'invite_accept', inviter_user_id: 7 }) },
    ])
    expect((await service.read('ref')).unified?.events[1]).toMatchObject({ kind: 'member-join', item: {
      action: 'invite', inviter: { displayName: '群主昵称', memberRef: expect.any(String) }, invitees: [{ displayName: '成员昵称' }],
    } })
    expect(lookup).not.toHaveBeenCalled()
  })
  it('does not request profiles when names are already present', async () => {
    const { service, lookup } = setup([{ user_id: 7, group_display_name: '群昵称', extra_json: {} }])
    expect((await service.read('ref')).unified?.events[0]).toMatchObject({ kind: 'member-join', item: { action: 'join', invitees: [{ displayName: '群昵称', memberRef: expect.any(String) }] } })
    expect(lookup).not.toHaveBeenCalled()
  })
  it('deduplicates missing members in a full page', async () => {
    const { service, lookup } = setup(Array.from({ length: 100 }, () => ({ user_id: 7, extra_json: {} })))
    expect((await service.read('ref')).unified?.events).toHaveLength(100)
    expect(lookup).toHaveBeenCalledTimes(1)
    expect(lookup.mock.calls[0]?.[0]).toEqual([7])
  })
  it('keeps the timeline readable on profile failure without showing raw IDs', async () => {
    const lookup = vi.fn().mockRejectedValue(new Error('unavailable'))
    const { service } = setup([{ user_id: 7, extra_json: {} }], lookup)
    expect((await service.read('ref')).unified?.events[0]).toMatchObject({ kind: 'member-join', item: { action: 'join', invitees: [{ displayName: '群成员' }] } })
    expect(lookup).toHaveBeenCalledTimes(1)
  })
  it('propagates cancellation during name hydration', async () => {
    const controller = new AbortController()
    const lookup = vi.fn().mockImplementation(async () => { controller.abort(); throw controller.signal.reason })
    const { service } = setup([{ user_id: 7, extra_json: {} }], lookup)
    await expect(service.read('ref', {}, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })
})
