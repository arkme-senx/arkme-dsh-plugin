import type { ArkmeGroupAvatarFallback, ArkmeSourceItem } from './types.js'

export type IdentityShareTarget = { kind: 'self' } | { kind: 'person'; userId: number }
  | { kind: 'contact'; contactRef: string } | { kind: 'source'; sourceRef: string }
  | { kind: 'member'; sourceRef: string; memberRef: string }
  | { kind: 'author'; authorRef: string }
export interface IdentityShareLink { kind: 'person' | 'group'; url: string; expireAtMillis?: number }
export type IdentityShareCard = {
  kind: 'person'; url: string; userId: number; displayName: string; accountName: string; isSelf: boolean
  avatarRef?: string; avatarFallback?: ArkmeGroupAvatarFallback
} | {
  kind: 'group'; url: string; displayName: string; creatorDisplayName: string; hasJoined: boolean
  joinMode: 1 | 2; requestPending: boolean; expireAtMillis: number
}
export type IdentityShareActionResult = { status: 'opened'; source: ArkmeSourceItem } | { status: 'pending' }
