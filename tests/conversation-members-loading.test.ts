import { ConversationMembersStore } from '../src/client/conversation-members-store.js'
import { afterEach, expect, it, vi } from 'vitest'
import { ChatService } from '../src/services/chat-service.js'
import { ProfileService } from '../src/services/profile-service.js'
import { SourceService } from '../src/services/source-service.js'
import { ServiceRuntime, type ArkmeServiceConfig } from '../src/services/service.js'

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

it('loads 500 members through the real Host projection and coordinator under slow upstream I/O', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(0)
  const session = { userId: 1, accessToken: 'synthetic', refreshToken: 'synthetic' }
  const members = Array.from({ length: 500 }, (_, index) => ({
    user_id: index + 1, display_name_snapshot: `成员 ${index + 1}`, role: index === 0 ? 1 : 3, status: 1,
  }))
  const calls: { path: string; batchSize: number }[] = []
  const fetchImpl: typeof fetch = async (input, init) => {
    const path = new URL(String(input)).pathname
    const body = JSON.parse(String(init?.body))
    calls.push({ path, batchSize: body.user_ids?.length ?? 0 })
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 2_000)
      init?.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('aborted', 'AbortError')) }, { once: true })
    })
    let data: unknown
    if (path.endsWith('/members/page')) {
      const rows = members.filter(member => member.user_id > body.after_user_id).slice(0, body.limit)
      const last = rows.at(-1)?.user_id ?? 0
      data = { chat_session_uid: 'group', items: rows, self_role: 1, has_more: last > 0 && last < 500, ...(last > 0 && last < 500 ? { next_user_id: last } : {}) }
    } else if (path.endsWith('/members/by-user-ids')) data = { chat_session_uid: 'group', items: members.filter(member => body.user_ids.includes(member.user_id)).map(member => ({ ...member, remark: `备注 ${member.user_id}` })) }
    else if (path.endsWith('/members/list')) data = { items: members }
    else if (path.endsWith('/get-public-users-by-ids')) data = { items: body.user_ids.map((userId: number) => ({ user_id: userId, nick_name: `用户 ${userId}` })) }
    else if (path.endsWith('/chats/list')) data = { items: Array.from({ length: 50 }, () => ({ session: { session_kind: 2 } })), has_more: true, next_page_cursor: { page: (body.page_cursor?.page ?? 0) + 1 } }
    else throw new Error(`Unexpected upstream: ${path}`)
    return new Response(JSON.stringify({ code: 200, data }))
  }
  const runtime = new ServiceRuntime({
    environment: 'test', chatBaseUrl: 'https://chat.test', authBaseUrl: 'https://auth.test', requestTimeoutMs: 30_000,
  } as ArkmeServiceConfig, { read: async () => session, write: async () => {}, delete: async () => {} },
  { uniqueCode: async () => 'synthetic-signing-key' } as never, fetchImpl)
  vi.spyOn(runtime, 'requireSession').mockResolvedValue(session)
  const profile = new ProfileService(runtime)
  const source = new SourceService(runtime, profile, {} as never)
  vi.spyOn(source, 'openSourceRef').mockResolvedValue({ version: 1, userId: 1, kind: 'group_chat', ownerRef: 'group', displayName: '群' })
  vi.spyOn(source, 'sourceItem').mockResolvedValue({ sourceKey: 'group', sourceRef: 'ref', kind: 'group_chat', displayName: '群' })
  const chat = new ChatService(runtime, source, profile, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never)
  try {
    for (const cache of ['cold', 'warm']) {
      calls.length = 0
      const started = Date.now()
      const pending = chat.listSourceMembers('ref')
      await vi.runAllTimersAsync()
      const result = await pending
      expect(result.items).toHaveLength(500)
      expect(calls.every(call => call.batchSize <= 50)).toBe(true)
      console.info('member-loading workload', JSON.stringify({
        cache, members: result.items.length, simulatedUpstreamMillis: 2_000, simulatedElapsedMillis: Date.now() - started,
        memberRequests: calls.filter(call => call.path.endsWith('/members/list')).length,
        profileRequests: calls.filter(call => call.path.endsWith('/get-public-users-by-ids')).length,
        directoryRequests: calls.filter(call => call.path.endsWith('/chats/list')).length,
      }))
    }
    calls.length = 0
    const started = Date.now()
    const group = { sourceKey: 'group', sourceRef: 'ref', kind: 'group_chat' as const, displayName: '群' }
    const store = new ConversationMembersStore({
      page: (ref, cursor, signal) => chat.pageSourceMembers(ref, { ...(cursor === undefined ? {} : { cursor }), limit: 50, signal }),
      presentation: (ref, refs, signal) => chat.sourceMembersPresentation(ref, refs, { signal }),
      cached: async () => null,
    }, Date.now)
    store.activateAccount('test:1')
    store.subscribe('test:1', group, () => {})
    const progressive = store.ensure('test:1', group)
    await vi.advanceTimersByTimeAsync(2000)
    expect(store.get('test:1', group).items).toHaveLength(50)
    expect(store.get('test:1', group).complete).toBe(false)
    const firstPageMillis = Date.now() - started
    await vi.runAllTimersAsync()
    await progressive
    expect(store.get('test:1', group).items).toHaveLength(500)
    expect(store.get('test:1', group).complete).toBe(true)
    expect(calls.some(call => call.path.endsWith('/chats/list') || call.path.endsWith('/contacts/list'))).toBe(false)
    console.info('member-loading progressive', JSON.stringify({ simulatedFirstPageMillis: firstPageMillis,
      simulatedCompleteMillis: Date.now() - started, requests: calls.length,
      pageRequests: calls.filter(call => call.path.endsWith('/members/page')).length,
      presentationRequests: calls.filter(call => call.path.endsWith('/members/by-user-ids')).length,
      profileRequests: calls.filter(call => call.path.endsWith('/get-public-users-by-ids')).length }))
    store.activateAccount(undefined)
  } finally { runtime.dispose(); source.dispose() }
})
