import type { RecordingStrategy } from '../../recording-strategy-contract.js'
import { comparisonSourceState, type DayComparisonSource } from './recording-comparison-day.js'
import type { SourcePage } from './useRecordingDayStrategyPages.js'

/** Read-only presentation of source-owned facts. Empty text is not failed
 * processing, and metadata completion does not mean its text has loaded yet. */
export function RecordingDayComparisonProgress({ sources, selection, pages }: {
  sources: DayComparisonSource[]; selection: RecordingStrategy | 'official'; pages: Map<string, SourcePage>
}) {
  const rows = sources.map(source => {
    const state = comparisonSourceState(source, selection), page = pages.get(source.sourceRef)
    if (source.error) return { source, status: 'error', text: source.error }
    if (state.failed || page?.failed) return { source, status: 'failed', text: '处理未全部成功，已完成内容保留' }
    if (state.processing) return { source, status: 'processing', text: '处理中，完成后自动更新' }
    if (!state.exists) return { source, status: 'missing', text: source.dayMembershipUnknown ? '录音时间范围尚未确认' : !source.options?.officialComplete ? '等待正式录音处理完成' : source.options.officialFailed ? '正式录音处理失败' : source.options.canStart && source.options.expiresAtMillis > Date.now() ? '尚未生成' : '尚未生成，原件已不可用于新的处理' }
    return { source, status: 'complete', text: page?.done && !page.items.length ? '已完成，无当天正文' : '已完成' }
  })
  const count = (status: string) => rows.filter(row => row.status === status).length
  const complete = count('complete'), processing = count('processing'), failed = count('failed'), errors = count('error'), missing = count('missing')
  if (!rows.length) return null
  return <div className="recording-day-progress">
    <div className="recording-day-progress-summary" role="status">
      <span>已完成 {complete} / {rows.length}</span>
      {processing > 0 && <span className="recording-day-status-badge" data-status="processing">处理中 {processing}</span>}
      {failed > 0 && <span className="recording-day-status-badge" data-status="failed">处理失败 {failed}</span>}
      {errors > 0 && <span className="recording-day-status-badge" data-status="failed">读取失败 {errors}</span>}
      {missing > 0 && <span className="recording-day-status-badge">未生成 {missing}</span>}
    </div>
    <details className="recording-day-progress-details">
      <summary>处理详情</summary>
      <div className="recording-day-progress-list">
        {rows.map(({ source, status, text }) => <div className="recording-day-progress-file" key={source.sourceRef}>
          <time>{new Date(source.startAtMillis).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' })}</time>
          <span className="recording-day-file-name" title={source.fileName}>{source.fileName || '录音'}</span>
          <span className="recording-day-file-status" data-status={status}>{text}</span>
        </div>)}
      </div>
    </details>
  </div>
}
