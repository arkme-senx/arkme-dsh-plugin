import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { ArkmeArkoHistoryItem } from '../../src/types.js'
import {
  ArkmeMessageActionGateway,
  LocalMessageActionCapabilityCodec,
} from '../../src/services/message-action-infrastructure.js'
import { MessageActionService } from '../../src/services/message-action-service.js'

const userId = 42
const signingKey = 'message-action-test-signing-key'

function historyItem(overrides: Partial<ArkmeArkoHistoryItem> = {}): ArkmeArkoHistoryItem {
  return {
    messageId: 101,
    sessionId: 88,
    role: 'assistant',
    text: '最终回答',
    reasoning: '不应被操作的推理',
    createdAtMillis: 1_786_000_000_000,
    status: 1,
    createdRecordUids: [],
    ...overrides,
  }
}

function runtime(overrides: Record<string, unknown> = {}) {
  return {
    config: { maxTextLength: 20_000 },
    stateStore: { uniqueCode: vi.fn(async () => signingKey) },
    requireSession: vi.fn(async () => ({ userId, accessToken: 'access', refreshToken: 'refresh' })),
    authenticatedChatPost: vi.fn(async () => ({ sid: 'share-sid', url: 'https://jotmo.example/s/share-sid' })),
    authenticatedPost: vi.fn(async (_path: string, body: Record<string, unknown>) => body.topic_uid ? { record_uid: body.record_uid, record_status: 1, topic_uid: body.topic_uid, rel_uid: 'rel', relation_status: 1 } : { record_uid: body.record_uid, status: 1 }),
    ...overrides,
  }
}

function messageActionService(
  ownerRuntime: ReturnType<typeof runtime>,
  source: Record<string, unknown> = {},
  bot: Record<string, unknown> = {},
): MessageActionService {
  return new MessageActionService(
    new ArkmeMessageActionGateway(ownerRuntime as never, source as never),
    bot as never,
    new LocalMessageActionCapabilityCodec(async () => await ownerRuntime.stateStore.uniqueCode()),
  )
}

const forwardRecordUid = '019d8592-ebb4-7232-90f2-000000000001'
const forwardCommentUid = '019d8592-ebb4-7232-90f2-000000000002'

function tamperAgentMessageId(actionRef: string): string {
  const [prefix = '', ivText = '', encryptedText = '', tagText = ''] = actionRef.split('.')
  const key = createHash('sha256').update(signingKey).update(`\0${prefix}`).digest()
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivText, 'base64url'))
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'))
  const raw = JSON.parse(Buffer.concat([
    decipher.update(Buffer.from(encryptedText, 'base64url')),
    decipher.final(),
  ]).toString('utf8')) as Record<string, unknown>
  raw.agentMessageId = 0
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(raw), 'utf8'), cipher.final()])
  return `${prefix}.${iv.toString('base64url')}.${encrypted.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}`
}

