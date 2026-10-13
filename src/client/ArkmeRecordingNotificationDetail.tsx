import type { RecordingWorkflowNotice, RecordingWorkflowState } from '../recording-workflow-contract.js'
import { arkmeTheme } from './arkme-theme.js'
import { tr } from './locale.js'
import { arkmeUi } from './ui-controller.js'

export function recordingNoticeTitle(item: RecordingWorkflowNotice) {
  if (item.state === 'expired') return tr('录音自动整理已到期')
  if (item.state === 'skipped') return tr('录音暂无可整理内容')
  if (item.stage === 'processing') return item.state === 'completed' ? tr('录音处理完成') : tr('录音处理未全部完成')
  return item.state === 'completed' ? tr('录音总结与时间轴已更新') : tr('录音整理未全部完成')
}
export function recordingNoticePreview(item: RecordingWorkflowNotice) {
  if (item.state === 'expired') return tr('已有录音和整理结果仍保留，可按日期查看或手动整理。')
  return item.stage === 'processing'
    ? tr('本次 {total} 个文件，已完成 {completed} 个。', { total: item.fileCount, completed: item.completedCount })
    : tr('涉及 {count} 个录音日期。', { count: item.days.length })
}
function stateLabel(state: RecordingWorkflowState | 'pending') {
  return state === 'expired' ? tr('自动整理已到期') : state === 'pending' ? tr('等待处理') : state === 'completed' ? tr('已更新') : state === 'partial' ? tr('部分完成') : state === 'skipped' ? tr('无可用内容') : tr('生成失败')
}
export function ArkmeRecordingNotificationDetail({ notice, onClose }: { notice: RecordingWorkflowNotice; onClose(): void }) {
  const button = { border: `1px solid ${arkmeTheme.border}`, borderRadius: 8, padding: '6px 10px', background: 'transparent', color: arkmeTheme.text, cursor: 'pointer', font: 'inherit', fontSize: 12 }
  return <section aria-label={recordingNoticeTitle(notice)} style={{ padding: 20, overflowY: 'auto' }}>
    <button type="button" style={button} onClick={onClose}>{tr('返回通知')}</button>
    <h3>{recordingNoticeTitle(notice)}</h3>
    <p>{recordingNoticePreview(notice)}</p>
    {notice.message && <p style={{ color: arkmeTheme.secondary, whiteSpace: 'pre-wrap' }}>{notice.message}</p>}
    {notice.stage === 'processing' && notice.state === 'completed' && <p style={{ color: arkmeTheme.secondary }}>{tr('本批录音已完成处理，自动整理结果请查看后续通知。')}</p>}
    {notice.days.map(day => {
      const dateStamp = day.dateStamp
      const window = { dateStamp, endStamp: day.endStamp, timeZone: notice.timeZone, date: day.date }
      return <article key={day.date} style={{ borderTop: `1px solid ${arkmeTheme.border}`, padding: '14px 0' }}>
        <strong>{day.date}</strong>
        {notice.stage === 'analysis' && <p style={{ color: arkmeTheme.secondary, fontSize: 12 }}>{tr('总结')} · {stateLabel(day.summary.state)}　{tr('时间轴')} · {stateLabel(day.timeline.state)}</p>}
        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          <button type="button" style={button} onClick={() => arkmeUi.showRecordingTarget(dateStamp, dateStamp, undefined, window)}>{tr('查看录音')}</button>
          {notice.stage === 'analysis' && day.summary.state === 'completed' && <button type="button" style={button} onClick={() => arkmeUi.showRecordingSummaryTarget(dateStamp, day.summary.versionId, window)}>{tr('查看总结')}</button>}
          {notice.stage === 'analysis' && day.timeline.state === 'completed' && <button type="button" style={button} onClick={() => arkmeUi.showRecordingTimelineTarget(dateStamp, day.timeline.versionId, window)}>{tr('查看时间轴')}</button>}
        </div>
      </article>
    })}
  </section>
}
