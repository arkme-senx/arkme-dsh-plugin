import type { RecordingTotalMetrics as Metrics, RecordingMetricState } from '../../recording-total-metrics.js'
import { arkmeTheme } from '../arkme-theme.js'
import { arkmeIntlLocale, tr, useArkmeLocale } from '../locale.js'
import { recordingBytesLabel, recordingInputDurationLabel } from './RecordingDailyMetrics.js'
import type { RecordingTotalsProgress } from './recording-total-scan.js'
import { useRecordingMonthTotals } from './use-recording-month-totals.js'

/** Statistics publish progressively without rendering the reading pane again. */
export function RecordingTotalMetricsLoader({ account, active, refreshRevision, monthStamp }: { account: string; active: boolean; refreshRevision: string; monthStamp: number }) {
  const totals = useRecordingMonthTotals(account, monthStamp, active, refreshRevision)
  return <RecordingTotalMetrics monthStamp={monthStamp} metrics={totals.progress?.metrics} loading={!totals.progress || ['discovering', 'calculating'].includes(totals.progress.phase)}
    error={totals.progress?.phase === 'error'} progress={totals.progress} onRetry={totals.retry} />
}

function metricLabel(value: number | null | undefined, state: RecordingMetricState | undefined, format: (value: number) => string, estimated = false) {
  if (value == null) return tr(state === 'processing' ? '统计中' : '暂不可用')
  const label = format(value)
  return estimated ? tr(state === 'ready' ? '约{duration}（含估算）' : '约{duration}（部分，含估算）', { duration: label })
    : `${label}${state === 'ready' ? '' : tr('（已确认）')}`
}

export function RecordingTotalMetrics({ metrics, loading, error = false, progress, onRetry, monthStamp = Date.now() }: { metrics?: Metrics | undefined; loading: boolean; error?: boolean; progress?: RecordingTotalsProgress | undefined; onRetry?: (() => void) | undefined; monthStamp?: number }) {
  useArkmeLocale()
  const hint = tr('按当前月份每天详情中的云端录音存储和转写输入时长累加。转写输入包含已记录的系统模型重试，不包含豆包。')
  const updated = metrics ? `${tr('更新于')} ${new Intl.DateTimeFormat(arkmeIntlLocale(), { dateStyle: 'short', timeStyle: 'short' }).format(metrics.asOfMillis)}` : ''
  const labels = [
    [tr('云端录音存储'), metrics?.storage.bytes == null ? metricLabel(null, metrics?.storage.state, recordingBytesLabel) : recordingBytesLabel(metrics.storage.bytes) + tr(metrics.storage.state === 'ready' ? '（已记录）' : '（部分已记录）')],
    [tr('转写输入时长'), metrics?.asrInput.durationMillis == null && (metrics?.asrInput.missingHistoryCount ?? 0) > 0 ? tr('历史计量缺失') : metricLabel(metrics?.asrInput.durationMillis, metrics?.asrInput.state, recordingInputDurationLabel, metrics?.asrInput.estimated)],
  ]
  return <section aria-label={tr('当月录音累计')} aria-busy={loading} title={[hint, updated, progress?.error].filter(Boolean).join('\n')}
    style={{ marginTop: 16, padding: '0 8px 12px', color: arkmeTheme.secondary, fontSize: 12, lineHeight: '20px' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
      <span>{tr('当月录音累计')}</span>
      <span>{new Intl.DateTimeFormat(arkmeIntlLocale(), { year: 'numeric', month: 'long' }).format(monthStamp)}</span>
    </div>
    <div style={{ marginBottom: 4 }}>
      {loading ? <span role="status">{progress ? tr('统计中 · {done}/{total} 天', { done: progress.completedDays, total: progress.totalDays }) : tr('正在读取当月统计…')}</span>
        : error && <span style={{ color: arkmeTheme.tertiary }}>{tr(progress ? '部分统计，稍后自动重试' : metrics ? '更新失败，显示上次统计' : '统计读取失败')}
          {onRetry && <button type="button" onClick={onRetry} style={{ border: 0, background: 'transparent', color: arkmeTheme.accent, font: 'inherit', cursor: 'pointer', padding: '0 0 0 6px' }}>{tr('重试')}</button>}</span>}
      {progress?.phase === 'complete' && (metrics?.storage.state === 'processing' || metrics?.asrInput.state === 'processing')
        ? <span>{tr('处理中，统计待更新')}</span>
        : progress?.phase === 'complete' && (metrics?.storage.state !== 'ready' || metrics?.asrInput.state !== 'ready')
          ? <span>{tr('部分历史数据缺少计量记录')}</span> : null}
    </div>
    <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto minmax(0,1fr)', gap: '2px 12px' }}>
      {labels.map(([label, value], index) => <div key={label} style={{ display: 'contents' }}><dt>{label}</dt>
        <dd style={{ margin: 0, textAlign: 'right', overflowWrap: 'anywhere', fontVariantNumeric: 'tabular-nums', color: arkmeTheme.text }}>{loading && (index === 0 ? metrics?.storage.bytes == null : metrics?.asrInput.durationMillis == null) ? '—' : value}</dd></div>)}
    </dl>
  </section>
}
