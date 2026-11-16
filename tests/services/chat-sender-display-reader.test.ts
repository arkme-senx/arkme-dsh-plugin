import { describe, expect, it, vi } from 'vitest'
import { RuntimeBotDisplayProfilesReader, botDisplaySnapshot } from '../../src/services/chat-sender-display-reader.js'
import { ArkmeStaleRequestError } from '../../src/request-coordinator.js'

describe('Bot display infrastructure', () => {
  it.each([{ rm_subject_id: 253 }, { extra: { subject_id: 253 } }, { extra: { legacy_subject_id: 253 } }])('reads installed group sender names using explicit mapping %j', async mapping => {
    const session = { userId: 42, accessToken: 'fixture', refreshToken: 'fixture' }
    const authenticatedBotPost = vi.fn(async () => ({ bots: [
      { bot_id: 'installed', name: '群助手', installed: true },
      { bot_id: 'removed', name: '已移除', installed: false },
    ] }))
    const service = new RuntimeBotDisplayProfilesReader({
      authenticatedChatPost: vi.fn(async () => ({ session: { chat_session_uid: 'chat', ...mapping } })),
      authenticatedBotPost,
    } as never, {} as never)
    const signal = new AbortController().signal
    expect(await service.groupSenderDisplayProfiles('chat', session, signal)).toEqual(new Map([['installed', { displayName: '群助手', avatarUrl: '' }]]))
    expect(authenticatedBotPost).toHaveBeenCalledExactlyOnceWith('/api/v1/bot/group/list', { rm_subject_id: 253 }, session, signal,
      { refreshOnUnauthorized: false, key: 'group-bot-sender-display-names:chat', cancelWhenUnobserved: true })
  })

  it.each(['missing-target', 'wrong-chat', 'cancelled'] as const)('never substitutes Chat UID for Subject identity when %s', async scenario => {
    const failure = new Error('reader cancelled')
    const readBots = vi.fn()
    const service = new RuntimeBotDisplayProfilesReader({
      authenticatedChatPost: vi.fn(async () => {
        if (scenario === 'cancelled') throw failure
        return { session: { chat_session_uid: scenario === 'wrong-chat' ? 'other-chat' : 'chat',
          ...(scenario === 'wrong-chat' ? { rm_subject_id: 999 } : {}) } }
      }), authenticatedBotPost: readBots,
    } as never, {} as never)
    const pending = service.groupSenderDisplayProfiles('chat', { userId: 42, accessToken: 'fixture', refreshToken: 'fixture' })
    if (scenario === 'cancelled') await expect(pending).rejects.toBe(failure)
    else expect(await pending).toEqual(new Map())
    expect(readBots).not.toHaveBeenCalled()
  })

  it.each(['empty', 'complete', 'cancelled'] as const)('handles an already available snapshot: %s', async scenario => {
    const chatPost = vi.fn()
    const botNames = vi.fn()
    const reader = new RuntimeBotDisplayProfilesReader({ authenticatedChatPost: chatPost } as never, { senderDisplayProfiles: botNames })
    const controller = new AbortController()
    if (scenario === 'cancelled') controller.abort(new Error('closed'))
    const pending = reader.read({ botUids: new Set(scenario === 'empty' ? [] : ['bot']), chatSessionUid: 'chat', isGroup: true,
      snapshot: { chatSessionUid: 'chat', profiles: new Map([['bot', { displayName: 'Current', avatarUrl: 'bot.png' }]]) },
    }, { userId: 42, accessToken: 'fixture', refreshToken: 'fixture' }, controller.signal)
    if (scenario === 'cancelled') await expect(pending).rejects.toBe(controller.signal.reason)
    else expect([...(await pending)]).toEqual(scenario === 'empty' ? [] : [['bot', { displayName: 'Current', avatarUrl: 'bot.png' }]])
    expect(chatPost).not.toHaveBeenCalled()
    expect(botNames).not.toHaveBeenCalled()
  })

  it('normalizes participant wire data to display-only profiles and explicit group identity', () => {
    const snapshot = botDisplaySnapshot({ session: { chat_session_uid: 'chat', extra: { legacy_subject_id: 253 } },
      bot_participants: [
        { chat_session_uid: 'chat', bot_uid: 'bot', display_name_snapshot: 'Name', installed: true, status: 1,
          extra: { avatar_url: 'https://images.test/bot.png', permission: 'admin' } },
        { chat_session_uid: 'other', bot_uid: 'wrong', display_name_snapshot: 'Wrong' },
      ] })
    expect(snapshot.groupTarget).toEqual({ rmSubjectId: 253 })
    expect([...snapshot.profiles]).toEqual([['bot', { displayName: 'Name', avatarUrl: 'https://images.test/bot.png' }]])
  })
})

