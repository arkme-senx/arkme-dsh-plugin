import { useEffect, useSyncExternalStore } from 'react'
import type { ArkmeRecordingCoverageInterval } from '../../types.js'
import { clipRecordingCoverage } from '../../recording-coverage.js'
import { directRecordingStore, type DirectRecordingSnapshot } from './direct-recording-store.js'

export function localRecordingCoverage(snapshot: DirectRecordingSnapshot, accountKey: string | undefined, dayStart: number): ArkmeRecordingCoverageInterval[] {
  if (!accountKey || snapshot.accountKey !== accountKey) return []
  const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1)
  const ranges: ArkmeRecordingCoverageInterval[] = []
  for (const [records, status] of [[snapshot.pending, 'local'], [snapshot.submitted ?? [], 'submitted']] as const) {
    for (const record of records) {
      if (record.accountKey !== accountKey) continue
      const duration = record.bytes / (record.sampleRate * 2) * 1000
      ranges.push({ startAtMillis: record.startedAt, endAtMillis: record.startedAt + duration, sourceLabel: '本机直接录音', status })
    }
  }
  if ((snapshot.phase === 'recording' || snapshot.phase === 'saving') && snapshot.elapsedMillis > 0) {
    ranges.push({ startAtMillis: snapshot.startedAt, endAtMillis: snapshot.startedAt + snapshot.elapsedMillis,
      sourceLabel: '本机直接录音', status: snapshot.phase === 'recording' ? 'recording' : 'local' })
  }
  return ranges.flatMap(range => { const clipped = clipRecordingCoverage(range, dayStart, dayEnd.getTime()); return clipped ? [clipped] : [] })
}

export function useLocalRecordingCoverage(accountKey: string | undefined, dayStart: number, cloud: readonly ArkmeRecordingCoverageInterval[] | undefined) {
  const snapshot = useSyncExternalStore(directRecordingStore.subscribe, directRecordingStore.getSnapshot, directRecordingStore.getSnapshot)
  useEffect(() => { if (accountKey && cloud) directRecordingStore.confirmSubmittedCoverage(accountKey, cloud) }, [accountKey, cloud])
  return localRecordingCoverage(snapshot, accountKey, dayStart)
}

export const coverageStatusLabel: Record<ArkmeRecordingCoverageInterval['status'], string> = {
  saved: '已同步', processing: '识别中', local: '已录制 · 保存在本机', submitted: '已提交 · 等待同步', recording: '正在录音',
}