describe('MessageActionService', () => {
  it('projects stable Agent text only and keeps reasoning outside the opaque action contract', async () => {
    const service = messageActionService(runtime())
    const stable = await service.agentHistoryItem(historyItem(), userId)
    const conversationRef = await service.agentConversationRef(userId, 88)
    const pending = await service.agentHistoryItem(historyItem({ status: 2 }), userId)

    expect(stable.messageActionRef).not.toContain('最终回答')
    expect(stable.messageActionRef).not.toContain('不应被操作的推理')
    const decodedCapabilitySegments = [stable.messageActionRef ?? '', conversationRef]
      .flatMap(ref => ref.split('.').slice(1).map(segment => Buffer.from(segment, 'base64url').toString('utf8')))
      .join('\n')
    expect(decodedCapabilitySegments).not.toContain('最终回答')
    expect(decodedCapabilitySegments).not.toContain('"sessionId":88')
    expect(decodedCapabilitySegments).not.toContain('"userId":42')
    expect(stable.messageActionCapabilities).toEqual({ copyLink: true, forward: true })
    expect(pending).toEqual({})
  })

  it('uses entry_record_uid for an Agent user copy link and never created_record_uids', async () => {
    const ownerRuntime = runtime()
    const service = messageActionService(ownerRuntime)
    const conversationRef = await service.agentConversationRef(userId, 88)
    const projected = await service.agentHistoryItem(historyItem({
      messageId: 100,
      role: 'user',
      entryRecordUid: 'entry-record',
      createdRecordUids: ['side-effect-record'],
    }), userId)

    await service.copyLink(conversationRef, [projected.messageActionRef ?? ''])

    expect(ownerRuntime.authenticatedChatPost).toHaveBeenCalledWith(
      '/api/v1/chats/messages/copy-link/get-or-create',
      { sources: [{ kind: 'record', record_owner_user_id: userId, record_uid: 'entry-record' }] },
      expect.objectContaining({ userId }),
      undefined,
    )
  })

  it('rejects a correctly signed but owner-incomplete Agent message reference before remote access', async () => {
    const ownerRuntime = runtime()
    const service = messageActionService(ownerRuntime)
    const conversationRef = await service.agentConversationRef(userId, 88)
    const projected = await service.agentHistoryItem(historyItem(), userId)
    const invalidRef = tamperAgentMessageId(projected.messageActionRef ?? '')

    await expect(service.copyLink(conversationRef, [invalidRef])).rejects.toMatchObject({ code: 'message-action-ref-invalid' })
    expect(ownerRuntime.authenticatedChatPost).not.toHaveBeenCalled()
  })

  it('sorts Agent forward snapshots by owner order and excludes reasoning', async () => {
    const ownerRuntime = runtime({
      authenticatedChatPost: vi.fn(async () => ({ record_uid: forwardRecordUid, seq: 9, audit_status: 1 })),
    })
    const source = { openSourceRef: vi.fn(async () => ({ kind: 'private_chat', ownerRef: 'chat-target' })) }
    const service = messageActionService(ownerRuntime, source)
    const conversationRef = await service.agentConversationRef(userId, 88)
    const later = await service.agentHistoryItem(historyItem({ messageId: 102, text: '第二条', reasoning: '秘密二' }), userId)
    const earlier = await service.agentHistoryItem(historyItem({ messageId: 101, text: '第一条', reasoning: '秘密一' }), userId)

    await service.forward(conversationRef, [later.messageActionRef ?? '', earlier.messageActionRef ?? ''], {
      targetSourceRef: 'opaque-target',
      requestId: 'request-stable',
      recordUid: forwardRecordUid,
      sendAtMillis: 1_786_000_123_000,
    })

    expect(ownerRuntime.authenticatedChatPost).toHaveBeenCalledWith(
      '/api/v1/chats/records/forward',
      expect.objectContaining({
        chat_session_uid: 'chat-target',
        client_request_id: 'request-stable',
        source_items: [
          expect.objectContaining({ source_type: 'agent', snapshot_text: '第一条', source_identity_id: '88:101' }),
          expect.objectContaining({ source_type: 'agent', snapshot_text: '第二条', source_identity_id: '88:102' }),
        ],
      }),
      expect.objectContaining({ userId }),
      undefined,
    )
    expect(JSON.stringify(ownerRuntime.authenticatedChatPost.mock.calls)).not.toContain('秘密')
  })

  it('preserves Agent snapshot text while safely clipping the Record forward preview', async () => {
    const ownerRuntime = runtime()
    const source = { openSourceRef: vi.fn(async () => ({ kind: 'send_to_self', ownerRef: 'self' })), invalidateSourceListCache: vi.fn() }
    const service = messageActionService(ownerRuntime, source)
    const text = '文'.repeat(495) + '[jm_emoji:heart_eyes]'
    const conversationRef = await service.agentConversationRef(userId, 88)
    const projected = await service.agentHistoryItem(historyItem({ text }), userId)
    await service.forward(conversationRef, [projected.messageActionRef!], {
      targetSourceRef: 'opaque-target', requestId: 'request-stable', recordUid: forwardRecordUid, sendAtMillis: 1_786_000_123_000,
    })
    expect(ownerRuntime.authenticatedPost.mock.calls[0]?.[1]).toMatchObject({ content_payload: { forward_records: {
      items: [{ source_kind: 'agent_message', text, text_preview: '文'.repeat(495) }],
    } } })
  })

  it('keeps an Agent entry Record owner distinct from Chat relation identity', async () => {
    const ownerRuntime = runtime()
    const source = {
      openSourceRef: vi.fn(async () => ({ kind: 'send_to_self', ownerRef: 'self' })),
      invalidateSourceListCache: vi.fn(),
    }
    const service = messageActionService(ownerRuntime, source)
    const conversationRef = await service.agentConversationRef(userId, 88)
    const projected = await service.agentHistoryItem(historyItem({
      messageId: 100,
      role: 'user',
      entryRecordUid: 'agent-entry-record',
    }), userId)

    await service.forward(conversationRef, [projected.messageActionRef ?? ''], {
      targetSourceRef: 'opaque-target', requestId: 'request-stable', recordUid: forwardRecordUid,
      sendAtMillis: 1_786_000_123_000,
    })

    expect(ownerRuntime.authenticatedPost.mock.calls[0]?.[1]).toMatchObject({
      content_payload: {
        forward_records: {
          items: [{
            source_kind: 'agent_message',
            source_type: 'agent',
            record_uid: 'agent-entry-record',
            owner_id: userId,
          }],
        },
      },
    })
    expect(JSON.stringify(ownerRuntime.authenticatedPost.mock.calls[0]?.[1])).not.toContain('source_rel_uid')
  })

  it('maps a Chat Bot message only through its Chat relation copy-link identity', async () => {
    const ownerRuntime = runtime()
    const bot = { openBotRef: vi.fn(async () => ({
      target: { kind: 'chat', chatSessionUid: 'chat-owner' },
    })) }
    const service = messageActionService(ownerRuntime, {}, bot)
    const projected = await service.chatBotMessage({
      userId,
      chatSessionUid: 'chat-owner',
      relationUid: 'relation-owner',
      recordUid: 'chat-record',
      messageIdentity: 'chat-message',
      role: 'assistant',
      textContent: 'Chat Bot 回复',
      createdAtMillis: 1_786_000_000_000,
      sequence: 7,
      senderUserId: 0,
      senderName: '坏基米',
    })

    await service.copyLink('opaque-chat-bot', [projected?.messageActionRef ?? ''])

    expect(ownerRuntime.authenticatedChatPost).toHaveBeenCalledWith(
      '/api/v1/chats/messages/copy-link/get-or-create',
      { sources: [{ kind: 'chat_relation', chat_session_uid: 'chat-owner', relation_uid: 'relation-owner' }] },
      expect.objectContaining({ userId }),
      undefined,
    )
  })

  it('maps a Subject user message only through its Record copy-link identity', async () => {
    const ownerRuntime = runtime()
    const bot = { openBotRef: vi.fn(async () => ({ target: { kind: 'subject', subjectUid: 'subject-owner' } })) }
    const service = messageActionService(ownerRuntime, {}, bot)
    const projected = await service.subjectBotMessage({
      userId,
      subjectUid: 'subject-owner',
      messageIdentity: 'subject-user-message',
      recordUid: 'subject-user-record',
      role: 'user',
      textContent: '我的消息',
      createdAtMillis: 1_786_000_000_000,
    })

    await service.copyLink('opaque-subject-bot', [projected?.messageActionRef ?? ''])

    expect(ownerRuntime.authenticatedChatPost).toHaveBeenCalledWith(
      '/api/v1/chats/messages/copy-link/get-or-create',
      { sources: [{ kind: 'record', record_owner_user_id: userId, record_uid: 'subject-user-record' }] },
      expect.objectContaining({ userId }),
      undefined,
    )
  })

  it('keeps every timestamp and identity stable when a Record-target forward is retried', async () => {
    const ownerRuntime = runtime()
    const source = {
      openSourceRef: vi.fn(async () => ({ kind: 'send_to_self', ownerRef: 'self' })),
      invalidateSourceListCache: vi.fn(),
    }
    const service = messageActionService(ownerRuntime, source)
    const conversationRef = await service.agentConversationRef(userId, 88)
    const projected = await service.agentHistoryItem(historyItem(), userId)
    const options = {
      targetSourceRef: 'opaque-target', requestId: 'request-stable', recordUid: forwardRecordUid,
      commentRecordUid: forwardCommentUid, commentText: '附言', sendAtMillis: 1_786_000_123_000,
    }

    await service.forward(conversationRef, [projected.messageActionRef ?? ''], options)
    await service.forward(conversationRef, [projected.messageActionRef ?? ''], options)

    expect(ownerRuntime.authenticatedPost).toHaveBeenCalledTimes(4)
    expect(ownerRuntime.authenticatedPost.mock.calls[0]?.[1]).toEqual(ownerRuntime.authenticatedPost.mock.calls[2]?.[1])
    expect(ownerRuntime.authenticatedPost.mock.calls[1]?.[1]).toEqual(ownerRuntime.authenticatedPost.mock.calls[3]?.[1])
    expect(ownerRuntime.authenticatedPost.mock.calls[0]?.[1]).toMatchObject({
      record_uid: forwardRecordUid,
      send_at: options.sendAtMillis,
      content_payload: { forward_records: { created_at: options.sendAtMillis } },
    })
    expect(ownerRuntime.authenticatedPost.mock.calls[1]?.[1]).toMatchObject({
      record_uid: forwardCommentUid,
      send_at: options.sendAtMillis + 1,
    })
  })

  it('rejects malformed write identities before any forward mutation', async () => {
    const ownerRuntime = runtime()
    const source = { openSourceRef: vi.fn(async () => ({ kind: 'send_to_self', ownerRef: 'self' })) }
    const service = messageActionService(ownerRuntime, source)
    const conversationRef = await service.agentConversationRef(userId, 88)
    const projected = await service.agentHistoryItem(historyItem(), userId)

    await expect(service.forward(conversationRef, [projected.messageActionRef ?? ''], {
      targetSourceRef: 'opaque-target', requestId: 'request-stable', recordUid: 'not-a-record-uid',
      sendAtMillis: 1_786_000_123_000,
    })).rejects.toMatchObject({ code: 'message-actions-request-invalid' })
    expect(ownerRuntime.authenticatedPost).not.toHaveBeenCalled()
  })

  it('does not invent a Chat forward Record identity when the accepted response omits it', async () => {
    const ownerRuntime = runtime({ authenticatedChatPost: vi.fn(async () => ({ seq: 9, audit_status: 1 })) })
    const source = { openSourceRef: vi.fn(async () => ({ kind: 'private_chat', ownerRef: 'chat-target' })) }
    const service = messageActionService(ownerRuntime, source)
    const conversationRef = await service.agentConversationRef(userId, 88)
    const projected = await service.agentHistoryItem(historyItem(), userId)

    await expect(service.forward(conversationRef, [projected.messageActionRef ?? ''], {
      targetSourceRef: 'opaque-target', requestId: 'request-stable', recordUid: forwardRecordUid,
      sendAtMillis: 1_786_000_123_000,
    })).rejects.toMatchObject({ code: 'message-actions-forward-outcome-unknown' })
  })

  it('forwards a Subject assistant Record without fabricating its copy-link owner', async () => {
    const ownerRuntime = runtime({
      authenticatedChatPost: vi.fn(async (path: string) => path.endsWith('/forward')
        ? { record_uid: forwardRecordUid, seq: 9, audit_status: 1 }
        : { sid: 'unexpected', url: 'https://jotmo.example/unexpected' }),
    })
    const source = { openSourceRef: vi.fn(async () => ({ kind: 'private_chat', ownerRef: 'chat-target' })) }
    const bot = { openBotRef: vi.fn(async () => ({
      version: 1, userId, botId: 'bot-subject', target: { kind: 'subject', subjectUid: 'subject-one' },
    })) }
    const service = messageActionService(ownerRuntime, source, bot)
    const projected = await service.subjectBotMessage({
      userId,
      subjectUid: 'subject-one',
      messageIdentity: 'subject-reply',
      recordUid: 'subject-reply-record',
      role: 'assistant',
      textContent: '助手回复',
      createdAtMillis: 1_786_000_000_000,
    })

    expect(projected?.messageActionCapabilities).toEqual({ copyLink: false, forward: true })
    await expect(service.copyLink('opaque-subject-bot', [projected?.messageActionRef ?? '']))
      .rejects.toMatchObject({ code: 'message-actions-source-unavailable' })
    expect(ownerRuntime.authenticatedChatPost).not.toHaveBeenCalled()

    await service.forward('opaque-subject-bot', [projected?.messageActionRef ?? ''], {
      targetSourceRef: 'opaque-target', requestId: 'request-stable', recordUid: forwardRecordUid,
      sendAtMillis: 1_786_000_123_000,
    })

    expect(ownerRuntime.authenticatedChatPost).toHaveBeenCalledWith(
      '/api/v1/chats/records/forward',
      expect.objectContaining({ source_items: [{ source_type: 'record', record_uid: 'subject-reply-record' }] }),
      expect.objectContaining({ userId }),
      undefined,
    )
  })
})

