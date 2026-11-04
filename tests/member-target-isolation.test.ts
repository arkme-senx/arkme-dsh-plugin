import { createHmac } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { ArkmeLocalDatabase } from '../src/local-database.js'
import { ArkmeStateStore } from '../src/state-store.js'
import { ServiceRuntime } from '../src/services/service.js'
import { SourceService } from '../src/services/source-service.js'
import { ProfileService } from '../src/services/profile-service.js'
import { ChatService } from '../src/services/chat-service.js'
import type { ArkmeServiceConfig } from '../src/services/service.js'

it('uses bounded fresh membership reads with a real isolated SQLite store and rejects adversarial targets', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'arkme-member-target-'))
  const db = new ArkmeLocalDatabase(directory, new ArkmeStateStore(directory))
  let session = { userId: 42, accessToken: 'isolated', refreshToken: 'isolated' }
  let data: Record<string, unknown> = { chat_session_uid: 'chat', items: [{ user_id: 7, status: 1 }] }
  let pause: Promise<void> | undefined, release: (() => void) | undefined, rejected = false
  const requests: { path: string; body: Record<string, unknown>; bytes: number }[] = []
  const fetchImpl: typeof fetch = async (input, init) => {
    const path = new URL(String(input)).pathname, body = JSON.parse(String(init?.body))
    const response = path.endsWith('/members/list') ? { chat_session_uid: 'chat', items: Array.from({ length: 1000 }, (_, index) => ({ user_id: index + 1, status: 1, role: 3, display_name_snapshot: `成员${index + 1}` })) } : data
    requests.push({ path, body, bytes: Buffer.byteLength(JSON.stringify(response)) })
    if (pause) await pause
    return new Response(JSON.stringify(rejected ? { code: 403, message: 'membership denied' } : { code: 200, data: response }))
  }
  const runtime = new ServiceRuntime({ environment: 'test', chatBaseUrl: 'https://chat.test', requestTimeoutMs: 1000 } as ArkmeServiceConfig,
    { read: async () => session, write: async () => {}, delete: async () => {} }, db, fetchImpl)
  vi.spyOn(runtime, 'requireSession').mockImplementation(async () => session)
  const profiles = new ProfileService(runtime), source = new SourceService(runtime, profiles, {} as never)
  const chat = new ChatService(runtime, source, profiles, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never)
  const group = await source.sourceItem({ version: 1, userId: 42, kind: 'group_chat', ownerRef: 'chat', displayName: '隔离测试群' })
  const secret = await db.uniqueCode()
  const ref = (viewer = 42, uid = 'chat', target: number | string = 7) => {
    const payload = Buffer.from(JSON.stringify({ version: 1, viewerUserId: viewer, chatSessionUid: uid, targetUserId: target })).toString('base64url')
    return `arkme-chat-member-v1.${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`
  }
  const good = ref()
  try {
    expect(await chat.memberWorldTarget(group.sourceRef, good)).toEqual({ userId: 7 })
    expect(await chat.memberWorldTarget(group.sourceRef, good)).toEqual({ userId: 7 })
    expect(requests).toHaveLength(2) // Fresh authorization is not replaced by a profile/roster cache.
    expect(requests.every(r => r.path === '/api/v1/chats/members/by-user-ids')).toBe(true)
    expect(requests[0]!.body).toEqual({ chat_session_uid: 'chat', user_ids: [7], active_only: true, include_stats: false })
    await runtime.authenticatedChatPost('/api/v1/chats/members/list', { chat_session_uid: 'chat', active_only: true }, session)
    const singleBytes = requests[0]!.bytes, rosterBytes = requests.at(-1)!.bytes
    expect(rosterBytes).toBeGreaterThan(singleBytes * 100)
    console.log('MEMBER_TARGET_RESPONSE_BYTES', JSON.stringify({ rosterMembers: 1000, rosterBytes, singleTargetBytes: singleBytes }))
    const open = vi.spyOn(chat, 'openPrivateChatFromUser').mockResolvedValue({ source: { sourceRef: 'private', kind: 'private_chat', displayName: '目标' } } as never)
    await chat.openPrivateChatFromMember(group.sourceRef, good)
    expect(open).toHaveBeenCalledWith(7, { expectedViewerUserId: 42 })
    open.mockClear()
    const count = requests.length
    for (const invalid of [ref(43), ref(42, 'different-chat'), good + 'tampered']) {
      await expect(chat.memberWorldTarget(group.sourceRef, invalid)).rejects.toMatchObject({ code: 'chat-member-ref-invalid' })
      await expect(chat.openPrivateChatFromMember(group.sourceRef, invalid)).rejects.toMatchObject({ code: 'chat-member-ref-invalid' })
    }
    expect(requests).toHaveLength(count); expect(open).not.toHaveBeenCalled()
    for (const malformed of [
      { chat_session_uid: 'different-chat', items: [{ user_id: 7, status: 1 }] },
      { chat_session_uid: 'chat', items: [{ user_id: 8, status: 1 }] },
      { chat_session_uid: 'chat', items: [{ user_id: 7, status: 2 }] },
      { chat_session_uid: 'chat', items: [{ user_id: 7, status: 1 }, { user_id: 7, status: 1 }] },
      { chat_session_uid: 'chat' },
    ]) {
      data = malformed
      await expect(chat.memberWorldTarget(group.sourceRef, good)).rejects.toMatchObject({ code: 'member-target-invalid-response' })
      await expect(chat.openPrivateChatFromMember(group.sourceRef, good)).rejects.toMatchObject({ code: 'member-target-invalid-response' })
    }
    data = { chat_session_uid: 'chat', items: [] }
    await expect(chat.memberWorldTarget(group.sourceRef, good)).rejects.toMatchObject({ code: 'chat-member-ref-stale' })
    await expect(chat.openPrivateChatFromMember(group.sourceRef, good)).rejects.toMatchObject({ code: 'chat-member-ref-stale' })
    expect(open).not.toHaveBeenCalled()
    data = { chat_session_uid: 'chat', items: [{ user_id: 7, status: 1 }] }; rejected = true
    await expect(chat.memberWorldTarget(group.sourceRef, good)).rejects.toThrow('membership denied'); rejected = false
    const beforeAbort = requests.length
    await expect(chat.memberWorldTarget(group.sourceRef, good, AbortSignal.abort())).rejects.toThrow()
    expect(requests).toHaveLength(beforeAbort)
    pause = new Promise(done => { release = done })
    const controller = new AbortController(), pending = chat.memberWorldTarget(group.sourceRef, good, controller.signal)
    const cancelled = expect(pending).rejects.toThrow()
    await vi.waitFor(() => expect(requests.length).toBeGreaterThan(beforeAbort))
    controller.abort(); release!(); await cancelled; pause = undefined
    pause = new Promise(done => { release = done })
    const previous = requests.length, changing = chat.memberWorldTarget(group.sourceRef, good)
    const changed = expect(changing).rejects.toMatchObject({ code: 'chat-member-account-changed' })
    await vi.waitFor(() => expect(requests.length).toBeGreaterThan(previous))
    session = { ...session, userId: 43 }; release!(); await changed; pause = undefined
    expect(open).not.toHaveBeenCalled()
  } finally {
    release?.(); vi.restoreAllMocks(); db.close(); await rm(directory, { recursive: true, force: true })
  }
})
