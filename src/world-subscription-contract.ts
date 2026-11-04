import type { ArkmeTeam, ArkmeWorldFeedItem } from './types.js'

export type WorldSubscriptionTarget = { kind: 'person'; userId: number } | { kind: 'team'; jotmoId: string }
export type WorldSubscriptionIncoming = { kind: 'self' } | { kind: 'team'; teamRef: string }
export interface WorldSubscriptionSubject {
  kind: 'person' | 'team'; id: string; name: string; available: boolean
  userId?: number; jotmoId?: string
}
export interface WorldSubscriptionRow {
  subject: WorldSubscriptionSubject; subscriber: { userId: number; name: string }; subscribed: boolean; updatedAt: number
}
export interface WorldSubscriptionList { items: WorldSubscriptionRow[]; hasMore: boolean; nextCursor?: string }
export interface WorldSubscriptionNotice {
  id: string; kind: 'subscriber' | 'publication'; subject: WorldSubscriptionSubject
  actor: { userId: number; name: string }; at: number; unread: boolean; readRef: string
  scopeKey: string; sequence: number; publication?: ArkmeWorldFeedItem
}
export interface WorldSubscriptionNoticePage { items: WorldSubscriptionNotice[]; unreadCount: number; hasMore: boolean; nextCursor?: string }
export type WorldSubscriptionRequest = { accountKey: string } & (
  | { action: 'state'; target: WorldSubscriptionTarget | WorldSubscriptionSubject }
  | { action: 'set'; target: WorldSubscriptionTarget | WorldSubscriptionSubject; active: boolean; requestUid: string }
  | { action: 'query'; incoming?: WorldSubscriptionIncoming; cursor?: string }
  | { action: 'notifications'; cursor?: string }
  | { action: 'read'; readRefs: string[] }
  | { action: 'contact'; userId: number; displayName: string }
)
export interface WorldSubscriptionManagedTeam { team: ArkmeTeam; id: string }
