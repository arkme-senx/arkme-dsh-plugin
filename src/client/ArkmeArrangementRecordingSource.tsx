import type { ArkmeArrangementRecordingSource as RecordingSource } from '../types.js'
import { recordingSourceLocalDate } from '../arrangement-recording-source.js'
import { isRecordingLocalDateOnOrAfterMinimum } from '../recording-time.js'
import { arkmeIntlLocale, tr } from './locale.js'
import { arkmeUi } from './ui-controller.js'

export function ArkmeArrangementRecordingSource({ source, onNavigate }: { source?: RecordingSource | undefined; onNavigate?(): void }) {
  if (!source) return null
  const date = source.state === 'ready' ? recordingSourceLocalDate(source) : undefined
  if (source.state !== 'ready' || !date || !isRecordingLocalDateOnOrAfterMinimum(date.getTime())) return <div className="arkme-arrangement-recording-unavailable">{tr('来自录音 · 来源暂不可定位')}</div>
  const label = date.toLocaleDateString(arkmeIntlLocale(), { year: 'numeric', month: 'long', day: 'numeric' })
  return <button type="button" className="arkme-arrangement-recording-source" title={tr('查看来源录音总结')}
    onClick={event => { event.stopPropagation(); onNavigate?.(); arkmeUi.showRecordingSummaryTarget(date.getTime(), source.summaryVersionId) }}>
    {tr('来源：{date}录音', { date: label })} <span aria-hidden>↗</span>
  </button>
}
