import { describe, expect, it } from 'vitest'
import {
  arkmeBadgeUnreadCount,
  arkmeNotificationAllowed,
  projectArkmeChatAttention,
  projectArkmeChatAttentionFromMuted,
} from '../src/chat-attention.js'

describe('Arkme Chat attention projection', () => {
  it('keeps raw unread while suppressing every attention consumer for mute_state', () => {
    expect(projectArkmeChatAttention(12, { mute_state: 2, notify_state: 1 })).toEqual({
      unreadCount: 12,
      badgeUnreadCount: 0,
      notificationAllowed: false,
      isMuted: true,
    })
  })

  it('treats notify_state as the same canonical attention policy', () => {
    expect(projectArkmeChatAttention('7', { mute_state: 1, notify_state: '2' })).toEqual({
      unreadCount: 7,
      badgeUnreadCount: 0,
      notificationAllowed: false,
      isMuted: true,
    })
  })

  it('derives compatible badge and notification values for cached projections', () => {
    const projected = projectArkmeChatAttentionFromMuted(3, false)
    expect(arkmeBadgeUnreadCount(projected)).toBe(3)
    expect(arkmeNotificationAllowed(projected)).toBe(true)
    expect(arkmeBadgeUnreadCount({ unreadCount: 99, isMuted: true })).toBe(0)
  })
})
