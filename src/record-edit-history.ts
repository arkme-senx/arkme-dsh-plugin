import type { ArkmeContentBlock, ArkmeTimelineItem } from './types.js'

/** Revision content is immutable display data, never a mutable timeline message. */
export interface ArkmeRecordRevision {
  revisionUid: string
  kind: 'manual' | 'original'
  editAtMillis: number
  content: Pick<ArkmeTimelineItem, 'title' | 'textContent' | 'textFormat' | 'mediaUnavailable'> & { contentBlocks: ArkmeContentBlock[] }
}

export interface ArkmeRecordEditHistoryPage {
  items: ArkmeRecordRevision[]
  hasMore: boolean
  nextCursorEditAt?: number
}

export interface ArkmeRecordEditHistoryReader {
  page(sourceRef: string, messageActionRef: string, cursorEditAt: number, signal: AbortSignal): Promise<ArkmeRecordEditHistoryPage>
}

/** Missing is distinct from explicit false, including on older cached projections. */
export function recordManualEditFact(raw: unknown): boolean | undefined {
  const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const root = object(raw)
  const record = object(root.record)
  const sources = [object(record.payload), object(root.record_core), record, root]
  for (const source of sources) {
    if (typeof source.has_manual_edit === 'boolean') return source.has_manual_edit
  }
  for (const source of sources) {
    if (typeof source.edit_status === 'number') return source.edit_status === 3 || source.edit_status === 4
  }
  return undefined
}
