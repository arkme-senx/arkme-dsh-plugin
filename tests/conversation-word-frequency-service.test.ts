import { describe, expect, it, vi } from 'vitest'
import { conversationWordsEnvelope, parseConversationWordsState, parseConversationWordsQuery, parseConversationWordMessages, type ConversationWordsQuery } from '../src/conversation-word-frequency.js'
import { ConversationWordFrequencyService } from '../src/services/conversation-word-frequency-service.js'
import { ArkmePluginError, type ServiceRuntime } from '../src/services/service.js'

const q: ConversationWordsQuery = { accountScope: 'prod:7', sourceRef: 'signed', timezone: 'Asia/Shanghai', fromDate: null, toDate: null, sender: 'all' }
const env = conversationWordsEnvelope(q, 'chat1')
const capability = { supported: true, schema_version: 1, scope: 'conversation_words', full_history: true, historical_senders: true, sender_filter: true, source_navigation: true, idempotent_create: true }
const result = { id: 'r1', updatedAt: 100, fromAt: 10, toAt: 100, corpus: 'authorized_conversation_messages', quote_policy: 'authored_body_only', analyzedMessages: 8, eligibleMessages: 10, excludedMessages: 2, voiceTranscriptMessages: 1, words: [{ key: 'w1', text: '工作', count: 6, messageCount: 3 }] }
const state = { ...env, result, job: null, stale: false }
function fixture(kind = 'private_chat') {
  let userId = 7, change = () => {}
  const post = vi.fn(async (path: string, _body: unknown, _session: unknown, _signal: unknown, _options: unknown): Promise<unknown> => path.endsWith('/capabilities') ? capability : state)
  const runtime = { config: { environment: 'prod' }, requireSession: async () => ({ userId }), authenticatedChatPost: post, subscribeAccountScope: (fn: () => void) => { change = fn; return () => {} } } as unknown as ServiceRuntime
  const sources = { openSourceRef: vi.fn(async () => ({ kind, ownerRef: 'chat1' })) }
  return { service: new ConversationWordFrequencyService(runtime, sources as never), post, sources, change: () => { userId = 8; change() } }
}
describe('conversation word frequency scope and counts', () => {
  it('preserves partial coverage and distinct occurrence/message counts', () => {
    expect(parseConversationWordsState(state, q, 'chat1').result).toMatchObject({ analyzedMessages: 8, eligibleMessages: 10, words: [{ count: 6, messageCount: 3 }] })
  })
  it.each([
    { sender: 'self' }, { chat_session_uid: 'other' }, { from_date: '2026-10-15' }, { time_zone: 'UTC' },
  ])('rejects a different query response', mismatch => { expect(() => parseConversationWordsState({ ...state, ...mismatch }, q, 'chat1')).toThrow() })
  it.each([
    { corpus: 'visible_messages' }, { quote_policy: 'include_quotes' }, { analyzedMessages: 11 }, { voiceTranscriptMessages: 9 },
    { words: [{ ...result.words[0], count: 2 }] }, { words: [result.words[0], result.words[0]] }, { fromAt: null },
  ])('rejects misleading results', patch => { expect(() => parseConversationWordsState({ ...state, result: { ...result, ...patch } }, q, 'chat1')).toThrow() })
  it.each([
    { fromDate: '2026-02-30', toDate: '2026-03-01' }, { fromDate: '2026-10-10' }, { fromDate: '2026-10-12', toDate: '2026-10-01' }, { timezone: 'fake' },
  ])('rejects invalid ranges', patch => { expect(() => parseConversationWordsQuery({ ...q, ...patch })).toThrow() })
  it('binds message pages to result and word', () => {
    const page = { ...env, result_id: 'r1', word_key: 'w1', items: [], total: 0, next_cursor: null }
    expect(parseConversationWordMessages(page, q, 'chat1', 'r1', 'w1').items).toEqual([])
    expect(() => parseConversationWordMessages(page, q, 'chat1', 'old', 'w1')).toThrow()
    expect(() => parseConversationWordMessages(page, q, 'chat1', 'r1', 'other')).toThrow()
  })
})
describe('Chat-owner word frequency adapter', () => {
  it.each([404, 501])('reports explicit %s absence without falling back to page scans', async status => {
    const f = fixture(); f.post.mockRejectedValue(new ArkmePluginError('upstream', 'missing', false, status))
    expect(await f.service.state(q)).toMatchObject({ supported: false, result: null })
    expect(f.post.mock.calls.every(c => c[0].endsWith('/capabilities'))).toBe(true)
  })
  it.each([401, 503])('preserves %s failures', async status => {
    const f = fixture(); f.post.mockRejectedValue(new ArkmePluginError('upstream', 'auth or network', false, status))
    await expect(f.service.state(q)).rejects.toThrow('auth or network')
  })
  it('validates account and sealed conversation before network access', async () => {
    const f = fixture()
    await expect(f.service.state({ ...q, accountScope: 'prod:8' })).rejects.toThrow('账号已变化')
    expect(f.post).not.toHaveBeenCalled()
    await f.service.state(q)
    expect(f.sources.openSourceRef).toHaveBeenCalledWith('signed', 7)
    f.sources.openSourceRef.mockRejectedValue(new Error('invalid ref'))
    await expect(f.service.state(q)).rejects.toThrow('invalid ref')
  })
  it.each(['topic', 'official_author'])('rejects non-chat kind %s', async kind => { await expect(fixture(kind).service.state(q)).rejects.toThrow('有效的私聊或群聊') })
  it('rejects private peer selection for groups and late responses after account switch', async () => {
    await expect(fixture('group_chat').service.state({ ...q, sender: 'peer' })).rejects.toThrow('有效的私聊或群聊')
    const f = fixture(); f.post.mockImplementationOnce(async () => { f.change(); return capability })
    await expect(f.service.state(q)).rejects.toThrow('账号已变化')
  })
  it('requires full history capability and forwards only scoped, idempotent create parameters', async () => {
    const f = fixture(); f.post.mockResolvedValueOnce({ ...capability, full_history: false })
    await expect(f.service.state(q)).rejects.toThrow('不兼容')
    const requestId = '00000000-0000-4000-8000-000000000000'
    f.post.mockResolvedValueOnce(capability).mockResolvedValueOnce({ ...state, request_id: requestId })
    await f.service.create({ ...q, requestId, texts: ['not sent'] })
    expect(f.post).toHaveBeenLastCalledWith('/api/v1/chats/word-frequency/create', { ...env, request_id: requestId }, expect.anything(), undefined, expect.objectContaining({ lane: 'write' }))
    f.post.mockResolvedValueOnce(capability).mockResolvedValueOnce({ ...state, request_id: 'other' })
    await expect(f.service.create({ ...q, requestId })).rejects.toThrow('尚未确认')
  })
  it('retains departed historical senders and verifies search response scope', async () => {
    const f = fixture('group_chat'), person = { ref: 'p1', name: '周鹏', isSelf: false, former: true }
    f.post.mockResolvedValue({ ...env, search: '周', items: [person], next_cursor: 'next' })
    expect(await f.service.participants({ ...q, search: '周' })).toEqual({ items: [person], nextCursor: 'next' })
    expect(f.post).toHaveBeenLastCalledWith(expect.stringContaining('/participants'), expect.objectContaining({ search: '周', limit: 50 }), expect.anything(), undefined, expect.objectContaining({ lane: 'interactive-read' }))
    await expect(f.service.participants({ ...q, search: '张' })).rejects.toThrow('搜索结果已变化')
  })
  it('checks source against exact snapshot, conversation, and current availability', async () => {
    const f = fixture()
    const source = { ...env, available: true, result_id: 'r1', source_ref: 'opaque', message_uid: 'm1', send_at: 100 }
    f.post.mockResolvedValue(source)
    expect(await f.service.source({ ...q, resultId: 'r1', messageSourceRef: 'opaque' })).toEqual({ messageUid: 'm1', sendAtMillis: 100 })
    for (const patch of [{ available: false }, { result_id: 'old' }, { source_ref: 'wrong' }, { chat_session_uid: 'another' }]) {
      f.post.mockResolvedValueOnce({ ...source, ...patch })
      await expect(f.service.source({ ...q, resultId: 'r1', messageSourceRef: 'opaque' })).rejects.toThrow()
    }
  })
})
