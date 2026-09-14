import { describe, expect, it, vi } from 'vitest'
import { RuntimeBotDisplayProfilesReader, botDisplaySnapshot } from '../../src/services/chat-sender-display-reader.js'

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
