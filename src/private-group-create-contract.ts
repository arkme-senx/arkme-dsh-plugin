import type { ArkmeGroupAvatarFallback, ArkmeSourceItem } from './types.js'

export const PRIVATE_GROUP_MAX_PEOPLE = 100
export interface PrivateGroupRequest { accountScope: string; sourceRef: string }
export interface PrivateGroupPerson { personRef: string; displayName: string; searchText: string; avatarRef?: string; avatarFallback?: ArkmeGroupAvatarFallback }
export interface PrivateGroupContext { peerName: string; peerAvatarRef?: string }
export interface PrivateGroupPeoplePage { items: PrivateGroupPerson[]; hasMore: boolean; nextCursor?: string; incomplete: boolean }
export interface PrivateGroupMatch { source: ArkmeSourceItem; kind: 'exact' | 'includes'; memberCount: number; extraCount: number }
export interface PrivateGroupSelection extends PrivateGroupRequest { personRefs: string[] }
export interface PrivateGroupCreateInput extends PrivateGroupSelection {
  title: string
  isPublic: boolean
  clientMutationId: string
  allowDuplicate: boolean
  allowUnchecked: boolean
}
export type PrivateGroupCreateResult = { status: 'created'; source: ArkmeSourceItem } | { status: 'matches'; matches: PrivateGroupMatch[] }
