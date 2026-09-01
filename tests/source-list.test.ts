import { describe, expect, it } from 'vitest'
import type { ArkmeSourceItem } from '../src/types.js'
import {
  arkmeSelfDirectorySources, arkmeSendToSelfDirectoryPresentation, arkmeSourceTimeLabel,
  isArkmeChatDirectorySource, isArkmeSelfWorkspaceSource, sortArkmeSources,
} from '../src/client/source-list.js'
import {
  arkmeRootChatPreview, arkmeRootChatPreviewParts, arkmeRootChatUnreadPlacement,
} from '../src/client/ArkmeVirtualWorkspace.js'

function source(
  sourceRef: string,
  displayName: string,
  activeAtMillis: number,
  recordCount: number,
  parentSourceRef?: string,
): ArkmeSourceItem {
  return {
    sourceRef,
    ...(parentSourceRef === undefined ? {} : { parentSourceRef }),
    kind: 'topic',
    displayName,
    activeAtMillis,
    unreadCount: 0,
    recordCount,
  }
}

describe('Arkme send-to-self source list', () => {
  it('keeps the aggregate selected in the left navigation while excluding it from category rows', () => {
    const aggregate = { ...source('aggregate', '发给自己', 0, 0), kind: 'send_to_self' as const }
    const defaultCategory = { ...source('default', '默认分类', 0, 0), kind: 'default_category' as const }
    const topic = source('topic', '工作', 0, 0)
    const chat = { ...source('chat', '联系人', 0, 0), kind: 'private_chat' as const }

    expect(isArkmeSelfWorkspaceSource(undefined)).toBe(true)
    expect(isArkmeSelfWorkspaceSource(aggregate)).toBe(true)
    expect(isArkmeSelfWorkspaceSource(defaultCategory)).toBe(true)
    expect(isArkmeSelfWorkspaceSource(topic)).toBe(true)
    expect(isArkmeSelfWorkspaceSource(chat)).toBe(false)
    expect(arkmeSelfDirectorySources([aggregate, defaultCategory, topic]).map(item => item.displayName))
      .toEqual(['默认分类', '工作'])
  })

  it('keeps send-to-self destinations out of the left conversation directory', () => {
    const aggregate = { ...source('aggregate', '发给自己', 0, 0), kind: 'send_to_self' as const }
    const defaultCategory = { ...source('default', '默认分类', 0, 0), kind: 'default_category' as const }
    const topic = source('topic', '工作', 0, 0)
    const privateChat = { ...source('private', '私聊', 0, 0), kind: 'private_chat' as const }
    const groupChat = { ...source('group', '群聊', 0, 0), kind: 'group_chat' as const }

    expect(isArkmeChatDirectorySource(aggregate)).toBe(false)
    expect(isArkmeChatDirectorySource(defaultCategory)).toBe(false)
    expect(isArkmeChatDirectorySource(topic)).toBe(false)
    expect(isArkmeChatDirectorySource(privateChat)).toBe(true)
    expect(isArkmeChatDirectorySource(groupChat)).toBe(true)
  })

  it('prefixes group chat previews when the backend marks an unread mention', () => {
    const groupChat: ArkmeSourceItem = {
      sourceRef: 'group', kind: 'group_chat', displayName: '群聊',
      activeAtMillis: 1, unreadCount: 1, hasUnreadMention: true, latestPreview: '@所有人 开会',
    }
    const privateChat: ArkmeSourceItem = {
      sourceRef: 'private', kind: 'private_chat', displayName: '私聊',
      activeAtMillis: 1, unreadCount: 1, hasUnreadMention: true, latestPreview: '私聊消息',
    }

    expect(arkmeRootChatPreview(groupChat)).toBe('[有人@我] @所有人 开会')
    expect(arkmeRootChatPreviewParts(groupChat)).toEqual({ mentionPrefix: '[有人@我] ', preview: '@所有人 开会' })
    expect(arkmeRootChatUnreadPlacement(groupChat)).toBe('avatar')
    expect(arkmeRootChatPreview(privateChat)).toBe('私聊消息')
    expect(arkmeRootChatPreview({ ...privateChat, latestPreview: '[jm_emoji:silent_face]' })).toBe('😶')
    expect(arkmeRootChatUnreadPlacement(privateChat)).toBe('avatar')
    expect(arkmeRootChatUnreadPlacement({ ...groupChat, isMuted: true, badgeUnreadCount: 0 })).toBe('dot')
    expect(arkmeRootChatUnreadPlacement({
      ...groupChat, isMuted: true, notificationAllowed: false, unreadCount: 0, badgeUnreadCount: 0,
    })).toBe('none')
  })

  it('globally sorts parents and children for card modes without mutating its input', () => {
    const sources = [
      source('parent', 'Beta', 20, 5),
      source('child', 'Alpha', 30, 1, 'parent'),
      source('root', 'Gamma', 10, 10),
    ]

    expect(sortArkmeSources(sources, 'default').map(item => item.sourceRef))
      .toEqual(['parent', 'child', 'root'])
    expect(sortArkmeSources(sources, 'latest').map(item => item.sourceRef))
      .toEqual(['child', 'parent', 'root'])
    expect(sortArkmeSources(sources, 'most').map(item => item.sourceRef))
      .toEqual(['root', 'parent', 'child'])
    expect(sources.map(item => item.sourceRef)).toEqual(['parent', 'child', 'root'])
  })

  it('formats compact Chinese timestamps for source-card metadata', () => {
    const now = new Date(2026, 7, 18, 21, 30).getTime()
    expect(arkmeSourceTimeLabel(new Date(2026, 7, 18, 20, 49).getTime(), now)).toBe('20:49')
    expect(arkmeSourceTimeLabel(new Date(2026, 7, 17, 8, 0).getTime(), now)).toBe('昨天 08:00')
    expect(arkmeSourceTimeLabel(new Date(2026, 7, 5, 8, 0).getTime(), now)).toBe('8月5日')
  })

  it('presents the aggregate latest message and time in the conversation directory', () => {
    const now = new Date(2026, 7, 18, 21, 30).getTime()
    const aggregate: ArkmeSourceItem = {
      ...source('aggregate', '发给自己', new Date(2026, 7, 18, 20, 49).getTime(), 0),
      kind: 'send_to_self',
      latestPreview: '最新发给自己的消息',
    }

    expect(arkmeSendToSelfDirectoryPresentation(aggregate, now)).toEqual({
      preview: '最新发给自己的消息',
      time: '20:49',
    })
    expect(arkmeSendToSelfDirectoryPresentation(undefined, now)).toEqual({
      preview: '全部个人消息',
      time: '',
    })
  })
})
