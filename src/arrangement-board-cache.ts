import type { ArkmeArrangementPage, ArkmeArrangementStatus } from './types.js'
import { validRecordingSourceDay } from './arrangement-recording-source.js'

export type ArkmeArrangementBoardCachePages = Partial<Record<Exclude<ArkmeArrangementStatus, 'unknown'>, ArkmeArrangementPage>>
export interface ArkmeArrangementBoardCache { pages: ArkmeArrangementBoardCachePages }
export const ARRANGEMENT_BOARD_CACHE_MAX_BYTES = 16 * 1024 * 1024
const columns = new Set(['identified', 'following', 'completed'])
function fail(): never { throw new Error('安排看板缓存格式无效') }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail()
  return value as Record<string, unknown>
}
function keys(value: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) fail()
}
function text(value: unknown, max: number): void { if (typeof value !== 'string' || value.length > max) fail() }
function integer(value: unknown): void { if (!Number.isSafeInteger(value) || (value as number) < 0) fail() }

/** Validate the browser projection only; owner IDs and arbitrary payload fields are never persisted. */
export function parseArrangementBoardCachePages(value: unknown): ArkmeArrangementBoardCachePages {
  const pages = object(value)
  for (const [column, raw] of Object.entries(pages)) {
    if (!columns.has(column)) fail()
    const page = object(raw)
    keys(page, ['items', 'total', 'hasMore', 'nextOffset', 'board'])
    integer(page.total)
    if (typeof page.hasMore !== 'boolean' || !Array.isArray(page.items) || page.items.length > 50 || page.items.length > (page.total as number)) fail()
    if (page.nextOffset !== undefined) integer(page.nextOffset)
    if (page.board !== undefined) {
      const board = object(page.board)
      keys(board, ['supported', 'version'])
      if (typeof board.supported !== 'boolean') fail()
      text(board.version, 1024)
    }
    const refs = new Set<string>()
    for (const rawItem of page.items as unknown[]) {
      const item = object(rawItem)
      keys(item, ['arrangementRef', 'title', 'description', 'status', 'reminderEnabled', 'reminderState', 'createdAtMillis', 'updatedAtMillis', 'dueAtMillis', 'remindAtMillis', 'creationSource', 'recognitionState', 'recordingSource', 'provenance', 'sourceType'])
      if (item.status !== column || typeof item.reminderEnabled !== 'boolean' || typeof item.arrangementRef !== 'string'
        || !/^arkme-arrangement-v1\.[A-Za-z0-9_-]{43}$/.test(item.arrangementRef) || refs.has(item.arrangementRef)) fail()
      refs.add(item.arrangementRef as string)
      text(item.title, 20000); text(item.description, 200000); text(item.reminderState, 256)
      integer(item.createdAtMillis); integer(item.updatedAtMillis)
      for (const key of ['dueAtMillis', 'remindAtMillis']) if (item[key] !== undefined) integer(item[key])
      if (item.recognitionState !== undefined) text(item.recognitionState, 256)
      if (item.sourceType !== undefined) integer(item.sourceType)
      if (item.provenance !== undefined) {
        if (!Array.isArray(item.provenance) || item.provenance.length > 200) fail()
        for (const raw of item.provenance as unknown[]) {
          const e = object(raw)
          keys(e, ['id','kind','role','text','canOpen','sourceDate','createdAtMillis','unavailableReason'])
          text(e.id,512); text(e.text,200000)
          if (!['record','audio_summary','call','input','voice_input','agent','manual'].includes(e.kind as string) || !['initial','supplement','related'].includes(e.role as string) || typeof e.canOpen !== 'boolean') fail()
          if (e.createdAtMillis !== undefined) integer(e.createdAtMillis)
          if (e.sourceDate !== undefined && (typeof e.sourceDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(e.sourceDate))) fail()
          if (e.unavailableReason !== undefined) text(e.unavailableReason,512)
        }
      }
      if (item.recordingSource !== undefined) {
        const source = object(item.recordingSource)
        if (source.kind !== 'daily-summary' || !['ready', 'unavailable'].includes(source.state as string)) fail()
        keys(source, source.state === 'ready' ? ['kind', 'state', 'dateStamp', 'tzOffsetMillis', 'summaryVersionId'] : ['kind', 'state'])
        if (source.state === 'ready') {
          if (!validRecordingSourceDay(source.dateStamp, source.tzOffsetMillis)) fail()
          if (source.summaryVersionId !== undefined) { text(source.summaryVersionId, 512); if (!(source.summaryVersionId as string).trim()) fail() }
        }
      }
      if (item.creationSource !== undefined) {
        const source = object(item.creationSource)
        keys(source, ['kind', 'items', 'unavailableCount'])
        if (!['quick-note', 'input', 'none'].includes(source.kind as string) || !Array.isArray(source.items) || source.items.length > 100) fail()
        integer(source.unavailableCount)
        for (const rawSource of source.items as unknown[]) {
          const entry = object(rawSource)
          keys(entry, ['text', 'createdAtMillis'])
          text(entry.text, 200000)
          if (entry.createdAtMillis !== undefined) integer(entry.createdAtMillis)
        }
      }
    }
  }
  if (JSON.stringify(pages).length > ARRANGEMENT_BOARD_CACHE_MAX_BYTES / 4) fail()
  return structuredClone(pages) as ArkmeArrangementBoardCachePages
}
