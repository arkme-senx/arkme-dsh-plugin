import { recordingStrategy, type RecordingProcessingPreference } from '../../recording-strategy-contract.js'
import { callArkme } from '../api.js'

/** Always read the account owner at submission; a UI cache cannot choose a job. */
export async function readRecordingProcessingPreference(userId: number, signal?: AbortSignal): Promise<RecordingProcessingPreference> {
  const value = await callArkme<RecordingProcessingPreference>('recordings.strategies', { action: 'preference', expectedUserId: userId }, signal)
  if (!value || value.userId !== userId || !value.strategy) throw new Error('无法确认当前账号的录音处理设置，请重试')
  return { userId, strategy: recordingStrategy(value.strategy) }
}
