import type { ArkmeSourceItem, ArkmeGroupAvatarPresentation } from './types.js'

export const COMMON_GROUP_PAGE_SIZE = 20

/** Public projection; internal chat identities never cross the Host boundary. */
export interface ArkmeCommonGroupPage {
  items: Array<{ source: ArkmeSourceItem; memberCount: number }>
  totalCached: number
  hasMore: boolean
  nextCursor?: string
  syncedAtMillis: number
  revision: number
  syncHasMore: boolean
}

export interface CommonGroupRow { uid: string; title: string; memberCount: number; groupAvatar?: ArkmeGroupAvatarPresentation }
export interface CommonGroupCheckpoint {
  revision: number
  phase: 'check' | 'discover' | 'complete'
  after: string
  syncedAtMillis: number
}
export interface CommonGroupLocalPage {
  items: CommonGroupRow[]
  total: number
  hasMore: boolean
  checkpoint: CommonGroupCheckpoint
}

/** Business persistence port: every applied batch and its checkpoint are atomic. */
export interface CommonGroupStore {
  get(scope: string, peer: string, uids: string[]): CommonGroupRow[]
  read(scope: string, peer: string, after?: string): CommonGroupLocalPage
  apply(scope: string, peer: string, expected: CommonGroupCheckpoint, changes: {
    items: CommonGroupRow[]; removed: string[]; phase: CommonGroupCheckpoint['phase']; after: string
  }): boolean
}