describe('native DSH snapshot forwarding', () => {
  const snapshot = { sessionId: 'local-session', messages: [
    { key: 'user:opaque', role: 'user', text: '**问题**', anchorSeq: 1, createdAtMillis: 1000 },
    { key: 'assistant-step:opaque', role: 'assistant', text: '回答', anchorSeq: 4, createdAtMillis: 2000 },
  ] }
  const options = { targetSourceRef: 'target', requestId: 'native-attempt', recordUid: forwardRecordUid, commentRecordUid: forwardCommentUid, sendAtMillis: 1_786_000_123_000 }
  it('uses immutable Markdown snapshots and DSH identities without guessing Arkme Agent or Record IDs', async () => {
    const r = runtime({ authenticatedChatPost: vi.fn(async () => ({ record_uid: 'delivered', seq: 3 })) })
    const service = messageActionService(r, { openSourceRef: async () => ({ kind: 'private_chat', ownerRef: 'target-chat' }) })
    const result = await service.forwardNative(snapshot, userId, options)
    expect(result.itemUid).toBe('delivered')
    const body = r.authenticatedChatPost.mock.calls[0]?.[1] as Record<string, unknown>
    expect(body.source_items).toEqual(snapshot.messages.map((message, index) => ({ source_type: 'agent', render_format: 'markdown', source_identity_kind: 'agent_message', source_identity_id: expect.stringMatching(/^dsh:[0-9a-f]{64}$/), snapshot_text: message.text, source_sender_user_id: index === 0 ? userId : 0, ...(index === 0 ? {} : { source_avatar_kind: 'deepseek' }) })))
    expect(JSON.stringify(body)).not.toContain('agent_session_id')
    expect(JSON.stringify(body.source_items)).not.toContain('record_uid')
    await service.forwardNative(snapshot, userId, options)
    expect(r.authenticatedChatPost.mock.calls[1]?.[1]).toEqual(body)
  })
  it('creates a Record forward bundle without creating source records and preserves original timestamps', async () => {
    const r = runtime()
    const source = { openSourceRef: async () => ({ kind: 'topic', ownerRef: 'topic' }), invalidateSourceListCache: vi.fn() }
    await messageActionService(r, source).forwardNative(snapshot, userId, options)
    expect(r.authenticatedPost).toHaveBeenCalledTimes(1)
    const [path, body] = r.authenticatedPost.mock.calls[0] as unknown as [string, { content_payload: { forward_records: { source_record_uids: string[]; items: Array<Record<string, unknown>> } } }]
    expect(path).toBe('/api/v1/topics/records/create')
    const payload = body.content_payload.forward_records
    expect(payload.source_record_uids).toEqual([])
    expect(payload.items.map(item => item.send_at)).toEqual([1000, 2000])
    expect(payload.items.map(item => item.source_display_name)).toEqual(['我', 'DeepSeek Harness'])
    expect(payload.items.map(item => item.source_avatar_kind)).toEqual([undefined, 'deepseek'])
    expect(payload.items.every(item => !('record_uid' in item))).toBe(true)
  })
  it('rejects account mismatch, duplicate identities, wrong order, unsupported roles and oversized text before writes', async () => {
    const r = runtime(); const target = vi.fn()
    const service = messageActionService(r, { openSourceRef: target })
    await expect(service.forwardNative(snapshot, 99, options)).rejects.toMatchObject({ code: 'native-forward-account-changed' })
    for (const invalid of [null, {}, { ...snapshot, messages: [] }, { ...snapshot, messages: [...snapshot.messages].reverse() },
      { ...snapshot, messages: [snapshot.messages[0], snapshot.messages[0]] },
      { ...snapshot, messages: [{ ...snapshot.messages[0], role: 'tool' }] },
      { ...snapshot, messages: [{ ...snapshot.messages[0], text: 'x'.repeat(256 * 1024 + 1) }] }]) {
      await expect(service.forwardNative(invalid, userId, options)).rejects.toMatchObject({ code: 'native-selection-snapshot-invalid' })
    }
    expect(target).not.toHaveBeenCalled()
    expect(r.authenticatedPost).not.toHaveBeenCalled(); expect(r.authenticatedChatPost).not.toHaveBeenCalled()
  })
})

