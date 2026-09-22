import { qualifiedSocialAccountFixture } from './helpers/qualified-social-access.js'
qualifiedSocialAccountFixture()
import { recordToolResults, sessionEvents } from './helpers/tool-session.js'
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
import { ARKME_PROVIDER_CONTRACT_VERSION, type ArkmePluginOperation } from '../src/types.js'

it('shares self-only nickname writes, cache and validation through Host, SDK and official DSH tools', async () => {
  const path = await mkdtemp(join(tmpdir(), 'arkme nickname contract '))
  const db = new ArkmeLocalDatabase(path, new ArkmeStateStore(path))
  const session = { userId: 1, accessToken: 'synthetic', refreshToken: 'synthetic' }
  let nickname = '原昵称'
  let malformed = false
  let fail = false
  const writes: Record<string, unknown>[] = []
  const fetchImpl: typeof fetch = async (input, init) => {
    const endpoint = String(input)
    const body = JSON.parse(String(init?.body))
    let data: unknown
    const member = () => ({ user_id: 1, status: 1, role: 3, display_name_snapshot: nickname, join_at: 1 })
    if (endpoint.endsWith('/members/update')) {
      writes.push(body)
      if (fail) return new Response(JSON.stringify({ code: 403, message: 'forbidden' }))
      nickname = body.display_name_snapshot
      data = { chat_session_uid: 'group', item: { ...member(), user_id: malformed ? 2 : 1 } }
    } else if (endpoint.endsWith('/members/by-user-ids')) {
      expect(body.user_ids).toEqual([1])
      data = { chat_session_uid: 'group', items: [member()] }
    } else if (endpoint.endsWith('/members/page')) data = { chat_session_uid: 'group', self_role: 3, has_more: false, items: [member()] }
    else throw new Error('unexpected ' + endpoint)
    return new Response(JSON.stringify({ code: 200, data }))
  }
  const runtime = new ServiceRuntime({ environment: 'test', chatBaseUrl: 'https://chat.test', authBaseUrl: 'https://auth.test', requestTimeoutMs: 1000 } as ArkmeServiceConfig,
    { read: async () => session, write: async () => {}, delete: async () => {} }, db, fetchImpl)
  vi.spyOn(runtime, 'requireSession').mockResolvedValue(session)
  const profile = new ProfileService(runtime)
  const source = new SourceService(runtime, profile, {} as never)
  const chat = new ChatService(runtime, source, profile, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never)
  const group = await source.sourceItem({ version: 1, userId: 1, kind: 'group_chat', ownerRef: 'group', displayName: '群' })
  const privateChat = await source.sourceItem({ version: 1, userId: 1, kind: 'private_chat', ownerRef: 'private', displayName: '私聊' })
  const foreign = await source.sourceItem({ version: 1, userId: 2, kind: 'group_chat', ownerRef: 'group', displayName: '他人' })
  const service = { groupSelfNickname: chat.groupSelfNickname.bind(chat), setGroupSelfNickname: chat.setGroupSelfNickname.bind(chat),
    providerCapabilities: () => ({ contractVersion: ARKME_PROVIDER_CONTRACT_VERSION, features: { groupSelfNickname: true } }) }
  const sdk = createArkmeSdk({ fetchImpl: async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as { operation: ArkmePluginOperation; params: Record<string, unknown> }
    const value = await dispatchArkmeHostOperation(service as never, request.operation, request.params, init?.signal ?? undefined)
    return new Response(JSON.stringify({ ok: true, value }))
  } })
  const ctx = new Context()
  const handles: Array<{ dispose(): Promise<unknown> }> = []
  try {
    await chat.pageSourceMembers(group.sourceRef)
    expect((await sdk.groupSelfNickname(group.sourceRef)).nickname).toBe('原昵称')
    const accepted = await sdk.setGroupSelfNickname(group.sourceRef, '  新昵称😀  ')
    expect(accepted.nickname).toBe('新昵称😀')
    expect(writes[0]).toEqual({ chat_session_uid: 'group', target_user_id: 1, action: 4, display_name_snapshot: '新昵称😀' })
    expect((await db.cachedConversationMembers(1, 'group'))?.items[0]).toMatchObject({ memberName: '新昵称😀', displayName: '新昵称😀' })
    for (const value of ['', '   ', '😀'.repeat(11)]) await expect(chat.setGroupSelfNickname(group.sourceRef, value)).rejects.toMatchObject({ code: 'group-self-nickname-invalid' })
    await expect(chat.setGroupSelfNickname(privateChat.sourceRef, '昵称')).rejects.toMatchObject({ code: 'group-source-invalid' })
    await expect(chat.setGroupSelfNickname(foreign.sourceRef, '昵称')).rejects.toThrow()
    expect(writes).toHaveLength(1)
    await sdk.setGroupSelfNickname(group.sourceRef, '😀'.repeat(10))
    fail = true
    await expect(sdk.setGroupSelfNickname(group.sourceRef, '失败')).rejects.toThrow()
    expect((await db.cachedConversationMembers(1, 'group'))?.items[0]?.memberName).toBe('😀'.repeat(10))
    fail = false; malformed = true
    await expect(chat.setGroupSelfNickname(group.sourceRef, '错误响应')).rejects.toMatchObject({ code: 'group-self-nickname-invalid-response' })
    malformed = false
    handles.push(await ctx.plugin(SystemPrompt))
    handles.push(await ctx.plugin(ToolRuntime))
    recordToolResults(ctx)
    const registration = await ctx.plugin(Object.assign((plugin: Context) => { registerArkmeTools(plugin, service as unknown as ArkmeToolPorts, 'business') }, { inject: ['tools', 'systemPrompt'] }))
    handles.push(registration)
    const events = sessionEvents([{ seq: 1, type: 'user/message', data: { content: [{ type: 'text', text: '修改我的群昵称为工具昵称' }], source: { kind: 'user' } } }])
    const agent = { id: SessionId('nickname-session'), session: { events } } as unknown as Agent
    expect(ctx.tools.schemas().filter(tool => tool.name.startsWith('arkme_group_self_nickname'))).toHaveLength(2)
    const signal = new AbortController().signal
    const args = { group_source_ref: group.sourceRef, nickname: '工具昵称' }
    const before = writes.length
    const pending = await ctx.tools.execute({ callId: CallId('ask'), name: 'arkme_group_self_nickname_set', agent, signal, arguments: args })
    expect(pending.isError).toBe(false)
    expect(writes).toHaveLength(before)
    events.push({ seq: 2, type: 'user/message', data: { content: [{ type: 'text', text: '确认修改' }], source: { kind: 'user' } } })
    const result = await ctx.tools.execute({ callId: CallId('save'), name: 'arkme_group_self_nickname_set', agent, signal, arguments: args })
    expect(result.isError).toBe(false)
    expect(writes).toHaveLength(before + 1)
    const read = await ctx.tools.execute({ callId: CallId('read'), name: 'arkme_group_self_nickname', agent, signal, arguments: { group_source_ref: group.sourceRef } })
    expect(read.isError).toBe(false)
    expect(read.isError ? '' : read.value).toContain('工具昵称')
    await registration.dispose()
    expect(ctx.tools.schemas().some(tool => tool.name.startsWith('arkme_group_self_nickname'))).toBe(false)
  } finally {
    for (const handle of handles.reverse()) await handle.dispose()
    runtime.dispose(); source.dispose()
    await db.close()
    await rm(path, { recursive: true, force: true })
  }
})
