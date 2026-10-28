import type { ArkmeRecordingComparison } from '../../types.js'
import { callArkme } from '../api.js'

export interface PreparedRecordingComparison {
  data: ArkmeRecordingComparison
  pending: boolean
  notice: string
}

/** Viewing never starts processing. The result view owns the explicit start action. */
export async function prepareRecordingTranscriptComparison(dateStamp: number, signal: AbortSignal): Promise<PreparedRecordingComparison> {
  const data = await callArkme<ArkmeRecordingComparison>('recordings.compare', { dateStamp }, signal)
  signal.throwIfAborted()
  return { data, pending: data.doubao.processingCount > 0, notice: '' }
}
