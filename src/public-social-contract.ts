import type { ArkmeSourceItem } from './types.js'

export type PublicSocialTab = 'groups' | 'people'
export interface PublicGroup {
  chatSessionUid: string
  title: string
  introduction: string
  ownerUserId: number
  hasJoined: boolean
  joinMode: 1 | 2 | 3
  joinRequest?: { requestUid: string; status: 1 | 2 | 3 }
}
export interface PublicPerson {
  userId: number
  isListed: boolean
  displayName: string
  avatarUrl: string
  introduction: string
}
export interface PublicGroupPage { items: PublicGroup[]; hasMore: boolean; nextCursor?: string }
export interface PublicPeoplePage { items: PublicPerson[]; hasMore: boolean; nextCursor?: number }
export interface PublicGroupQuery {
  accountScope: string
  query?: string
  cursor?: string
  userId?: number
  relation?: 'created' | 'joined'
}
export interface PublicPeopleQuery { accountScope: string; query?: string; cursor?: number }
export interface PublicGroupSettings {
  chatSessionUid: string
  isPublic: boolean
  introduction: string
  canManage: boolean
  isShown: boolean
}
export interface PublicGroupJoinResult {
  status: 'joined' | 'pending'
  group: PublicGroup
  source?: ArkmeSourceItem
}

/** Copy derives only from server membership/approval, never a local optimistic join. */
export function publicGroupJoinLabel(group: PublicGroup): string {
  if (group.hasJoined) return '打开群聊'
  if (group.joinMode !== 2) return '加入群聊'
  if (group.joinRequest?.status === 1) return '等待审批'
  if (group.joinRequest?.status === 2) return '进入群聊'
  if (group.joinRequest?.status === 3) return '重新申请'
  return '申请加入'
}
