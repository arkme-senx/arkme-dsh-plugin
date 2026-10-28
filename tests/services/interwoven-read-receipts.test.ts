import { describe, it, expect, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { InterwovenService } from '../../src/services/interwoven-service.js'

const bridgeUid = (relationUid: string) => `chat_legacy_receive_${createHash('sha256').update(`group:${relationUid}`).digest('hex').slice(0, 32)}`
function fixture({ legacy = false, bridge = false } = {}) {
  let userId = 42
  const group = { session: { chat_session_uid: 'group', session_kind: 2, status: 1, last_seq: 100 },
    current_cursor: { chat_session_uid: 'group', user_id: 42, status: 1, read_seq: 8 },
    unread_snapshot: { read_seq: 8, session_last_seq: 100 } }
  const detail = { chat_session_uid: 'group', record_uid: 'out', seq: 7,
    items: [{ user_id: 7, read_status: 'unread', read_at: 0 }, { user_id: 9, read_status: 'read', read_at: 1700000000000 }] }
  const rows = ['out', 'in'].map((uid, index) => ({ moment_type: 1, moment_id: uid, occurred_at: 1700000000000 + index,
    jump_target: { record_uid: bridge ? bridgeUid(`rel-${uid}`) : uid, ...(legacy || bridge ? { subject_uid: 'group' } : {
      chat_session_uid: 'group', record_owner_user_id: index ? 7 : 42, rel_uid: `rel-${uid}`, seq: index ? 9 : 7,
    }) }, render_payload: { sender_user_id: index ? 7 : 42, group_name: '群聊', content: 'Hi' } }))
  const around = { chat_session_uid: 'group', items: [{ relation: { chat_session_uid: 'group', record_uid: 'out',
    record_owner_user_id: 42, sender_user_id: 42, seq: 7 }, record: { status: 1 } }] }
  const occurrences = { version: 'a'.repeat(64), source_scope: 'chat_group_mentions', scope_complete: true, uncovered_sources: [],
    has_more: false, next_cursor: '', items: ['out', 'in'].map((uid, index) => ({
      private_chat_session_uid: 'private', source_chat_session_uid: 'group', rel_uid: `rel-${uid}`, record_uid: uid,
      record_owner_user_id: index ? 7 : 42, sender_user_id: index ? 7 : 42, sender_is_me: !index, seq: index ? 9 : 7,
    })) }
  const runtime = {
    config: { interwovenMomentsEnabled: true },
    requireSession: vi.fn(async () => ({ userId, accessToken: 'test', refreshToken: 'test' })),
    stateStore: { async uniqueCode() { return 'secret' } },
    authenticatedAuthPost: vi.fn(async () => ({ able: true })),
    authenticatedSubjectPost: vi.fn(async () => ({ exist: false })),
    authenticatedChatPost: vi.fn(async (path: string, body: Record<string, unknown>) => {
      if (path === '/api/v1/chats/detail') return body.chat_session_uid === 'private' ? {
        session: { chat_session_uid: 'private', session_kind: 1 }, private_counterpart: { user_id: 7 },
      } : group
      if (path === '/api/v1/chats/interwoven/inline-bootstrap') return { groups: [{ moment_type: 1, group_preview_items: rows }] }
      if (path === '/api/v1/chats/read-receipts/detail') return detail
      if (path === '/api/v1/chat/timeline/around') return around
      if (path === '/api/v1/chats/interwoven/occurrences/query') return occurrences
      throw new Error(`Unexpected route ${path}`)
    }),
  }
  const source = { openSourceRef: vi.fn(async (ref: string) => ({ kind: 'private_chat', ownerRef: ref, displayName: 'Peer' })) }
  const profile = { interwovenProfilesByUserIds: vi.fn(async () => new Map()) }
  const service = new InterwovenService(runtime as never, source as never, profile as never)
  return { service, runtime, group, detail, rows, around, occurrences, setUser: (id: number) => { userId = id } }
}

describe('original group receipts for private interwoven rows', () => {
  it('uses the peer receipt, not all-group read counts, and my group cursor, not my private cursor', async () => {
    const f = fixture()
    const { moments } = await f.service.interwovenMoments('private')
    f.runtime.authenticatedChatPost.mockClear()
    const refs = moments.map(item => item.momentRef)
    const result = await f.service.interwovenReadReceipts('private', refs)
    expect(result.items.map(item => [item.reader, item.status])).toEqual([['peer', 'unread'], ['self', 'unread']])
    f.detail.items[0] = { user_id: 7, read_status: 'read', read_at: 1700000000999 }
    f.detail.items[1] = { user_id: 9, read_status: 'unread', read_at: 0 }
    f.group.unread_snapshot.read_seq = 9
    const updated = await f.service.interwovenReadReceipts('private', refs)
    expect(updated.items).toEqual([
      { momentId: moments[0]!.momentId, reader: 'peer', status: 'read', readAtMillis: 1700000000999 },
      { momentId: moments[1]!.momentId, reader: 'self', status: 'read' },
    ])
    expect(f.runtime.authenticatedChatPost.mock.calls.every(([path]) => [
      '/api/v1/chats/detail', '/api/v1/chats/read-receipts/detail',
    ].includes(path))).toBe(true)
    expect(f.runtime.authenticatedChatPost.mock.calls.filter(([path, body]) => path.endsWith('/chats/detail') && body.chat_session_uid === 'group')).toHaveLength(2)
  })

  it('resolves legacy rows by exact group, owner, record and sender and reuses the verified sequence', async () => {
    const f = fixture({ legacy: true })
    const { moments } = await f.service.interwovenMoments('private')
    const refs = [moments[0]!.momentRef]
    expect((await f.service.interwovenReadReceipts('private', refs)).items[0]?.status).toBe('unread')
    await f.service.interwovenReadReceipts('private', refs)
    expect(f.runtime.authenticatedChatPost.mock.calls.filter(([path]) => path.endsWith('/timeline/around'))).toHaveLength(1)
    expect(f.runtime.authenticatedChatPost.mock.calls.find(([path]) => path.endsWith('/timeline/around'))?.[1]).toEqual({
      chat_session_uid: 'group', record_uid: 'out', record_owner_user_id: 42, before_limit: 1, after_limit: 1,
    })
  })

  it('maps Chat-to-Subject projection identities to canonical receipts without matching text or dates', async () => {
    const f = fixture({ bridge: true })
    const { moments } = await f.service.interwovenMoments('private')
    const refs = moments.map(item => item.momentRef)
    expect((await f.service.interwovenReadReceipts('private', refs)).items.map(item => item.status)).toEqual(['unread', 'unread'])
    await f.service.interwovenReadReceipts('private', refs)
    expect(f.runtime.authenticatedChatPost.mock.calls.filter(([path]) => path.endsWith('/occurrences/query'))).toHaveLength(1)
    expect(f.runtime.authenticatedChatPost.mock.calls.some(([path]) => path.endsWith('/timeline/around'))).toBe(false)
    expect(f.runtime.authenticatedChatPost.mock.calls.find(([path]) => path.endsWith('/read-receipts/detail'))?.[1]).toEqual({
      chat_session_uid: 'group', record_uid: 'out', seq: 7,
    })
  })

  it.each(['private', 'group', 'owner', 'sender', 'relation', 'ambiguous', 'coverage'])('rejects an unverified bridge %s', async defect => {
    const f = fixture({ bridge: true })
    const item = f.occurrences.items[0]!
    if (defect === 'private') item.private_chat_session_uid = 'other'
    if (defect === 'group') item.source_chat_session_uid = 'other'
    if (defect === 'owner') item.record_owner_user_id = 8
    if (defect === 'sender') item.sender_user_id = 8
    if (defect === 'relation') item.rel_uid = 'other'
    if (defect === 'ambiguous') f.occurrences.items.push({ ...item, record_uid: 'different' })
    if (defect === 'coverage') f.occurrences.scope_complete = false
    const { moments } = await f.service.interwovenMoments('private')
    expect((await f.service.interwovenReadReceipts('private', [moments[0]!.momentRef])).items[0]?.status).toBe('unknown')
    expect(f.runtime.authenticatedChatPost.mock.calls.some(([path]) => path.endsWith('/read-receipts/detail'))).toBe(false)
  })

  it('bounds bridge pagination and does not accept a changed result version', async () => {
    const f = fixture({ bridge: true })
    f.occurrences.items = []
    f.occurrences.has_more = true
    f.occurrences.next_cursor = 'next'
    const { moments } = await f.service.interwovenMoments('private')
    expect((await f.service.interwovenReadReceipts('private', [moments[0]!.momentRef])).items[0]?.status).toBe('unknown')
    const reads = f.runtime.authenticatedChatPost.mock.calls.filter(([path]) => path.endsWith('/occurrences/query'))
    expect(reads).toHaveLength(3)
    expect(reads[1]?.[1]).toMatchObject({ limit: 50, cursor: 'next', expected_version: 'a'.repeat(64) })
    const original = f.runtime.authenticatedChatPost.getMockImplementation()!
    f.runtime.authenticatedChatPost.mockClear()
    f.runtime.authenticatedChatPost.mockImplementation(async (path, body) => {
      if (path.endsWith('/occurrences/query') && body.cursor) return { ...f.occurrences, version: 'b'.repeat(64) }
      return await original(path, body)
    })
    expect((await f.service.interwovenReadReceipts('private', [moments[0]!.momentRef])).items[0]?.status).toBe('unknown')
    expect(f.runtime.authenticatedChatPost.mock.calls.filter(([path]) => path.endsWith('/occurrences/query'))).toHaveLength(2)
  })

  it.each(['group', 'record', 'owner', 'sender', 'deleted', 'ambiguous'])('does not guess a legacy match with wrong %s', async defect => {
    const f = fixture({ legacy: true })
    if (defect === 'group') f.around.chat_session_uid = 'another'
    if (defect === 'record') f.around.items[0]!.relation.record_uid = 'another'
    if (defect === 'owner') f.around.items[0]!.relation.record_owner_user_id = 8
    if (defect === 'sender') f.around.items[0]!.relation.sender_user_id = 8
    if (defect === 'deleted') f.around.items[0]!.record.status = 2
    if (defect === 'ambiguous') f.around.items.push({ ...f.around.items[0]!, relation: { ...f.around.items[0]!.relation, seq: 20 } })
    const { moments } = await f.service.interwovenMoments('private')
    expect((await f.service.interwovenReadReceipts('private', [moments[0]!.momentRef])).items[0]?.status).toBe('unknown')
    expect(f.runtime.authenticatedChatPost.mock.calls.some(([path]) => path.endsWith('/read-receipts/detail'))).toBe(false)
  })

  it.each(['missing-peer', 'wrong-message', 'duplicate-peer', 'malformed-status', 'wrong-cursor', 'no-cursor', 'group-removed'])('fails closed for %s', async defect => {
    const f = fixture()
    if (defect === 'missing-peer') f.detail.items.shift()
    if (defect === 'wrong-message') f.detail.record_uid = 'other'
    if (defect === 'duplicate-peer') f.detail.items.push({ ...f.detail.items[0]! })
    if (defect === 'malformed-status') f.detail.items[0]!.read_status = 'maybe'
    if (defect === 'wrong-cursor') f.group.current_cursor.user_id = 8
    if (defect === 'no-cursor') (f.group as any).current_cursor = undefined
    if (defect === 'group-removed') f.group.session.status = 2
    const { moments } = await f.service.interwovenMoments('private')
    const index = defect.endsWith('cursor') ? 1 : 0
    expect((await f.service.interwovenReadReceipts('private', [moments[index]!.momentRef])).items[0]?.status).toBe('unknown')
  })

  it('rejects forged/cross-conversation/account references and oversized queries', async () => {
    const f = fixture()
    const { moments } = await f.service.interwovenMoments('private')
    const ref = moments[0]!.momentRef
    await expect(f.service.interwovenReadReceipts('private', [])).rejects.toMatchObject({ code: 'interwoven-param-invalid' })
    await expect(f.service.interwovenReadReceipts('private', [ref, ref])).rejects.toMatchObject({ code: 'interwoven-param-invalid' })
    await expect(f.service.interwovenReadReceipts('private', Array.from({ length: 21 }, (_, i) => String(i)))).rejects.toMatchObject({ code: 'interwoven-param-invalid' })
    await expect(f.service.interwovenReadReceipts('private', ['forged'])).rejects.toMatchObject({ code: 'interwoven-ref-invalid' })
    await expect(f.service.interwovenReadReceipts('other', [ref])).rejects.toMatchObject({ code: 'interwoven-ref-invalid' })
    f.setUser(50)
    await expect(f.service.interwovenReadReceipts('private', [ref])).rejects.toMatchObject({ code: 'interwoven-ref-invalid' })
  })

  it('rejects results arriving after account change or disposal', async () => {
    const f = fixture()
    const { moments } = await f.service.interwovenMoments('private')
    const original = f.runtime.authenticatedChatPost.getMockImplementation()!
    f.runtime.authenticatedChatPost.mockImplementation(async (path, body) => {
      const result = await original(path, body)
      if (path.endsWith('/read-receipts/detail')) f.service.dispose()
      return result
    })
    await expect(f.service.interwovenReadReceipts('private', [moments[0]!.momentRef])).rejects.toMatchObject({ code: 'interaction-account-changed' })
  })
})