describe('Record forwarding receipt facts', () => {
  const snapshot = { sessionId: 'local', messages: [{ key: 'one', role: 'user', text: 'hello', anchorSeq: 1, createdAtMillis: 1000 }] }
  const options = { targetSourceRef: 'target', requestId: 'receipt', recordUid: forwardRecordUid, commentRecordUid: forwardCommentUid, sendAtMillis: 1000 }
  it.each([
    { kind: 'send_to_self', receipt: {} },
    { kind: 'send_to_self', receipt: { record_uid: 'other', status: 1 } },
    { kind: 'send_to_self', receipt: { record_uid: forwardRecordUid, status: 2 } },
    { kind: 'topic', receipt: { record_uid: forwardRecordUid, status: 1 } },
    { kind: 'topic', receipt: { record_uid: forwardRecordUid, record_status: 1, topic_uid: 'topic', relation_status: 2, rel_uid: 'rel' } },
    { kind: 'topic', receipt: { record_uid: forwardRecordUid, record_status: 1, topic_uid: 'wrong', relation_status: 1, rel_uid: 'rel' } },
  ])('does not invent confirmed delivery from incomplete or mismatched $kind receipts', async ({ kind, receipt }) => {
    const r = runtime({ authenticatedPost: vi.fn(async () => receipt) })
    const invalidateSourceListCache = vi.fn()
    const service = messageActionService(r, { openSourceRef: async () => ({ kind, ownerRef: 'topic' }), invalidateSourceListCache })
    await expect(service.forwardNative(snapshot, userId, { ...options, commentText: 'note' })).rejects.toMatchObject({ code: 'message-actions-forward-outcome-unknown' })
    expect(r.authenticatedPost).toHaveBeenCalledTimes(1)
    expect(invalidateSourceListCache).not.toHaveBeenCalled()
  })
  it('distinguishes confirmed primary content from an unconfirmed comment', async () => {
    const r = runtime({ authenticatedPost: vi.fn().mockResolvedValueOnce({ record_uid: forwardRecordUid, status: 1 }).mockResolvedValueOnce({}) })
    const result = await messageActionService(r, { openSourceRef: async () => ({ kind: 'send_to_self', ownerRef: 'self' }), invalidateSourceListCache() {} }).forwardNative(snapshot, userId, { ...options, commentText: 'note' })
    expect(result.itemUid).toBe(forwardRecordUid)
    expect(result.warningText).toBe('转发已完成，附言发送失败')
  })
})


