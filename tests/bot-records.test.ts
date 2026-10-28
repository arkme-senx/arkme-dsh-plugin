import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ArkmeTimelineItem } from '../src/types.js'
import { arkmeLoadedBotRecords } from '../src/client/bot-records.js'
import { ArkmeLoadedBotRecordsPanel } from '../src/client/ArkmeChatMemberActions.js'
import { ArkmeBotRemoveDialog } from '../src/client/ArkmeBotAvatarActions.js'

const message = (itemUid: string, overrides: Partial<ArkmeTimelineItem> = {}): ArkmeTimelineItem => ({
  itemUid, senderName: '相同昵称', isMe: false, sendAtMillis: 1,
  title: '', textContent: itemUid, status: 1, ...overrides,
})

it('labels Bot history as loaded-only and does not imply a server total', () => {
  const markup = renderToStaticMarkup(createElement(ArkmeLoadedBotRecordsPanel, {
    sourceRef: 'group-ref', botName: '小助手', mode: 'owner',
    items: [message('bot-a', { senderKind: 'bot', senderBotDirectoryKey: 'key-a' })],
    onClose: () => undefined,
  }))
  expect(markup).toContain('小助手的消息')
  expect(markup).toContain('仅当前已加载消息')
  expect(markup).toContain('data-arkme-bot-record-id="bot-a"')
  expect(markup).not.toContain('data-total=')
})

it('requires confirmation before removing a Bot and preserves historical messages', () => {
  const markup = renderToStaticMarkup(createElement(ArkmeBotRemoveDialog, {
    sourceRef: 'group-ref',
    bot: { botRef: 'bot-ref', directoryKey: 'key-a', name: '小助手', provider: 'openclaw',
      description: '', status: 'active', installed: true },
    onRemoved: () => undefined, onClose: () => undefined,
  }))
  expect(markup).toContain('移出群聊？')
  expect(markup).toContain('历史消息保留')
  expect(markup).toContain('确认移除')
})

describe('loaded Bot records', () => {
  const items = [
    message('bot-a', { senderKind: 'bot', senderBotDirectoryKey: 'key-a' }),
    message('bot-b', { senderKind: 'bot', senderBotDirectoryKey: 'key-b' }),
    message('human-same-name', { senderKind: 'human', mentions: [
      { kind: 'bot', displayName: '相同昵称', startIndex: 0, length: 4, botDirectoryKey: 'key-a' },
    ] }),
    message('other-mention', { mentions: [
      { kind: 'bot', displayName: '相同昵称', startIndex: 0, length: 4, botDirectoryKey: 'key-b' },
    ] }),
    message('name-only', { senderKind: 'bot', mentions: [
      { kind: 'bot', displayName: '相同昵称', startIndex: 0, length: 4 },
    ] }),
  ]

  it('shows only exact Bot-authored messages in the loaded window', () => {
    expect(arkmeLoadedBotRecords(items, 'key-a', 'owner').map(item => item.itemUid)).toEqual(['bot-a'])
  })

  it('shows only exact Bot mentions in the loaded window', () => {
    expect(arkmeLoadedBotRecords(items, 'key-a', 'mentioned').map(item => item.itemUid))
      .toEqual(['human-same-name'])
  })

  it('never guesses identity from a nickname or missing key', () => {
    expect(arkmeLoadedBotRecords(items, undefined, 'owner')).toEqual([])
    expect(arkmeLoadedBotRecords(items, 'unknown', 'mentioned')).toEqual([])
  })
})
