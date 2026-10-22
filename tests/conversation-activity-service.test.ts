import { describe, expect, it, vi } from 'vitest'
import { activityMessageMatches, parseActivityMessages, parseConversationActivity } from '../src/conversation-activity.js'
import { ConversationActivityService } from '../src/services/conversation-activity-service.js'
import { ArkmePluginError, type ServiceRuntime } from '../src/services/service.js'
import { query as q, envelope as env, wireResult as result, wireState as state, capability } from './fixtures/conversation-activity.js'
function fixture(kind = 'private_chat') {
  let userId = 7, change = () => {}
  const post = vi.fn(async (path: string, _body: unknown, _session: unknown, _signal: unknown, _options: unknown): Promise<unknown> => path.endsWith('/capabilities') ? capability : state)
  const runtime = { config: { environment: 'prod' }, requireSession: async () => ({ userId }), authenticatedChatPost: post, subscribeAccountScope: (fn: () => void) => { change = fn; return () => {} } } as unknown as ServiceRuntime
  const sources = { openSourceRef: vi.fn(async () => ({ kind, ownerRef: 'chat1' })) }
  return { service: new ConversationActivityService(runtime, sources as never), post, sources, change: () => { userId = 8; change() } }
}
describe('full conversation activity accounting', () => {
  it('reconciles all message types across hourly and weekly buckets, separating system notices', () => {
    expect(parseConversationActivity(state, q, 'chat1').result).toMatchObject({ totalMessages: 15, systemMessages: 3, activeDays: 2, participants: 2 })
  })
  it.each([
    { corpus: 'text_messages' }, { time_basis: 'upload_at' }, { message_types: 'text' }, { deduplication: 'attachment_id' },
    { totalMessages: 14 }, { systemMessages: 4 }, { participants: 4 }, { activeDays: 0 }, { fromAt: null },
    { hourly: result.hourly.slice(1) }, { hourly: [...result.hourly.slice(1), result.hourly[1]] },
    { weekly: result.weekly.map(b => b.weekday === 2 && b.hour === 9 ? { ...b, messages: 11 } : b) },
  ])('rejects incomplete or misleading aggregations', patch => { expect(() => parseConversationActivity({ ...state, result: { ...result, ...patch } }, q, 'chat1')).toThrow() })
  it('rejects a response for another account-owned conversation, sender, or timezone', () => {
    for (const patch of [{ chat_session_uid: 'other' }, { sender: 'self' }, { time_zone: 'UTC' }, { scope: 'conversation_words' }]) expect(() => parseConversationActivity({ ...state, ...patch }, q, 'chat1')).toThrow()
  })
  it('rejects system activity assigned to an individual', () => {
    expect(() => parseConversationActivity({ ...state, sender: 'self' }, { ...q, sender: 'self' }, 'chat1')).toThrow()
  })
  it('accepts an explicit complete zero result and an indexing state but not fabricated missing counts', () => {
    const zero = { ...result, totalMessages: 0, systemMessages: 0, activeDays: 0, participants: 0, fromAt: null, toAt: null,
      hourly: result.hourly.map(b => ({ ...b, messages: 0, systemMessages: 0, participants: 0 })), weekly: result.weekly.map(b => ({ ...b, messages: 0, systemMessages: 0, participants: 0 })) }
    expect(parseConversationActivity({ ...state, result: zero }, q, 'chat1').result?.totalMessages).toBe(0)
    expect(parseConversationActivity({ ...state, result: null, progress: { completed: 40, total: 100 } }, q, 'chat1').progress?.completed).toBe(40)
    expect(() => parseConversationActivity({ ...state, result: null }, q, 'chat1')).toThrow()
  })
  it('uses the requested timezone and exact date/week/hour when locating messages', () => {
    const at = Date.parse('2026-10-13T09:15:00+08:00')
    expect(activityMessageMatches(at, q, { hour: 9, weekday: 2 })).toBe(true)
    expect(activityMessageMatches(at, { ...q, timezone: 'UTC' }, { hour: 1, weekday: 2 })).toBe(true)
    expect(activityMessageMatches(at, q, { hour: 1, weekday: 2 })).toBe(false)
    expect(activityMessageMatches(at, { ...q, fromDate: '2026-10-14', toDate: '2026-10-15' }, { hour: 9, weekday: null })).toBe(false)
  })
  it('retains messages without text and binds detail pages to the chosen bucket/snapshot', () => {
    const page = { ...env, result_id: 'a1', hour: 9, weekday: 2, total: 1, next_cursor: null, items: [{ key: 'm', sourceRef: 'opaque', senderName: '周鹏', preview: '', sentAt: result.fromAt, kind: 'image' }] }
    expect(parseActivityMessages(page, q, 'chat1', 'a1', { hour: 9, weekday: 2 }).items[0]?.kind).toBe('image')
    for (const patch of [{ result_id: 'other' }, { weekday: 3 }, { items: [{ ...page.items[0], sentAt: result.toAt }] }]) expect(() => parseActivityMessages({ ...page, ...patch }, q, 'chat1', 'a1', { hour: 9, weekday: 2 })).toThrow()
  })
})
describe('activity owner adapter', () => {
  it.each([404, 501])('treats only explicit capability %s absence as unsupported', async status => {
    const f = fixture(); f.post.mockRejectedValue(new ArkmePluginError('upstream', 'missing', false, status))
    expect(await f.service.read(q)).toMatchObject({ supported: false, result: null })
    expect(f.post.mock.calls.every(c => c[0].endsWith('/capabilities'))).toBe(true)
  })
  it.each([401, 503])('preserves %s failures', async status => {
    const f = fixture(); f.post.mockRejectedValue(new ArkmePluginError('upstream', 'auth or network', false, status))
    await expect(f.service.read(q)).rejects.toThrow('auth or network')
  })
  it('uses read-only Chat aggregation with no uploaded message bodies or AI creation', async () => {
    const f = fixture(); await f.service.read({ ...q, messages: ['not sent'] })
    expect(f.post).toHaveBeenLastCalledWith('/api/v1/chats/activity-time/query', env, expect.anything(), undefined, expect.objectContaining({ lane: 'interactive-read' }))
    expect(f.post.mock.calls.some(c => c[0].includes('word-frequency') || c[0].endsWith('/create'))).toBe(false)
    f.post.mockResolvedValueOnce({ ...capability, all_message_types: false })
    await expect(f.service.read(q)).rejects.toThrow('不兼容')
  })
  it('validates sealed conversation and account, including late responses', async () => {
    const f = fixture()
    await expect(f.service.read({ ...q, accountScope: 'prod:8' })).rejects.toThrow('账号已变化')
    expect(f.post).not.toHaveBeenCalled()
    f.post.mockImplementationOnce(async () => { f.change(); return capability })
    await expect(f.service.read(q)).rejects.toThrow('账号已变化')
    await expect(fixture('topic').service.read(q)).rejects.toThrow('仅支持私聊和群聊')
    await expect(fixture('group_chat').service.read({ ...q, sender: 'peer' })).rejects.toThrow('仅支持私聊和群聊')
  })
  it('queries historical activity senders independently from word-frequency capability', async () => {
    const f = fixture('group_chat'); f.post.mockResolvedValue({ ...env, search: '周', items: [{ ref: 'person', name: '周鹏', former: true, isSelf: false }], next_cursor: null })
    expect((await f.service.participants({ ...q, search: '周' })).items[0]?.former).toBe(true)
    expect(f.post.mock.calls[0]?.[0]).toBe('/api/v1/chats/activity-time/participants')
  })
  it('revalidates sources against the correct bucket and current visibility', async () => {
    const f = fixture(), input = { ...q, resultId: 'a1', messageSourceRef: 'opaque', hour: 9, weekday: 2 }
    const source = { ...env, result_id: 'a1', source_ref: 'opaque', hour: 9, weekday: 2, available: true, record_owner_user_id: '1001', message_uid: 'm', send_at: result.fromAt }
    f.post.mockResolvedValue(source)
    expect(await f.service.source(input)).toEqual({ messageUid: 'm', sendAtMillis: result.fromAt, recordOwnerUserId: 1001 })
    for (const patch of [{ available: false }, { source_ref: 'other' }, { send_at: result.toAt }, { hour: 20 }]) {
      f.post.mockResolvedValueOnce({ ...source, ...patch }); await expect(f.service.source(input)).rejects.toThrow('已变化')
    }
  })
})
