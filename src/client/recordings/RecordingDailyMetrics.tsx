import type { ArkmeRecordingDailyMetrics } from '../../types.js'
import { arkmeTheme } from '../arkme-theme.js'
import { arkmeIntlLocale, tr, useArkmeLocale } from '../locale.js'

function bytesLabel(bytes: number): string {
  const unit = bytes < 1024 ? 0 : Math.min(3,Math.floor(Math.log(bytes)/Math.log(1024)))
  return `${new Intl.NumberFormat(arkmeIntlLocale(),{maximumFractionDigits:unit === 0 ? 0 : 1}).format(bytes / 1024 ** unit)} ${['B','KB','MB','GB'][unit]}`
}

function inputDurationLabel(millis: number): string {
  if (millis > 0 && millis < 1_000) return tr('不足1秒')
  const seconds = Math.floor(millis / 1_000)
  if (seconds < 60) return tr('{seconds}秒', { seconds })
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return tr('{minutes}分{seconds}秒', { minutes, seconds: seconds % 60 })
  return tr('{hours}小时{minutes}分{seconds}秒', { hours: Math.floor(minutes / 60), minutes: minutes % 60, seconds: seconds % 60 })
}

export function RecordingDailyMetrics({metrics,loading=false,localPending=false}:{metrics?:ArkmeRecordingDailyMetrics | undefined;loading?:boolean;localPending?:boolean}) {
  useArkmeLocale()
  const incomplete = metrics?.archiveState !== 'ready' || localPending
  const bytes = !metrics || metrics.confirmedCount === 0 && incomplete ? tr('暂不可用')
    : `${bytesLabel(metrics.archiveBytes)}${incomplete ? tr('（已确认）') : ''}`
  const inputIncomplete = metrics?.asrInputState !== 'ready' || localPending
  // Older hosts can omit the newly added input fields while clients update.
  const durationValue = inputDurationLabel(metrics?.asrInputDurationMillis ?? 0)
  const duration = !metrics || metrics.asrInputState === undefined || (metrics.asrInputConfirmedCount === 0 && inputIncomplete)
    ? tr('暂不可用') : (metrics.asrInputEstimatedCount ?? 0) > 0
      ? tr(inputIncomplete ? '约{duration}（部分，含估算）' : '约{duration}（含估算）', { duration: durationValue })
      : `${durationValue}${inputIncomplete ? tr('（已确认）') : ''}`
  return <div aria-label={tr('当天录音统计')} style={{display:'flex',alignItems:'center',flexWrap:'wrap',gap:'4px 12px',fontSize:11,lineHeight:'18px',color:arkmeTheme.secondary}}
    title={tr('人声存储仅统计归属于本人的录音，不包含原始文件或转写切片，跨日主档不估算分摊；字数按当天最终转写去除空白后计算。') + '\n' + tr('转写输入时长统计归属于你的录音实际送入系统转写模型的音频，包含输入窗口中的静音，跨日按当天截取，已记录的重试分别累计。缺少可靠记录的历史输入时长暂不可用，不按录音时长或文字估算。此数值不是说话时长或 GPU 运行时长，也不包含豆包转写。')}>
    <span>{tr('人声存储 {size}',{size:loading ? '—' : bytes})}</span>
    <span>{tr('转写 {count} 字',{count:loading || !metrics ? '—' : new Intl.NumberFormat(arkmeIntlLocale()).format(metrics.textCount)})}</span>
    <span style={{whiteSpace:'nowrap'}}>{tr('转写输入时长 {duration}',{duration:loading ? '—' : duration})}</span>
    {!loading && ((metrics?.pendingCount ?? 0) > 0 || (metrics?.asrInputPendingCount ?? 0) > 0 || localPending) && <span>{tr('处理中，统计待更新')}</span>}
    {!loading && (metrics?.unknownCount ?? 0) > 0 && <span>{tr('部分大小暂不可确认')}</span>}
    {!loading && (metrics?.asrInputUnknownCount ?? 0) > 0 && <span>{tr('部分转写输入时长暂不可确认')}</span>}
  </div>
}
