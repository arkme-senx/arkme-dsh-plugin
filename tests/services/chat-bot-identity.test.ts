import { qualifiedSocialAccountFixture } from '../helpers/qualified-social-access.js'
qualifiedSocialAccountFixture()
import type { BotDisplayProfilesReader } from '../../src/chat-sender-display.js'
import { describe, expect, it, vi } from 'vitest'
import { ArkmeStaleRequestError } from '../../src/request-coordinator.js'
import { BotService } from '../../src/services/bot-service.js'
import { ChatService } from '../../src/services/chat-service.js'
import { MediaService } from '../../src/services/media-service.js'
import { ProfileService } from '../../src/services/profile-service.js'
import { ServiceRuntime, type ArkmeServiceConfig, type StateStore } from '../../src/services/service.js'

function fixture() {
  const session = { userId: 42, accessToken: 'access', refreshToken: 'refresh' }
  let started!: () => void
  const snapshotStarted = new Promise<void>(resolve => { started = resolve })
  let snapshotSignal: AbortSignal | undefined
  let finish!: (response: Response) => void
  const fetchImpl = vi.fn<typeof fetch>(async (url, init) => {
    if (String(url).endsWith('/api/v1/chat/timeline/page')) return new Response(JSON.stringify({ code: 200, data: {
      items: [{ relation: { record_uid: 'record', sender_actor_kind: 2, sender_bot_uid: 'bot', sender_user_id: 9001 },
        record: { status: 1, payload: { text_content: 'visible reply' } } }],
    } }))
    if (String(url).endsWith('/api/v1/chats/detail')) return new Response('{}', { status: 401 })
    if (!String(url).endsWith('/api/v1/chats/display-snapshots')) throw new Error(`unexpected request: ${String(url)}`)
    snapshotSignal = init?.signal ?? undefined
    return await new Promise<Response>((resolve, reject) => {
      finish = resolve
      snapshotSignal?.addEventListener('abort', () => reject(snapshotSignal?.reason), { once: true })
      started()
    })
  })
  const runtime = new ServiceRuntime({
    environment: 'test', chatBaseUrl: 'https://chat.test', authBaseUrl: 'https://auth.test', requestTimeoutMs: 30_000,
  } as ArkmeServiceConfig, {
    read: async () => session, write: async () => {}, delete: async () => {},
  }, { uniqueCode: async () => 'signing-key' } as StateStore, fetchImpl)
  const profile = new ProfileService(runtime)
  const chat = new ChatService(runtime,
    { openAccessibleSourceRef: async () => ({ kind: 'group_chat', ownerRef: 'chat' }), sourceItem: async () => ({ kind: 'group_chat' }) } as never,
    profile, new MediaService(runtime, profile, {} as never, { recordUid: () => 'record' }),
    {} as never, { senderDisplayProfiles: async () => new Map() } as never, {} as never, { timelineAiPolish: () => undefined } as never, {} as never)
  return { runtime, chat, fetchImpl, snapshotStarted, snapshotSignal: () => snapshotSignal,
    finish: (response: Response) => finish(response),
    read: (signal?: AbortSignal) => chat.readSource('source', { cursor: { beforeSequence: 1 }, ...(signal ? { signal } : {}) }),
  }
}

