import type { RecordingWorkflowNotice, RecordingWorkflowState } from '../recording-workflow-contract.js'
import { arkmeTheme } from './arkme-theme.js'
import { tr } from './locale.js'
import { arkmeUi } from './ui-controller.js'

export function recordingNoticeTitle(item: RecordingWorkflowNotice) {
  if (item.stage === 'processing') return item.state === 'completed' ? tr('录音处理完成') : tr('录音处理未全部完成')
  return item.state === 'completed' ? tr('录音总结与时间轴已更新') : item.state === 'skipped' ? tr('录音暂无可整理内容') : tr('录音整理未全部完成')
}
export function recordingNoticePreview(item: RecordingWorkflowNotice) {
  return item.stage === 'processing'
    ? tr('本次 {total} 个文件，已完成 {completed} 个。', { total: item.fileCount, completed: item.completedCount })
    : tr('涉及 {count} 个录音日期。', { count: item.days.length })
}
function stateLabel(state: RecordingWorkflowState | 'pending') {
  return state === 'pending' ? tr('等待处理') : state === 'completed' ? tr('已更新') : state === 'partial' ? tr('部分完成') : state === 'skipped' ? tr('无可用内容') : tr('未完成')
}
export function ArkmeRecordingNotificationDetail({ notice, onClose }: { notice: RecordingWorkflowNotice; onClose(): void }) {
  const button = { border: `1px solid ${arkmeTheme.border}`, borderRadius: 8, padding: '6px 10px', background: 'transparent', color: arkmeTheme.text, cursor: 'pointer', font: 'inherit', fontSize: 12 }
  return <section aria-label={recordingNoticeTitle(notice)} style={{ padding: 20, overflowY: 'auto' }}>
    <button type="button" style={button} onClick={onClose}>{tr('返回通知')}</button>
    <h3>{recordingNoticeTitle(notice)}</h3>
    <p>{recordingNoticePreview(notice)}</p>
    {notice.message && <p style={{ color: arkmeTheme.secondary, whiteSpace: 'pre-wrap' }}>{notice.message}</p>}
    {notice.stage === 'processing' && notice.state === 'completed' && <p style={{ color: arkmeTheme.secondary }}>{tr('对应日期的总结和时间轴正在自动整理，完成后会再次通知。')}</p>}
    {notice.days.map(day => {
      const [year, month, date] = day.date.split('-').map(Number)
      const dateStamp = new Date(year!, month! - 1, date!).getTime()
      return <article key={day.date} style={{ borderTop: `1px solid ${arkmeTheme.border}`, padding: '14px 0' }}>
        <strong>{day.date}</strong>
        {notice.stage === 'analysis' && <p style={{ color: arkmeTheme.secondary, fontSize: 12 }}>{tr('总结')} · {stateLabel(day.summary.state)}　{tr('时间轴')} · {stateLabel(day.timeline.state)}</p>}
        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          <button type="button" style={button} onClick={() => arkmeUi.showRecordingTarget(dateStamp, dateStamp)}>{tr('查看录音')}</button>
          {notice.stage === 'analysis' && day.summary.state === 'completed' && <button type="button" style={button} onClick={() => arkmeUi.showRecordingSummaryTarget(dateStamp, day.summary.versionId)}>{tr('查看总结')}</button>}
          {notice.stage === 'analysis' && day.timeline.state === 'completed' && <button type="button" style={button} onClick={() => arkmeUi.showRecordingTimelineTarget(dateStamp, day.timeline.versionId)}>{tr('查看时间轴')}</button>}
        </div>
      </article>
    })}
  </section>
}
