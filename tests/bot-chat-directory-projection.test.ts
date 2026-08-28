import { describe, expect, it } from 'vitest'
import { projectBotChatDirectory } from '../src/client/bot-chat-directory-projection.js'
import type { ArkmeBotSummary, ArkmeSourceItem } from '../src/types.js'

const chatBot: ArkmeBotSummary = {
  botRef: 'bot-ref', name: 'Agent Bot', provider: 'webhook', description: '', status: 'online',
  directChatAvailable: true, privateChatOutboundEnabled: true, conversationProjection: 'chat',
  chatSourceKey: 'opaque-chat-key', createdAtMillis: 10,
}
const subjectBot: ArkmeBotSummary = {
  ...chatBot, botRef: 'subject-ref', name: 'Subject Bot', conversationProjection: 'record',
  chatSourceKey: undefined,
}
const matchingSource: ArkmeSourceItem = {
  sourceRef: 'source-ref', sourceKey: 'opaque-chat-key', kind: 'private_chat', displayName: 'Generic Chat',
  latestPreview: '最新 Chat 消息', activeAtMillis: 20, unreadCount: 3, latestSequence: 4, isMuted: true,
}

describe('Bot Chat directory projection', () => {
  it('removes only the generic source row owned by the same Chat Bot and keeps the Bot presentation identity', () => {
    const unrelated = { ...matchingSource, sourceRef: 'unrelated', sourceKey: 'other-key' }
    const projected = projectBotChatDirectory([matchingSource, unrelated], [chatBot, subjectBot])

    expect(projected.sources).toEqual([unrelated])
    expect(projected.bots).toEqual([
      { ...chatBot, latestMessageAtMillis: 20, latestMessagePreview: '最新 Chat 消息', unreadCount: 3, isMuted: true },
      subjectBot,
    ])
  })

  it('does not merge a source without an exact opaque key match', () => {
    const projected = projectBotChatDirectory([{ ...matchingSource, sourceKey: undefined }], [chatBot])
    expect(projected.sources).toHaveLength(1)
    expect(projected.bots).toEqual([chatBot])
  })

  it('never consumes a group source even when an invalid projection reuses the opaque key', () => {
    const group = { ...matchingSource, kind: 'group_chat' as const }
    const projected = projectBotChatDirectory([group], [chatBot])
    expect(projected.sources).toEqual([group])
    expect(projected.bots).toEqual([chatBot])
  })

  it('keeps a newer Bot-side activity projection instead of regressing it', () => {
    const bot = { ...chatBot, latestMessageAtMillis: 30, latestMessagePreview: '更新的 Bot 投影' }
    const projected = projectBotChatDirectory([matchingSource], [bot])
    expect(projected.bots).toEqual([{ ...bot, unreadCount: 3, isMuted: true }])
  })

  it('does not pair a newer Chat activity time with an older Bot preview when hydration has no readable body', () => {
    const bot = { ...chatBot, latestMessageAtMillis: 15, latestMessagePreview: '旧消息' }
    const source = { ...matchingSource, latestPreview: undefined }
    const projected = projectBotChatDirectory([source], [bot])

    expect(projected.bots[0]).toMatchObject({ latestMessageAtMillis: 20 })
    expect(projected.bots[0]).toMatchObject({ unreadCount: 3 })
    expect(projected.bots[0]).toMatchObject({ isMuted: true })
    expect(projected.bots[0]).not.toHaveProperty('latestMessagePreview')
  })
})
