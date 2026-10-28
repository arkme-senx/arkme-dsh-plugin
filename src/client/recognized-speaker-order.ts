import type { ArkmeDirectoryPage } from '../types.js'

export type RecognizedSpeakerOrder = 'frequent' | 'recent'
export type UnmarkedSpeakerRow = Extract<ArkmeDirectoryPage['items'][number], { kind: 'unmarked-speaker' }>
type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>
const preferenceKey = (accountKey: string) => `dsh-arkme:recognized-speaker-order:v1:${accountKey}`

function browserStorage(): PreferenceStorage | undefined {
  try { return typeof window === 'undefined' ? undefined : window.localStorage }
  catch { return undefined }
}

export function readRecognizedSpeakerOrder(accountKey: string, storage = browserStorage()): RecognizedSpeakerOrder {
  try { return storage?.getItem(preferenceKey(accountKey)) === 'recent' ? 'recent' : 'frequent' }
  catch { return 'frequent' }
}

export function writeRecognizedSpeakerOrder(accountKey: string, order: RecognizedSpeakerOrder, storage = browserStorage()): void {
  try { storage?.setItem(preferenceKey(accountKey), order) }
  catch { /* Sorting still works when browser preference storage is unavailable. */ }
}

export interface SpeakerOrderValue { key: string; name: string; dayCount?: number | undefined; lastSeenAt?: number | undefined }

function positiveNumber(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : 0
}

/** Missing statistics sort last. Ties remain stable across refreshes and filters. */
export function compareRecognizedSpeakers(left: SpeakerOrderValue, right: SpeakerOrderValue, order: RecognizedSpeakerOrder): number {
  const leftDays = positiveNumber(left.dayCount), rightDays = positiveNumber(right.dayCount)
  const leftTime = positiveNumber(left.lastSeenAt), rightTime = positiveNumber(right.lastSeenAt)
  return (order === 'frequent'
    ? rightDays - leftDays || rightTime - leftTime
    : rightTime - leftTime || rightDays - leftDays)
    || left.name.localeCompare(right.name, undefined, { numeric: true })
    || left.key.localeCompare(right.key)
}

export interface SpeakerCandidateSnapshot {
  items: UnmarkedSpeakerRow[]
  complete: boolean
  projectionState: ArkmeDirectoryPage['projectionState']
}

/** The upstream cursor has a fixed order. Read metadata pages before claiming global order.
 * Bound reads to the host's 2,000-candidate reference budget; never silently call a partial
 * traversal complete. No audio or per-speaker detail is loaded here.
 */
export async function loadSpeakerCandidateSnapshot(
  loadPage: (cursor: string, signal: AbortSignal) => Promise<ArkmeDirectoryPage>,
  signal: AbortSignal,
  onProgress: (snapshot: SpeakerCandidateSnapshot) => void,
): Promise<SpeakerCandidateSnapshot> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const rows = new Map<string, UnmarkedSpeakerRow>()
    const cursors = new Set<string>()
    let cursor = ''
    let snapshot: SpeakerCandidateSnapshot = { items: [], complete: false, projectionState: undefined }
    for (let pageIndex = 0; pageIndex < 40; pageIndex += 1) {
      signal.throwIfAborted()
      const page = await loadPage(cursor, signal)
      signal.throwIfAborted()
      if (page.section !== 'unmarked-speakers') throw new Error('未标记说话人列表响应无效')
      if (page.cursorStale) {
        // Do not mix two projection versions. Restart once, then expose an incomplete state.
        snapshot = { items: [], complete: false, projectionState: 'stale' }
        onProgress(snapshot)
        if (attempt === 0) break
        return snapshot
      }
      for (const item of page.items) if (item.kind === 'unmarked-speaker' && rows.size < 2_000) rows.set(item.candidateRef, item)
      snapshot = {
        items: [...rows.values()],
        complete: !page.hasMore && page.coverage !== 'partial' && (page.projectionState === undefined || page.projectionState === 'fresh'),
        projectionState: page.projectionState,
      }
      onProgress(snapshot)
      if (!page.hasMore || rows.size >= 2_000 || (page.projectionState !== undefined && page.projectionState !== 'fresh')) return snapshot
      const next = page.nextCursor ?? ''
      if (next === '' || cursors.has(next)) return snapshot
      cursors.add(next)
      cursor = next
      if (pageIndex === 39) return snapshot
    }
  }
  return { items: [], complete: false, projectionState: 'stale' }
}