describe('native DSH copy link owner boundary', () => {
  const snapshot = { sessionId: 'local-session', messages: [{ key: 'u1', anchorSeq: 1, role: 'user', text: '    code()\n', createdAtMillis: 1000 }, { key: 'a1', anchorSeq: 2, role: 'assistant', text: '**answer**', createdAtMillis: 2000 }] }
  it('uses the original link endpoint with explicit local content, without writing records or sending chat', async () => {
    const rt = runtime(); const service = messageActionService(rt)
    await expect(service.copyLinkNative(snapshot, userId)).resolves.toMatchObject({ sid: 'share-sid' })
    expect(rt.authenticatedChatPost).toHaveBeenCalledWith('/api/v1/chats/messages/copy-link/get-or-create', { sources: snapshot.messages.map(item => ({ kind: 'dsh_native', dsh_message: { session_id: snapshot.sessionId, message_id: item.key, role: item.role, text_content: item.text, send_at: item.createdAtMillis } })) }, expect.objectContaining({ userId }), undefined)
    expect(rt.authenticatedPost).not.toHaveBeenCalled()
  })
  it('rejects stale accounts, empty content, duplicates, malformed roles and the copy-specific budget before HTTP', async () => {
    const rt = runtime(); const service = messageActionService(rt)
    await expect(service.copyLinkNative(snapshot, 99)).rejects.toMatchObject({ code: 'native-copy-link-account-changed' })
    for (const messages of [[], [snapshot.messages[0], snapshot.messages[0]], [{ ...snapshot.messages[0], role: 'tool' }], [{ ...snapshot.messages[0], text: ' ' }], [{ ...snapshot.messages[0], text: 'x'.repeat(90_001) }]]) {
      await expect(service.copyLinkNative({ ...snapshot, messages }, userId)).rejects.toThrow()
    }
    expect(rt.authenticatedChatPost).not.toHaveBeenCalled()
  })
})