describe('Bot identity through ServiceRuntime', () => {
  it('bounds optional hydration, cancels the HTTP request and still returns message content', async () => {
    const timeout = new AbortController()
    const caller = new AbortController()
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal)
    const f = fixture()
    const pending = f.read(caller.signal)
    try {
      await f.snapshotStarted
      expect(timeoutSpy).toHaveBeenCalledWith(1_500)
      timeout.abort(new DOMException('decoration timeout', 'TimeoutError'))
      expect((await pending).items[0]).toMatchObject({ senderName: 'Bot', textContent: 'visible reply' })
      expect(f.snapshotSignal()?.aborted).toBe(true)
      expect(f.fetchImpl).toHaveBeenCalledTimes(2)
    } finally {
      caller.abort()
      await pending.catch(() => {})
      timeoutSpy.mockRestore()
    }
  })

  it('propagates account invalidation instead of returning stale message projections', async () => {
    const f = fixture()
    const pending = f.read()
    const rejected = expect(pending).rejects.toBeInstanceOf(ArkmeStaleRequestError)
    await f.snapshotStarted
    f.runtime.requestCoordinator.invalidateScope('user:42')
    await rejected
    expect(f.snapshotSignal()?.aborted).toBe(true)
  })

  it('does not refresh login credentials for optional Bot decoration', async () => {
    const f = fixture()
    const refresh = vi.spyOn(f.runtime, 'refreshAccessToken')
    const pending = f.read()
    await f.snapshotStarted
    f.finish(new Response('{}', { status: 401 }))
    expect((await pending).items[0]).toMatchObject({ senderName: 'Bot', textContent: 'visible reply' })
    expect(refresh).not.toHaveBeenCalled()
    expect(f.fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('keeps a shared participant request alive when only one timeline reader cancels', async () => {
    const f = fixture()
    const request = vi.spyOn(f.runtime, 'authenticatedChatPost')
    const firstCaller = new AbortController()
    const first = f.read(firstCaller.signal)
    const reason = new Error('first reader closed')
    const firstRejected = expect(first).rejects.toBe(reason)
    const second = f.read()
    await f.snapshotStarted
    await vi.waitFor(() => expect(request.mock.calls.filter(([path]) => path === '/api/v1/chats/display-snapshots')).toHaveLength(2))
    firstCaller.abort(reason)
    await firstRejected
    expect(f.snapshotSignal()?.aborted).toBe(false)
    f.finish(new Response(JSON.stringify({ code: 200, data: { items: [{
      session: { chat_session_uid: 'chat' },
      bot_participants: [{ chat_session_uid: 'chat', bot_uid: 'bot', display_name_snapshot: 'Group Bot' }],
    }] } })))
    expect((await second).items[0]?.senderName).toBe('Group Bot')
    expect(f.fetchImpl.mock.calls.filter(([url]) => String(url).endsWith('/api/v1/chats/display-snapshots'))).toHaveLength(1)
  })
})

function displayFixture(options: {
  reader?: BotDisplayProfilesReader
  kind?: 'group_chat' | 'private_chat'
  uid?: string
  typed?: boolean
  payloadUid?: boolean
  parent?: boolean
  participant?: Record<string, unknown>
  botRead?: (path: string, signal: AbortSignal) => Promise<Response>
} = {}) {
  const session = { userId: 42, accessToken: 'access', refreshToken: 'refresh' }
  const uid = options.uid ?? 'bot_reply_253_bot_source'
  const botItem = {
    relation: { ...(options.payloadUid ? {} : { record_uid: uid }), sender_user_id: 42,
      ...(options.typed ? { sender_actor_kind: 2, sender_bot_uid: 'bot' } : { sender_actor_kind: 1 }) },
    record: { status: 1, payload: { record_uid: uid, text_content: 'visible reply' } },
  }
  const raw = options.parent ? {
    relation: { record_uid: 'child', sender_user_id: 7 }, record: { status: 1, payload: {} }, extension_parent_preview: botItem,
  } : botItem
  const json = (data: unknown) => new Response(JSON.stringify({ code: 200, data }))
  const fetchImpl = vi.fn<typeof fetch>(async (url, init) => {
    const path = new URL(String(url)).pathname
    if (path === '/api/v1/chat/timeline/page') return json({ items: [raw] })
    if (path === '/api/v1/chats/display-snapshots') return json({ items: [{
      session: { chat_session_uid: 'chat', rm_subject_id: 253 },
      bot_participants: options.participant ? [{ chat_session_uid: 'chat', bot_uid: 'bot', ...options.participant }] : [],
    }] })
    if (path.startsWith('/api/v1/bot/')) return options.botRead
      ? await options.botRead(path, init!.signal!) : json({ bots: [{ bot_id: 'bot', name: '目录助手', avatar_url: 'https://images.test/directory.png', installed: true }] })
    throw new Error(`unexpected request: ${path}`)
  })
  const runtime = new ServiceRuntime({ environment: 'test', chatBaseUrl: 'https://chat.test', botBaseUrl: 'https://bot.test',
    authBaseUrl: 'https://auth.test', requestTimeoutMs: 30_000 } as ArkmeServiceConfig,
    { read: async () => session, write: async () => {}, delete: async () => {} },
    { uniqueCode: async () => 'signing-key' } as StateStore, fetchImpl)
  const profile = { publicProfilesByUserIds: vi.fn(async () => new Map()), sealProfileImageRef: vi.fn() }
  const bot = new BotService(runtime, {} as never)
  const chat = new ChatService(runtime,
    { openAccessibleSourceRef: async () => ({ kind: options.kind ?? 'group_chat', ownerRef: 'chat' }), sourceItem: async () => ({ kind: options.kind ?? 'group_chat' }) } as never,
    profile as never, new MediaService(runtime, {} as never, {} as never, { recordUid: () => uid }), {} as never, bot,
    { currentUserAgentSourceFallback: () => undefined } as never, { timelineAiPolish: () => undefined } as never, {} as never,
    undefined, undefined, undefined, options.reader)
  return { runtime, fetchImpl, profile, read: (signal?: AbortSignal) => chat.readSource('source', { cursor: { beforeSequence: 1 }, signal }) }
}

describe('Bot display boundary regressions', () => {
  it('projects display data through an injected reader without issuing decoration HTTP calls', async () => {
    const read = vi.fn<BotDisplayProfilesReader['read']>(async () => new Map([['bot', { displayName: 'Interface name' }]]))
    const f = displayFixture({ reader: { read } })
    const item = (await f.read()).items[0]!
    expect(item).toMatchObject({ senderName: 'Interface name', isMe: false })
    expect(item.memberRef).toBeUndefined()
    expect(read).toHaveBeenCalledExactlyOnceWith({ botUids: new Set(['bot']), chatSessionUid: 'chat', isGroup: true },
      expect.objectContaining({ userId: 42 }), undefined)
    expect(f.fetchImpl).toHaveBeenCalledTimes(1)
  })

  it.each([false, true])('uses display-only directory for typed=%s without requiring provider or conversation target', async typed => {
    const f = displayFixture({ typed })
    expect((await f.read()).items[0]).toMatchObject({ senderName: '目录助手', isMe: false })
    expect(f.fetchImpl).toHaveBeenCalledTimes(3)
    expect(f.profile.publicProfilesByUserIds).toHaveBeenCalledWith([], expect.anything(), undefined)
  })

  it.each([false, true])('recognizes payload-only legacy UID, parent=%s', async parent => {
    const f = displayFixture({ payloadUid: true, parent })
    const item = (await f.read()).items[0]!
    expect(parent ? item.extensionParent?.senderName : item.senderName).toBe('目录助手')
    if (!parent) { expect(item.memberRef).toBeUndefined(); expect(item.isMe).toBe(false) }
  })

  it.each(['bot_reply_', 'bot_outbound_'])('keeps malformed but reserved prefix %s visibly Bot without directory reads', async uid => {
    const f = displayFixture({ uid })
    expect((await f.read()).items[0]).toMatchObject({ senderName: 'Bot', isMe: false })
    expect(f.fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('does not classify a human with a partial legacy-looking UID as Bot', async () => {
    const f = displayFixture({ uid: '253_botabc~not-a-complete-legacy-id' })
    expect((await f.read()).items[0]).toMatchObject({ senderName: 'Arkme用户', isMe: true, memberRef: expect.any(String) })
    expect(f.fetchImpl).toHaveBeenCalledTimes(1)
  })

  it.each([{ display_name_snapshot: '参与者名', extra: { avatar_url: 'https://images.test/current.png' } }, { extra: { bot_name: '参与者名', avatar_url: 'https://images.test/current.png' } }])('uses participant name without directory requests: %j', async participant => {
    const f = displayFixture({ participant })
    expect((await f.read()).items[0]?.senderName).toBe('参与者名')
    expect(f.fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('supplements an empty participant name without discarding its avatar', async () => {
    const f = displayFixture({ participant: { display_name_snapshot: '', extra: { avatar_url: 'https://images.test/bot.png' } } })
    expect((await f.read()).items[0]).toMatchObject({ senderName: '目录助手', avatarRef: expect.stringMatching(/^arkme-bot-image-v1\./) })
  })

  it.each(['private_chat', 'group_chat'] as const)('only reads installed group names in group scope: %s', async kind => {
    const f = displayFixture({ kind, botRead: async path => new Response(JSON.stringify({ code: 200, data: {
      bots: path.endsWith('/group/list') ? [{ bot_id: 'bot', name: '群助手', installed: true }] : [],
    } })) })
    expect((await f.read()).items[0]?.senderName).toBe(kind === 'group_chat' ? '群助手' : 'Bot')
    expect(f.fetchImpl).toHaveBeenCalledTimes(kind === 'group_chat' ? 4 : 3)
  })

  it('does not restore a removed group Bot through display lookup', async () => {
    const f = displayFixture({ botRead: async () => new Response(JSON.stringify({ code: 200, data: { bots: [] } })) })
    expect((await f.read()).items[0]).toMatchObject({ senderName: 'Bot', isMe: false })
    expect(f.fetchImpl.mock.calls.every(([url]) => String(url).endsWith('/list') || String(url).endsWith('/page') || String(url).endsWith('/display-snapshots'))).toBe(true)
  })

  it('does not refresh credentials on optional directory 401', async () => {
    const f = displayFixture({ botRead: async () => new Response('{}', { status: 401 }) })
    const refresh = vi.spyOn(f.runtime, 'refreshAccessToken')
    expect((await f.read()).items[0]?.senderName).toBe('Bot')
    expect(refresh).not.toHaveBeenCalled()
  })

  it('keeps a shared group directory request alive until its last reader leaves', async () => {
    let started!: () => void
    const ready = new Promise<void>(resolve => { started = resolve })
    let finish!: (value: Response) => void
    let transport: AbortSignal | undefined
    const f = displayFixture({ botRead: async (path, signal) => {
      if (!path.endsWith('/group/list')) return new Response(JSON.stringify({ code: 200, data: { bots: [] } }))
      transport = signal
      return await new Promise<Response>((resolve, reject) => {
        finish = resolve
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        started()
      })
    } })
    const requests = vi.spyOn(f.runtime, 'authenticatedBotPost')
    const caller = new AbortController()
    const first = f.read(caller.signal)
    const rejected = expect(first).rejects.toThrow('reader closed')
    const second = f.read()
    await ready
    await vi.waitFor(() => expect(requests.mock.calls.filter(([path]) => path.endsWith('/group/list'))).toHaveLength(2))
    caller.abort(new Error('reader closed'))
    await rejected
    expect(transport?.aborted).toBe(false)
    finish(new Response(JSON.stringify({ code: 200, data: { bots: [{ bot_id: 'bot', name: '群助手', installed: true }] } })))
    expect((await second).items[0]?.senderName).toBe('群助手')
    expect(f.fetchImpl.mock.calls.filter(([url]) => String(url).endsWith('/group/list'))).toHaveLength(1)
  })

  it.each((['personal', 'group'] as const).flatMap(stage => (['budget', 'caller', 'account'] as const).map(reason => ({ stage, reason }))))('honors $reason during the $stage directory HTTP call', async ({ stage, reason }) => {
    const caller = new AbortController()
    const budget = new AbortController()
    const spy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(budget.signal)
    let started!: () => void
    const ready = new Promise<void>(resolve => { started = resolve })
    let requestSignal: AbortSignal | undefined
    const f = displayFixture({ botRead: async (path, signal) => {
      if (stage === 'group' && !path.endsWith('/group/list')) return new Response(JSON.stringify({ code: 200, data: { bots: [] } }))
      requestSignal = signal
      return await new Promise<Response>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true }); started()
      })
    } })
    const pending = f.read(caller.signal)
    const result = pending.then(value => ({ value }), error => ({ error }))
    try {
      await ready
      if (reason === 'budget') budget.abort(new DOMException('display budget', 'TimeoutError'))
      else if (reason === 'caller') caller.abort(new Error('reader closed'))
      else f.runtime.requestCoordinator.invalidateScope('user:42')
      const settled = await result
      if (reason === 'budget') expect('value' in settled && settled.value.items[0]?.senderName).toBe('Bot')
      else if (reason === 'account') expect('error' in settled && settled.error).toBeInstanceOf(ArkmeStaleRequestError)
      else expect('error' in settled && settled.error).toBe(caller.signal.reason)
      expect(requestSignal?.aborted).toBe(true)
      expect(spy).toHaveBeenCalledTimes(1)
      expect(f.fetchImpl).toHaveBeenCalledTimes(stage === 'group' ? 4 : 3)
    } finally { caller.abort(); await pending.catch(() => {}); spy.mockRestore() }
  })
})
