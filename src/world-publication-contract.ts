import type { WorldPublishOrigin } from './world-publish-source.js'
import type { ArkmeWorldPublishResult } from './types.js'
export interface WorldPublication {
  key: string
  ref: string
  kind: 'person' | 'team'
  label: string
  requested: boolean
  pending: boolean
  canUnpublish: boolean
}
export interface WorldPublicationSourceTarget {
  sourceRef: string
  messageActionRef: string
  itemUid: string
}
export type WorldPublicationRequest = { accountKey: string } & (
  | { action: 'sources'; targets: WorldPublicationSourceTarget[] }
  | { action: 'management'; recordRef: string }
  | { action: 'publish-source'; origin: WorldPublishOrigin; version: number }
  | { action: 'unpublish'; publicationRef: string; requestUid: string }
)
export type WorldPublicationResponse<R extends WorldPublicationRequest> = R extends { action: 'sources' }
  ? { items: { itemUid: string; publications: WorldPublication[] }[] }
  : R extends { action: 'management' }
    ? { publications: WorldPublication[] }
    : R extends { action: 'publish-source' }
      ? ArkmeWorldPublishResult
      : { completed: boolean; pending: boolean }