describe('Cached timeline bot display', () => {
  it('rejects every subscriber of a stale account lookup without caching the failure', async () => {
    const session = { userId: 42, accessToken: 'fixture', refreshToken: 'fixture' }
    const input = { botUids: new Set(['bot']), chatSessionUid: 'chat', isGroup: false }
    const snapshots = vi.fn().mockRejectedValueOnce(new ArkmeStaleRequestError()).mockResolvedValueOnce({ items: [{
      session: { chat_session_uid: 'chat' }, bot_participants: [{ chat_session_uid: 'chat', bot_uid: 'bot',
        display_name_snapshot: 'Bot', extra: { avatar_url: 'https://images.test/bot.png' } }],
    }] })
    const reader = new RuntimeBotDisplayProfilesReader({ config: { environment: 'test' }, stateStore: {},
      authenticatedChatPost: snapshots } as never, {} as never)
    const results = await Promise.allSettled([reader.read(input, session), reader.read(input, session)])
    expect(results).toEqual([expect.objectContaining({ status: 'rejected', reason: expect.any(ArkmeStaleRequestError) }),
      expect.objectContaining({ status: 'rejected', reason: expect.any(ArkmeStaleRequestError) })])
    expect(snapshots).toHaveBeenCalledTimes(1)
    expect(await reader.read(input, session)).toEqual(new Map([['bot', { displayName: 'Bot', avatarUrl: 'https://images.test/bot.png' }]]))
    expect(snapshots).toHaveBeenCalledTimes(2)
  })

  it('evicts the oldest conversation caches after concurrent lookups settle', async () => {
    const session = { userId: 42, accessToken: 'fixture', refreshToken: 'fixture' }
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const snapshots = vi.fn(async (_path: string, body: { chat_session_uids: string[] }) => {
      await gate
      return { items: [{ session: { chat_session_uid: body.chat_session_uids[0] }, bot_participants: [{
        chat_session_uid: body.chat_session_uids[0], bot_uid: 'bot', display_name_snapshot: 'Bot',
        extra: { avatar_url: 'https://images.test/bot.png' },
      }] }] }
    })
    const reader = new RuntimeBotDisplayProfilesReader({ config: { environment: 'test' }, stateStore: {},
      authenticatedChatPost: snapshots } as never, {} as never)
    const input = (index: number) => ({ botUids: new Set(['bot']), chatSessionUid: `chat-${index}`, isGroup: false })
    const pending = []
    for (let index = 0; index < 140; index++) {
      pending.push(reader.read(input(index), session))
      await Promise.resolve()
    }
    try { expect(snapshots).toHaveBeenCalledTimes(140) }
    finally { release(); await Promise.all(pending) }
    expect(await reader.cached(input(139), session)).toEqual(new Map([['bot', { displayName: 'Bot', avatarUrl: 'https://images.test/bot.png' }]]))
    expect(await reader.cached(input(0), session)).toEqual(new Map())
    expect(await reader.cached(input(12), session)).toEqual(new Map())
    expect(snapshots).toHaveBeenCalledTimes(140)
  })

  it('returns local data before the cloud, shares refresh across pages, and restores profiles and missing avatars from SQLite', async () => {
    const [{ mkdtempSync, rmSync }, { tmpdir }, { join }, { ArkmeLocalDatabase }, { ArkmeStateStore }] = await Promise.all([
      import('node:fs'), import('node:os'), import('node:path'), import('../../src/local-database.js'), import('../../src/state-store.js'),
    ])
    const directory = mkdtempSync(join(tmpdir(), 'arkme bot display '))
    let database = new ArkmeLocalDatabase(directory, new ArkmeStateStore(directory))
    try {
      const session = { userId: 42, accessToken: 'fixture', refreshToken: 'fixture' }
      let finish!: () => void
      const waiting = new Promise<void>(resolve => { finish = resolve })
      const snapshots = vi.fn(async () => {
        await waiting
        return { items: [{ session: { chat_session_uid: 'chat', extra: { subject_id: 12 } },
          bot_participants: [{ chat_session_uid: 'chat', bot_uid: 'known', display_name_snapshot: '会话昵称' }] }] }
      })
      const directoryProfiles = vi.fn(async () => new Map([
        ['known', { displayName: '目录昵称', avatarUrl: 'https://images.test/bot.png' }],
        ['no-avatar', { displayName: '无头像' }],
      ]))
      const groupProfiles = vi.fn(async () => ({ bots: [] }))
      const boot = () => new RuntimeBotDisplayProfilesReader({
        config: { environment: 'prod' }, stateStore: database, authenticatedChatPost: snapshots, authenticatedBotPost: groupProfiles,
      } as never, { senderDisplayProfiles: directoryProfiles })
      let reader = boot()
      const input = { chatSessionUid: 'chat', isGroup: true, botUids: new Set(['known', 'no-avatar']) }
      expect(await reader.cached(input, session)).toEqual(new Map())
      expect(snapshots).not.toHaveBeenCalled()
      const controller = new AbortController()
      const dropped = reader.read(input, session, controller.signal)
      const settled = expect(dropped).rejects.toThrow('left')
      const kept = reader.read(input, session)
      await vi.waitFor(() => expect(snapshots).toHaveBeenCalledTimes(1))
      controller.abort(new Error('left'))
      await settled
      expect(await reader.cached(input, session)).toEqual(new Map())
      finish()
      const expected = new Map([
        ['known', { displayName: '会话昵称', avatarUrl: 'https://images.test/bot.png' }],
        ['no-avatar', { displayName: '无头像' }],
      ])
      expect(await kept).toEqual(expected)
      expect(await reader.read(input, session)).toEqual(expected)
      expect(snapshots).toHaveBeenCalledTimes(1)
      expect(directoryProfiles).toHaveBeenCalledTimes(1)
      expect(groupProfiles).toHaveBeenCalledTimes(1)
      database.close()
      database = new ArkmeLocalDatabase(directory, new ArkmeStateStore(directory))
      reader = boot()
      expect(await reader.cached(input, session)).toEqual(expected)
      expect(await reader.read(input, session)).toEqual(expected)
      expect(await reader.cached({ ...input, chatSessionUid: 'other-chat' }, session)).toEqual(new Map())
      expect(await reader.cached(input, { ...session, userId: 43 })).toEqual(new Map())
      expect(snapshots).toHaveBeenCalledTimes(1)
    } finally {
      database.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
