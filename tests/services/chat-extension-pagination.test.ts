import { describe, expect, it, vi } from 'vitest'
import { ChatService } from '../../src/services/chat-service.js'
const quote = { version: 1, projection: 'arkme-text-v1', sourceDigest: 'a'.repeat(64), start: 0, end: 2, text: '原文', prefix: '', suffix: '' }
const after = (n: number) => ({ created_at: 1000 + n, child_record_owner_user_id: '6690025278483443577', child_record_uid: `child-${n}` })
const child = (n: number) => ({ edge: { parent_record_uid: 'parent', parent_record_owner_user_id: 7, child_record_uid: `child-${n}`, child_record_owner_user_id: '6690025278483443577', quote_reply: quote, quote_reply_state: 'available' },
  item: { relation: { record_uid: `child-${n}`, seq: n + 1, rel_uid: `relation-${n}`, attach_at: 1000 + n }, record: { status: 1, payload: { text_content: `评论${n}` } } } })
function fixture(post: (body: Record<string, unknown>, signal?: AbortSignal) => unknown) {
  const session = { userId: 42, accessToken: 'test', refreshToken: 'test' }
  const reference = { recordUid: 'parent', recordOwnerUserId: 7, chatSessionUid: 'chat-one', relationUid: 'original-relation', sourceSequence: 11 }
  const chat = Object.create(ChatService.prototype) as ChatService
  const request = vi.fn(async (_path: string, body: Record<string, unknown>, _session: unknown, signal?: AbortSignal) => await post(body, signal))
  Object.assign(chat, { runtime: { requireSession: async () => session, stateStore: { uniqueCode: async () => 'test-signing-key' }, authenticatedChatPost: request },
    source: { openSourceRef: async () => ({ kind: 'group_chat' }) }, openMessageActionRef: async () => reference,
    timelineMentionTargets: async () => undefined, hydrateExtensionMedia: async (projections: Array<{ extension: unknown }>) => projections.map(p => p.extension),
  })
  return { chat, request, session, reference }
}
describe('chat extension tree pagination', () => {
  it('follows the existing cursor beyond 100 comments, deduplicates overlap and retains quotes and large owner IDs', async () => {
    const { chat, request } = fixture(body => body.after_cursor ? { children: [child(99), ...Array.from({ length: 25 }, (_, i) => child(i + 100))], has_more: false }
      : { children: Array.from({ length: 100 }, (_, i) => child(i)), has_more: true, next_after_cursor: after(99) })
    const result = await chat.sourceMessageExtensionContext('source', 'action')
    expect(result.extensions).toHaveLength(125); expect(result.extensionCount).toBe(125); expect(result.nextCursor).toBeUndefined()
    expect(request.mock.calls[1]![1].after_cursor).toEqual(after(99))
    expect(result.extensions.find(x => x.recordUid === 'child-124')).toMatchObject({ quote, quoteState: 'available', recordOwnerUserId: '6690025278483443577' })
  })
  it('returns one page on request and binds the signed cursor to the account, conversation and original occurrence', async () => {
    const { chat, request, session, reference } = fixture(body => body.after_cursor ? { children: [child(1)], has_more: false } : { children: [child(0)], has_more: true, next_after_cursor: after(0) })
    const first = await chat.sourceMessageExtensionContext('source', 'action', { paginated: true })
    expect(first.extensions).toHaveLength(1); expect(request).toHaveBeenCalledTimes(1)
    const cursor = first.nextCursor!
    expect(cursor).toMatch(/^arkme-extension-page-v1\./)
    const page = await chat.sourceMessageExtensionContext('source', 'action', { paginated: true, pageCursor: cursor })
    expect(page.extensions.map(x => x.recordUid)).toEqual(['child-1']); expect(page.nextCursor).toBeUndefined()
    for (const change of [() => { session.userId = 43 }, () => { session.userId = 42; reference.chatSessionUid = 'other-chat' }, () => { reference.chatSessionUid = 'chat-one'; reference.sourceSequence = 99 }]) {
      change()
      await expect(chat.sourceMessageExtensionContext('source', 'action', { paginated: true, pageCursor: cursor })).rejects.toMatchObject({ code: 'extension-cursor-invalid' })
    }
    expect(request).toHaveBeenCalledTimes(2)
  })
  it.each([undefined, {}, { ...after(0), created_at: -1 }])('rejects has_more with invalid cursor %j rather than claiming completeness', async cursor => {
    const { chat } = fixture(() => ({ children: [child(0)], has_more: true, next_after_cursor: cursor }))
    await expect(chat.sourceMessageExtensionContext('source', 'action')).rejects.toMatchObject({ code: 'extension-pagination-invalid' })
  })
  it('stops a repeated cursor and respects cancellation before reading any further page', async () => {
    const repeated = fixture(() => ({ children: [child(0)], has_more: true, next_after_cursor: after(0) }))
    await expect(repeated.chat.sourceMessageExtensionContext('source', 'action')).rejects.toMatchObject({ code: 'extension-pagination-invalid' })
    expect(repeated.request).toHaveBeenCalledTimes(2)
    const controller = new AbortController()
    const cancelled = fixture(() => { controller.abort(); return { children: [child(0)], has_more: true, next_after_cursor: after(0) } })
    await expect(cancelled.chat.sourceMessageExtensionContext('source', 'action', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(cancelled.request).toHaveBeenCalledTimes(1)
  })
})

it('carries the signed continuation and cancellation from the SDK through the Host owner', async () => {
  const { createArkmeSdk } = await import('../../src/sdk/index.js')
  const { dispatchArkmeHostOperation } = await import('../../src/host-api.js')
  const result = { parentRecordUid: 'parent', extensionCount: 0, extensions: [] }
  const service = { sourceMessageExtensionContext: vi.fn(async () => result) }
  const sdk = createArkmeSdk({ fetchImpl: async (_url, init) => {
    const body = JSON.parse(String(init?.body))
    const value = await dispatchArkmeHostOperation(service as never, body.operation, body.params, undefined, undefined, undefined, undefined, init?.signal as AbortSignal)
    return new Response(JSON.stringify({ ok: true, value }))
  } })
  const controller = new AbortController()
  await expect(sdk.sourceMessageExtensionPage('source', 'action', { cursor: 'signed-page', signal: controller.signal })).resolves.toEqual(result)
  expect(service.sourceMessageExtensionContext).toHaveBeenCalledExactlyOnceWith('source', 'action', { paginated: true, pageCursor: 'signed-page', signal: controller.signal })
})

it('keeps each extension occurrence Team display through pagination without inheriting the parent or origin', async () => {
  const first = child(0), personal = child(1), other = child(2)
  Object.assign(first.item.relation, { representation: { team_id: '7', name: '团队7', jotmo_id: 'team_7', membership_revision: 3 } })
  Object.assign(personal.item.record.payload, { origin_representation: { team_id: '7', name: '原文团队', jotmo_id: 'origin' } })
  Object.assign(other.item.relation, { representation: { team_id: '8', name: '团队8', jotmo_id: 'team_8' } })
  const { chat } = fixture(body => body.after_cursor ? { children: [other], has_more: false } : { children: [first, personal], has_more: true, next_after_cursor: after(1) })
  const result = await chat.sourceMessageExtensionContext('source', 'action')
  expect(result.extensions.find(x => x.recordUid === 'child-0')?.representation).toEqual({ name: '团队7', jotmoId: 'team_7' })
  expect(result.extensions.find(x => x.recordUid === 'child-1')?.representation).toBeUndefined()
  expect(result.extensions.find(x => x.recordUid === 'child-2')?.representation).toEqual({ name: '团队8', jotmoId: 'team_8' })
})

it('passes only the public Team label through the existing copy-link Host owner', async () => {
  const chat = Object.create(ChatService.prototype) as ChatService
  Object.assign(chat, { runtime: { requireSession: async () => ({ userId: 42 }), authenticatedChatPost: async () => ({
    sid: 'U2HQgn1RhPJZaFmx', access_mode: 'link_read_only', items: [
      { sender_display_name: '作者', text_content: '团队发言', send_at: 1787733600000, template_kind: 1,
        representation: { name: '团队7', jotmo_id: 'team_7', team_id: '7', membership_revision: 3 } },
      { sender_display_name: '作者', text_content: '个人转发', send_at: 1787733600000, template_kind: 1,
        origin_representation: { name: '原文团队', jotmo_id: 'origin' } },
    ], presentation: [{ kind: 'forward_bundle', title: '转发', sender_display_name: '作者', representation: { name: '团队8', jotmo_id: 'team_8' }, children: [{kind: 'item', item_index: 0}, {kind: 'item', item_index: 1}] }],
  }) } })
  const value = await chat.resolveMessageCopyLink('U2HQgn1RhPJZaFmx')
  expect(value.items[0]?.representation).toEqual({ name: '团队7', jotmoId: 'team_7' })
  expect(value.items[1]?.representation).toBeUndefined()
  expect(value.presentation?.[0]).toMatchObject({ representation: { name: '团队8', jotmoId: 'team_8' } })
  expect(JSON.stringify(value)).not.toMatch(/team_id|membership_revision|teamRef/)
})
