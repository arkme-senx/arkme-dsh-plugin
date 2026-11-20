import type { ArkmeRecordingWorkbenchItem } from '../../types.js'

export type TranscriptHistoryVersion = { versionRef: string; createdAtMillis: number; items: ArkmeRecordingWorkbenchItem[] }
export type TranscriptHistoryPeriod = { id: string; startAtMillis: number; endAtMillis: number; versions: TranscriptHistoryVersion[] }
const minute = 60_000

// Enrichment (speaker names, IDs, playback availability) can differ between live
// and frozen rows without a transcription change. Compare text, timing and coverage.
function signature(items: ArkmeRecordingWorkbenchItem[]) {
  return JSON.stringify(items.map(item => [item.startAtMillis, item.endAtMillis, item.text,
    item.activeRanges ?? [{ startAtMillis: item.startAtMillis, endAtMillis: item.endAtMillis }],
  ]))
}

/** Connected minute intervals keep overlapping recordings and long utterances
 * together. Never infer word-level cuts from audio timestamps. */
export function buildTranscriptHistoryPeriods(current: ArkmeRecordingWorkbenchItem[], history: TranscriptHistoryVersion[]): TranscriptHistoryPeriod[] {
  const versions = [{ versionRef: '', createdAtMillis: 0, items: current }, ...history]
  const intervals = versions.flatMap((version, versionIndex) => version.items.map(item => ({
    item, versionIndex,
    start: Math.floor(item.startAtMillis / minute) * minute,
    end: Math.max(Math.floor(item.startAtMillis / minute) * minute + minute, Math.ceil(item.endAtMillis / minute) * minute),
  }))).sort((a, b) => a.start - b.start || a.end - b.end)
  const ranges: Array<{ start: number; end: number; buckets: Map<number, ArkmeRecordingWorkbenchItem[]> }> = []
  for (const interval of intervals) {
    const previous = ranges.at(-1)
    const range = previous && interval.start < previous.end ? previous : { start: interval.start, end: interval.end, buckets: new Map<number, ArkmeRecordingWorkbenchItem[]>() }
    if (range !== previous) ranges.push(range)
    range.end = Math.max(range.end, interval.end)
    const bucket = range.buckets.get(interval.versionIndex) ?? []
    bucket.push(interval.item)
    range.buckets.set(interval.versionIndex, bucket)
  }
  return ranges.map(range => {
    const seen = new Set<string>()
    const newerBodies: Map<string, number>[] = []
    const choices = versions.flatMap((version, index) => {
      const items = (range.buckets.get(index) ?? [])
        .sort((a, b) => a.startAtMillis - b.startAtMillis || a.endAtMillis - b.endAtMillis || a.text.localeCompare(b.text))
      // A snapshot predating an incremental upload is not a historical text.
      if (index !== 0 && !items.length) return []
      const bodies = new Map<string, number>()
      for (const item of items) { const body = signature([item]); bodies.set(body, (bodies.get(body) ?? 0) + 1) }
      if (index !== 0 && newerBodies.some(newer => [...bodies].every(([body, count]) => (newer.get(body) ?? 0) >= count))) return []
      const key = signature(items)
      if (seen.has(key)) return []
      seen.add(key)
      newerBodies.push(bodies)
      return [{ ...version, items }]
    })
    return { id: String(range.start), startAtMillis: range.start, endAtMillis: range.end, versions: choices }
  })
}
