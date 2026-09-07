import type { RecordingForwardReceipt } from '../../recording-forward-contract.js'
import type { ArkmeRecordingWorkbenchItem } from '../../types.js'
import { callArkme } from '../api.js'
import { RecordingForwardAttempt, type RecordingForwardSender } from './recording-forward-attempt.js'

export const recordingForwardClient: RecordingForwardSender = {
  async forward(input, signal) {
    signal.throwIfAborted()
    const request = new AbortController()
    const abort = () => { request.abort() }
    signal.addEventListener('abort', abort, { once: true })
    const timeout = setTimeout(abort, 30_000)
    try {
      const receipt = await callArkme<RecordingForwardReceipt>('recordings.forward', { ...input }, request.signal)
      if (typeof receipt?.recordUid !== 'string' || receipt.recordUid.trim() === '') throw new Error('转发结果未确认，请重试确认')
      return receipt
    } finally {
      clearTimeout(timeout)
      signal.removeEventListener('abort', abort)
    }
  },
}

export function createRecordingForwardAttempt(items: readonly ArkmeRecordingWorkbenchItem[]): RecordingForwardAttempt {
  return new RecordingForwardAttempt(items, recordingForwardClient)
}
