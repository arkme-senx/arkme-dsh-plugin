import type { RecordingDelivery } from '../../recording-delivery.js'
import { tr } from '../locale.js'

/** Keep partial media measurements in the contract, not in the total-duration
 * column. The existing task status explains synchronization/processing/failure. */
export function recordingAudioDurationLabel(fallbackMillis: number | null, delivery?: RecordingDelivery): string {
  const value = delivery ? (delivery.durationFinal ? delivery.audioDurationMs : null) : fallbackMillis
  if (value === null) return '—'
  if (value > 0 && value < 1000) return `${String(value)}ms`
  const seconds = Math.floor(Math.max(0, value) / 1000)
  if (seconds < 60) return tr('{v0}秒', { v0: seconds })
  const minutes = Math.floor(seconds / 60)
  return seconds % 60 === 0 ? tr('{v0}分钟', { v0: minutes }) : tr('{v0}分{v1}秒', { v0: minutes, v1: seconds % 60 })
}
