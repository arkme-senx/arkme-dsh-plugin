import type { ArkmeRecordingComparison } from '../../types.js'
import { callArkme } from '../api.js'

export interface PreparedRecordingComparison {
  data: ArkmeRecordingComparison
  pending: boolean
  notice: string
}

/** Only open the comparison once Audio has results or has accepted work. */
export async function prepareRecordingTranscriptComparison(dateStamp: number, signal: AbortSignal): Promise<PreparedRecordingComparison> {
  const data = await callArkme<ArkmeRecordingComparison>('recordings.compare', { dateStamp }, signal)
  signal.throwIfAborted()
  const pending = data.doubao.processingCount > 0
  if (data.doubao.items.length > 0) return { data, pending, notice: '' }
  if (data.candidateCount === 0) {
    if (pending) return { data, pending, notice: '' }
    throw new Error('豆包转写暂无结果')
  }
  try {
    const result = await callArkme<{ queuedCount: number; inFlightCount: number; missingAudioCount: number }>('recordings.compare.start', { dateStamp }, signal)
    signal.throwIfAborted()
    const started = pending || result.queuedCount + result.inFlightCount > 0
    const notice = result.missingAudioCount > 0 ? '历史音频留存已过期，无法发起豆包转写' : ''
    if (!started) throw new Error(notice || '豆包转写暂无结果')
    return { data, pending: started, notice }
  } catch (reason) {
    if (signal.aborted) throw reason
    if (pending) return { data, pending, notice: '部分豆包转写未能发起，已有任务仍在处理' }
    throw reason
  }
}
