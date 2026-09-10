import { expect, it } from 'vitest'
import { retainNewerArkmeChatPolicy } from '../src/chat-policy-projection.js'
import type { ArkmeSourceItem } from '../src/types.js'

const source: ArkmeSourceItem = {
  sourceRef: 'ref', kind: 'private_chat', displayName: '会话', isPinned: false, isMuted: false,
}

it('accepts notification evidence newer than mute even when a pin hint has a later version', () => {
  const current = { ...source, isPinned: true, chatPolicyUpdatedAtMillis: 3000, chatNotificationPolicyUpdatedAtMillis: 1000 }
  const incoming = { ...source, isMuted: true, chatPolicyUpdatedAtMillis: 2000, chatNotificationPolicyUpdatedAtMillis: 2000 }
  expect(retainNewerArkmeChatPolicy(current, incoming)).toMatchObject({
    isPinned: true, isMuted: true, chatPolicyUpdatedAtMillis: 3000, chatNotificationPolicyUpdatedAtMillis: 2000,
  })
})

it('preserves notification evidence and recomputes attention from incoming unread count', () => {
  const current = { ...source, isPinned: true, isMuted: true, unreadCount: 2, chatPolicyUpdatedAtMillis: 3000, chatNotificationPolicyUpdatedAtMillis: 2000 }
  const incoming = { ...source, unreadCount: 5, badgeUnreadCount: 5, notificationAllowed: true, chatPolicyUpdatedAtMillis: 1000, chatNotificationPolicyUpdatedAtMillis: 1000 }
  expect(retainNewerArkmeChatPolicy(current, incoming)).toMatchObject({
    isPinned: true, isMuted: true, unreadCount: 5, badgeUnreadCount: 0, notificationAllowed: false,
    chatPolicyUpdatedAtMillis: 3000, chatNotificationPolicyUpdatedAtMillis: 2000,
  })
})

it('rejects a delayed mute confirmation after a newer unmute and preserves its unread count', () => {
  const current = { ...source, chatNotificationPolicyUpdatedAtMillis: 3000, unreadCount: 3 }
  const incoming = { ...source, isMuted: true, unreadCount: 5, badgeUnreadCount: 0, notificationAllowed: false, chatNotificationPolicyUpdatedAtMillis: 2000 }
  expect(retainNewerArkmeChatPolicy(current, incoming)).toMatchObject({
    isMuted: false, unreadCount: 5, badgeUnreadCount: 5, notificationAllowed: true,
    chatNotificationPolicyUpdatedAtMillis: 3000,
  })
})

it('does not let an unversioned read override known notification evidence', () => {
  const current = { ...source, isMuted: true, chatNotificationPolicyUpdatedAtMillis: 2000 }
  expect(retainNewerArkmeChatPolicy(current, { ...source, unreadCount: 5 })).toMatchObject({
    isMuted: true, badgeUnreadCount: 0, notificationAllowed: false, chatNotificationPolicyUpdatedAtMillis: 2000,
  })
})
