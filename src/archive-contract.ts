import type { ArkmeSourceItem } from './types.js'

/** Independent intent and inherited effect are deliberately separate. */
export interface ArkmeArchiveState {
  entityType: 'topic'
  sourceRef: string
  ownerAvailable: boolean
  selfArchived: boolean
  effectiveArchived: boolean
  revision: number
  displayArchiveAt: number
  inheritedFrom?: { sourceRef: string; topicHierarchyKey: string }
}

export interface ArkmeArchiveEntry extends ArkmeArchiveState {
  source: ArkmeSourceItem & { kind: 'topic'; topicHierarchyKey: string }
  privacyLocked: boolean
  /** Authorized display summary from the same owner snapshot as the list. */
  inheritedFromSummary?: { title: string; privacyLocked: boolean }
}

export interface ArkmeArchivePage {
  items: ArkmeArchiveEntry[]
  hasMore: boolean
  nextCursor?: string
}

export interface ArkmeArchiveSetInput {
  sourceRef: string
  selfArchived: boolean
  expectedRevision: number
}

export interface ArkmeArchiveSetResult extends ArkmeArchiveState {
  stateChanged: boolean
  effectiveChangedCount: number
}

export interface ArkmeArchivePort {
  listArchives(cursor?: string, signal?: AbortSignal): Promise<ArkmeArchivePage>
  getArchiveStates(sourceRefs: readonly string[], signal?: AbortSignal): Promise<ArkmeArchiveState[]>
  setArchiveState(input: ArkmeArchiveSetInput, signal?: AbortSignal): Promise<ArkmeArchiveSetResult>
}
