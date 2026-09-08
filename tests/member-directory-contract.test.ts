import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { SessionId } from '@deepseek-ai/dsh-session'
import { CallId } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { expect, it, vi } from 'vitest'
import { ChatService } from '../src/services/chat-service.js'
import { SourceService } from '../src/services/source-service.js'
import { ProfileService } from '../src/services/profile-service.js'
import { ServiceRuntime, type ArkmeServiceConfig } from '../src/services/service.js'
import { ArkmeLocalDatabase } from '../src/local-database.js'
import { ArkmeStateStore } from '../src/state-store.js'
import { createArkmeSdk } from '../src/sdk/index.js'
import { dispatchArkmeHostOperation } from '../src/host-api.js'
import { registerArkmeTools, type ArkmeToolPorts } from '../src/tools/index.js'
import type { ArkmePluginOperation } from '../src/types.js'

it('shares authorized pages, presentation and cache across Host, SDK and official DSH ToolRuntime', async () => {
  const path = await mkdtemp(join(tmpdir(), 'arkme member contract '))
  const db = new ArkmeLocalDatabase(path, new ArkmeStateStore(path))
  const session = { userId: 1, accessToken: 'synthetic', refreshToken: 'synthetic' }
  const calls: string[] = []
  let active = true
  let unsupported = false
  let malformed = false
  let memberFailureCode: number | undefined
  let receiptName: string | undefined
  let pageHasMember = true
  let deferredPage: Promise<void> | undefined
  let unblockPage: (() => void) | undefined
  const fetchImpl: typeof fetch = async (input, init) => {
    const endpoint = new URL(String(input)).pathname
    calls.push(endpoint)
    const body = JSON.parse(String(init?.body))
    if (memberFailureCode !== undefined && endpoint.includes('/members/')) return new Response(JSON.stringify({ code: memberFailureCode, message: 'unreadable' }))
    let data: unknown
    if (endpoint.endsWith('/members/page')) {
      if (unsupported) return new Response('', { status: 404 })
      const after = body.after_user_id ?? 0
      data = { chat_session_uid: body.chat_session_uid, self_role: 1, items: after === 0 && pageHasMember ? [{ user_id: 2, status: 1, role: 3, display_name_snapshot: '群内昵称', join_at: 1 }] : [], has_more: after === 0 && pageHasMember, ...(after === 0 && pageHasMember ? { next_user_id: 2 } : {}) }
      if (deferredPage !== undefined) await deferredPage
    } else if (endpoint.endsWith('/members/by-user-ids')) data = malformed ? { chat_session_uid: body.chat_session_uid } : { chat_session_uid: body.chat_session_uid, items: active ? [{ user_id: 2, status: 1, role: 3, remark: '私人备注', display_name_snapshot: '群内昵称', display_name: '公开昵称', join_at: 1 }] : [] }
    else if (endpoint.endsWith('/get-public-users-by-ids')) data = { items: [{ user_id: 2, nick_name: '公开昵称' }] }
    else if (endpoint.endsWith('/read-receipts/detail')) data = { chat_session_uid: body.chat_session_uid, record_uid: body.record_uid, seq: body.seq,
      items: [{ user_id: 2, read_status: 'unread', read_at: 0, remark: receiptName }] }
    else throw new Error(`Unexpected upstream ${endpoint}`)
    return new Response(JSON.stringify({ code: 200, data }))
  }
  const runtime = new ServiceRuntime({ environment: 'test', chatBaseUrl: 'https://chat.test', authBaseUrl: 'https://auth.test', requestTimeoutMs: 1000 } as ArkmeServiceConfig,
    { read: async () => session, write: async () => {}, delete: async () => {} }, db, fetchImpl)
  vi.spyOn(runtime, 'requireSession').mockResolvedValue(session)
  const profile = new ProfileService(runtime)
  const source = new SourceService(runtime, profile, {} as never)
  const chat = new ChatService(runtime, source, profile, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never)
  const group = await source.sourceItem({ version: 1, userId: 1, kind: 'group_chat', ownerRef: 'group', displayName: '群' })
  const other = await source.sourceItem({ version: 1, userId: 1, kind: 'group_chat', ownerRef: 'other', displayName: '另一个群' })
  const sdk = createArkmeSdk({ fetchImpl: async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as { operation: ArkmePluginOperation; params: Record<string, unknown> }
    const value = await dispatchArkmeHostOperation(chat as never, request.operation, request.params, init?.signal ?? undefined)
    return new Response(JSON.stringify({ ok: true, value }))
  } })
  const ctx = new Context()
  const registrations: Array<{ dispose(): Promise<unknown> }> = []
  try {
    expect(await sdk.cachedSourceMembers(group.sourceRef)).toBeNull()
    const first = await sdk.pageSourceMembers(group.sourceRef, { limit: 50 })
    expect(first.items).toHaveLength(1)
    expect(first.kind).toBe('membership')
    expect(calls).toEqual(['/api/v1/chats/members/page'])
    expect(first.nextCursor).toMatch(/^arkme-member-page-v1\./)
    await expect(chat.pageSourceMembers(other.sourceRef, { cursor: first.nextCursor! })).rejects.toMatchObject({ code: 'member-cursor-invalid' })
    await expect(chat.pageSourceMembers(group.sourceRef, { cursor: first.nextCursor!.replace(/.$/, '!') })).rejects.toMatchObject({ code: 'member-cursor-invalid' })
    const next = await sdk.pageSourceMembers(group.sourceRef, { cursor: first.nextCursor! })
    expect(next.hasMore).toBe(false)
    const hydrated = await sdk.sourceMembersPresentation(group.sourceRef, first.items.map(item => item.memberRef))
    expect(hydrated.items[0]).toMatchObject({ displayName: '私人备注', mentionDisplayName: '群内昵称' })
    expect(calls.some(path => path.endsWith('/chats/list') || path.endsWith('/contacts/list'))).toBe(false)
    expect((await sdk.cachedSourceMembers(group.sourceRef))?.items[0]?.displayName).toBe('私人备注')
    malformed = true
    await expect(chat.sourceMembersPresentation(group.sourceRef, [first.items[0]!.memberRef])).rejects.toMatchObject({ code: 'member-presentation-invalid-response' })
    expect((await sdk.cachedSourceMembers(group.sourceRef))?.items).toHaveLength(1)
    malformed = false
    const existingProfiles = await profile.publicProfileSummariesByUserIds([2], session)
    let finishProfiles!: () => void
    const profileRead = vi.spyOn(profile, 'publicProfileSummariesByUserIds').mockImplementationOnce(async () => {
      await new Promise<void>(resolve => { finishProfiles = resolve })
      return existingProfiles
    })
    const writes = vi.spyOn(db, 'mergeConversationMembers')
    const controller = new AbortController()
    const cancelled = chat.sourceMembersPresentation(group.sourceRef, [first.items[0]!.memberRef], { signal: controller.signal })
    const cancelledResult = cancelled.catch(error => error)
    await vi.waitFor(() => expect(profileRead).toHaveBeenCalled())
    controller.abort()
    finishProfiles()
    expect((await cancelledResult).name).toBe('AbortError')
    expect(writes).not.toHaveBeenCalled()
    writes.mockRestore(); profileRead.mockRestore()

    const before = calls.length
    expect((await sdk.messageReadReceiptDetail(group.sourceRef, 'message', 8, undefined, { basicOnly: true })).items[0]?.displayName).toBe('私人备注')
    expect(calls.slice(before)).toEqual(['/api/v1/chats/read-receipts/detail'])
    receiptName = '当前服务端备注'
    runtime.invalidateScope(runtime.requestScope(1))
    expect((await sdk.messageReadReceiptDetail(group.sourceRef, 'message', 8, undefined, { basicOnly: true })).items[0]).toMatchObject({ displayName: receiptName, displayNameIsCurrent: true })

    for (const operation of ['page', 'presentation']) for (const code of [2001, 2002]) {
      runtime.invalidateScope(runtime.requestScope(1))
      await chat.pageSourceMembers(group.sourceRef)
      expect(await db.cachedConversationMembers(1, 'group')).toBeDefined()
      memberFailureCode = code
      runtime.invalidateScope(runtime.requestScope(1))
      const failed = operation === 'page' ? chat.pageSourceMembers(group.sourceRef)
        : chat.sourceMembersPresentation(group.sourceRef, [first.items[0]!.memberRef])
      await expect(failed).rejects.toMatchObject({ code: `arkme-code-${code}` })
      expect(await db.cachedConversationMembers(1, 'group')).toBeUndefined()
      memberFailureCode = undefined
    }
    runtime.invalidateScope(runtime.requestScope(1))
    await chat.pageSourceMembers(group.sourceRef)

    registrations.push(await ctx.plugin(SystemPrompt))
    registrations.push(await ctx.plugin(ToolRuntime))
    const ports = { pageSourceMembers: chat.pageSourceMembers.bind(chat), cachedSourceMembers: chat.cachedSourceMembers.bind(chat),
      sourceMembersPresentation: chat.sourceMembersPresentation.bind(chat) } as unknown as ArkmeToolPorts
    const registration = await ctx.plugin(Object.assign((plugin: Context) => { registerArkmeTools(plugin, ports, 'business') }, { inject: ['tools', 'systemPrompt'] }))
    const agent = { id: SessionId('member-directory-session'), session: { events: [{ seq: 1, type: 'user/message', data: { content: [{ type: 'text', text: '读取群成员' }], source: { kind: 'user' } } }] } } as unknown as Agent
    const names = ['arkme_source_members_page', 'arkme_source_members_presentation', 'arkme_source_members_cached']
    expect(ctx.tools.schemas().filter(tool => names.includes(tool.name)).map(tool => tool.name)).toEqual(names)
    for (const name of names) {
      const result = await ctx.tools.execute({ callId: CallId(name), name, agent, signal: new AbortController().signal,
        arguments: { source_ref: group.sourceRef, ...(name.endsWith('presentation') ? { member_refs: [first.items[0]!.memberRef] } : {}) } })
      expect(result.isError).toBe(false)
      expect(result.isError ? '' : result.value).toContain('member')
    }
    await registration.dispose()
    expect(ctx.tools.schemas().some(tool => names.includes(tool.name))).toBe(false)
    active = false
    runtime.invalidateScope(runtime.requestScope(1))
    const removed = await sdk.sourceMembersPresentation(group.sourceRef, [first.items[0]!.memberRef])
    expect(removed.removedMemberRefs).toEqual([first.items[0]!.memberRef])
    expect((await sdk.cachedSourceMembers(group.sourceRef))?.items).toEqual([])
    unsupported = true
    runtime.invalidateScope(runtime.requestScope(1))
    await expect(chat.pageSourceMembers(group.sourceRef)).rejects.toMatchObject({ upstreamStatus: 404 })
    unsupported = false
    runtime.invalidateScope(runtime.requestScope(1))
    deferredPage = new Promise(resolve => { unblockPage = resolve })
    const starts = calls.filter(path => path.endsWith('/members/page')).length
    const oldRead = chat.pageSourceMembers(group.sourceRef)
    await new Promise(resolve => setTimeout(resolve, 0))
    runtime.invalidateMemberCache()
    await db.clearConversationMembers(1, 'group')
    pageHasMember = false
    const newRead = chat.pageSourceMembers(group.sourceRef)
    const startedFresh = vi.waitFor(() => expect(calls.filter(path => path.endsWith('/members/page'))).toHaveLength(starts + 2))
    try { await startedFresh } finally { unblockPage!() }
    expect((await newRead).items).toEqual([])
    await oldRead
    expect((await db.cachedConversationMembers(1, 'group'))?.items).toEqual([])
    await db.mergeConversationMembers(1, 'group', { ...first, items: [{ ...first.items[0]!, memberRef: 'invalid-old-runtime-ref' }] })
    expect(await chat.cachedSourceMembers(group.sourceRef)).toBeUndefined()
    expect((await db.cachedConversationMembers(1, 'group'))?.items ?? []).toEqual([])


  } finally { for (const handle of registrations.reverse()) await handle.dispose(); runtime.dispose(); source.dispose(); db.close(); await rm(path, { recursive: true }); vi.restoreAllMocks() }
})
