import type { ArkmeRecordingWorkbenchItem } from '../../types.js'

export function recordingComparisonPlaybackTarget(
  item: ArkmeRecordingWorkbenchItem,
  systemItems: readonly ArkmeRecordingWorkbenchItem[],
): ArkmeRecordingWorkbenchItem | undefined {
  if (item.transcriptSource === 'system') return item
  const candidates = systemItems.filter(candidate => candidate.sessionKey === item.sessionKey)
  const overlapping = candidates.find(candidate => candidate.startAtMillis <= item.startAtMillis && candidate.endAtMillis > item.startAtMillis)
  if (overlapping !== undefined) return overlapping
  let nearest: ArkmeRecordingWorkbenchItem | undefined
  let distance = 5_001
  for (const candidate of candidates) {
    const nextDistance = Math.min(Math.abs(candidate.startAtMillis - item.startAtMillis), Math.abs(candidate.endAtMillis - item.startAtMillis))
    if (nextDistance < distance) { nearest = candidate; distance = nextDistance }
  }
  return nearest
}
