import { describe, it, expect, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { ChatService } from '../../src/services/chat-service.js'
import { ArkmeService } from '../../src/arkme-service.js'
import { ArkmePluginError } from '../../src/services/service.js'
import { quoteSourceContent, type ArkmeMessageQuote } from '../../src/message-quote.js'
const source = { textContent: '请检查通知', title: '', textFormat: 'plain' as const }
const quote: ArkmeMessageQuote = { version: 1, projection: 'arkme-text-v1', sourceDigest: createHash('sha256').update(quoteSourceContent(source)).digest('hex'), start: 1, end: 5, text: '检查通知', prefix: '请', suffix: '' }
function fixture(response: unknown = { quote_reply: { protocol_version: 1, enabled: true, projection: 'arkme-text-v1', max_quote_length: 2000 } }) {
  const post = vi.fn(async () => response)
  const service = Object.create(ChatService.prototype) as ChatService
  Object.assign(service, { runtime: { requireSession: vi.fn(async () => ({ userId: 42 })), authenticatedChatPost: post },
    source: { openSourceRef: vi.fn(async () => ({ kind: 'private_chat', ownerRef: 'chat1' })) },
    openMessageActionRef: vi.fn(async () => source) })
  return { service, post }
}
describe('quote reply owner contract', () => {
  it('validates a signed source snapshot and the declared capability', async () => {
    const { service, post } = fixture()
    await expect(service.validateQuoteReply('source', 'action', quote)).resolves.toEqual(quote)
    expect(post).toHaveBeenCalledWith('/api/v1/chats/extensions/capabilities', { chat_session_uid: 'chat1' }, { userId: 42 }, undefined)
  })
  it.each([undefined, { quote_reply: { enabled: true } }, { quote_reply: { protocol_version: 2, enabled: true } }])('does not guess support from a partial response', async value => {
    const { service, post } = fixture(); post.mockResolvedValue(value)
    await expect(service.validateQuoteReply('source', 'action', quote)).rejects.toMatchObject({ code: 'message-quote-unavailable' })
  })
  it.each([404, 405, 501])('treats an explicit unsupported status %s as unavailable', async code => {
    const { service, post } = fixture(); post.mockRejectedValue(new ArkmePluginError('http', 'unsupported', false, code))
    await expect(service.sourceMessageExtensionCapabilities('source')).resolves.toMatchObject({ supported: false })
  })
  it.each([401, 403, 500])('preserves network/auth errors %s instead of silently downgrading', async code => {
    const { service, post } = fixture(); post.mockRejectedValue(new ArkmePluginError('http', 'failed', true, code))
    await expect(service.sourceMessageExtensionCapabilities('source')).rejects.toMatchObject({ httpStatus: code })
  })
  it('rejects tampered and stale quotations', async () => {
    const { service } = fixture()
    await expect(service.validateQuoteReply('source', 'action', { ...quote, text: '别的内容' })).rejects.toMatchObject({ code: 'message-quote-source-changed' })
    await expect(service.validateQuoteReply('source', 'action', { ...quote, sourceDigest: 'a'.repeat(64) })).rejects.toMatchObject({ code: 'message-quote-source-changed' })
  })
  it('blocks before uploading any attachments when support is unavailable', async () => {
    const uploadRefs = vi.fn()
    const owner = { config: {}, chat: { validateQuoteReply: vi.fn(async () => { throw new ArkmePluginError('message-quote-unavailable', '未接通', false) }) }, filesOwner: () => ({ uploadRefs }) }
    await expect(ArkmeService.prototype.extendSourceMessage.call(owner as never, 'source', 'action', '回复', 'record', ['file'], { quote })).rejects.toMatchObject({ code: 'message-quote-unavailable' })
    expect(uploadRefs).not.toHaveBeenCalled()
  })
  it('projects inaccessible and malformed snapshots without exposing the quoted text', () => {
    const { service } = fixture()
    const project = (service as unknown as { timelineExtensionProjection(v: unknown, userId: number, profiles: Map<string, unknown>): unknown }).timelineExtensionProjection.bind(service)
    const base = { extension_edge: { parent_record_uid: 'parent', parent_record_owner_user_id: 11, quote_reply: quote, quote_reply_state: 'unavailable' } }
    expect(project(base, 42, new Map())).toMatchObject({ extensionParent: { quoteState: 'unavailable', textContent: '' } })
    expect(JSON.stringify(project(base, 42, new Map()))).not.toContain('检查通知')
  })
  it.each([true, false])('requires the create receipt to confirm the exact quote (echo=%s)', async echo => {
    const { service, post } = fixture()
    const recordUid = '11111111-1111-4111-8111-111111111111'
    const relationUid = '22222222-2222-4222-8222-222222222222'
    Object.assign(service, {
      runtime: { config: { maxTextLength: 10000 }, requireSession: async () => ({ userId: 42 }), authenticatedChatPost: post },
      openMessageActionRef: async () => ({ ...source, recordUid: 'original', recordOwnerUserId: 11, chatSessionUid: 'chat1', relationUid: 'original-relation', sourceSequence: 7 }),
      profile: { refreshProfile: async () => ({ profile: { nickname: '我', displayName: '我', avatarRef: '' } }) },
      realtime: { scheduleChatSessionProjection: vi.fn() }, hydrateUploadedExtension: async (item: unknown) => item,
    })
    post.mockImplementation(async (...args: unknown[]) => args[0] === '/api/v1/chats/extensions/capabilities'
      ? { quote_reply: { protocol_version: 1, enabled: true, projection: 'arkme-text-v1', max_quote_length: 2000 } }
      : { child_record_uid: recordUid, seq: 8, ...(echo ? { quote_reply: quote } : {}) })
    const send = service.extendSourceMessage('source', 'action', '回复正文', recordUid, [], { quote, relationUid })
    if (echo) await expect(send).resolves.toMatchObject({ recordUid, localState: 'synced' })
    else await expect(send).rejects.toMatchObject({ code: 'message-quote-receipt-missing', retryable: true })
    expect(post).toHaveBeenCalledWith('/api/v1/chats/extensions/children/create', expect.objectContaining({
      child_record_uid: recordUid, child_rel_uid: relationUid, quote_reply: quote,
      quote_reply_source: { relation_uid: 'original-relation', sequence: 7 },
    }), { userId: 42 }, undefined)
  })
})
