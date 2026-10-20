import type { ArkmeRecordingDailyMetrics } from '../../types.js'
import type { ReactNode } from 'react'
import { arkmeTheme } from '../arkme-theme.js'
import { arkmeIntlLocale, tr, useArkmeLocale } from '../locale.js'

export function recordingBytesLabel(bytes: number): string {
  const unit = bytes < 1024 ? 0 : Math.min(5,Math.floor(Math.log(bytes)/Math.log(1024)))
  return `${new Intl.NumberFormat(arkmeIntlLocale(),{maximumFractionDigits:unit === 0 ? 0 : 1}).format(bytes / 1024 ** unit)} ${['B','KiB','MiB','GiB','TiB','PiB'][unit]}`
}

export function recordingStorageDetails(storage?: { archiveBytes: number; clipBytes: number }) {
  return [storage && tr('VAD 人声主档 {size}', { size: recordingBytesLabel(storage.archiveBytes) }),
    storage && tr('转写播放切片 {size}', { size: recordingBytesLabel(storage.clipBytes) }),
    tr('按你的上传账号统计所有说话人的音频。当前合计为已记录的主档和播放切片大小；原件是否仍保留、对象是否已清理，需云端核对。跨日文件不按时长分摊，累计只计一次。')].filter(Boolean).join('\n')
}

export function recordingInputDurationLabel(millis: number): string {
  if (millis > 0 && millis < 1_000) return tr('不足1秒')
  const seconds = Math.floor(millis / 1_000)
  if (seconds < 60) return tr('{seconds}秒', { seconds })
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return tr('{minutes}分{seconds}秒', { minutes, seconds: seconds % 60 })
  return tr('{hours}小时{minutes}分{seconds}秒', { hours: Math.floor(minutes / 60), minutes: minutes % 60, seconds: seconds % 60 })
}

export function RecordingDailyMetrics({metrics,loading=false,localPending=false,children}:{metrics?:ArkmeRecordingDailyMetrics | undefined;loading?:boolean;localPending?:boolean;children?:ReactNode}) {
  useArkmeLocale()
  const storage = metrics?.storage
  const incomplete = storage?.state !== 'ready' || localPending
  const bytes = !storage || storage.confirmedCount === 0 && incomplete ? tr(storage?.pendingCount ? '统计中' : '暂不可用')
    : `${recordingBytesLabel(storage.bytes)}${tr(incomplete ? '（部分已记录）' : '（已记录）')}`
  const inputIncomplete = metrics?.asrInputState !== 'ready' || localPending
  // Older hosts can omit the newly added input fields while clients update.
  const durationValue = recordingInputDurationLabel(metrics?.asrInputDurationMillis ?? 0)
  const duration = !metrics || metrics.asrInputState === undefined || (metrics.asrInputConfirmedCount === 0 && inputIncomplete)
    ? tr((metrics?.asrInputPendingCount ?? 0) > 0 ? '统计中' : (metrics?.asrInputMissingHistoryCount ?? 0) > 0 ? '历史计量缺失' : '暂不可用') : (metrics.asrInputEstimatedCount ?? 0) > 0
      ? tr(inputIncomplete ? '约{duration}（部分，含估算）' : '约{duration}（含估算）', { duration: durationValue })
      : `${durationValue}${inputIncomplete ? tr('（已确认）') : ''}`
  return <div aria-label={tr('当天录音统计')} style={{display:'flex',alignItems:'center',flexWrap:'wrap',gap:'4px 12px',fontSize:11,lineHeight:'18px',color:arkmeTheme.secondary}}
    >
    <span tabIndex={0} title={loading ? undefined : recordingStorageDetails(storage)}>{tr('云端录音存储 {size}',{size:loading ? '—' : bytes})}</span>
    <span>{tr('转写 {count} 字',{count:loading || !metrics ? '—' : new Intl.NumberFormat(arkmeIntlLocale()).format(metrics.textCount)})}</span>
    <span tabIndex={0} title={tr('统计你上传的录音实际送入系统转写模型的音频，包含输入窗口中的静音和已记录重试，不包含豆包。历史计量缺失表示转写可能已完成，但当时没有留下可用的输入时长记录；需要云端补齐，不按文字或录音总时长冒充实测值。')} style={{whiteSpace:'nowrap'}}>{tr('转写输入时长 {duration}',{duration:loading ? '—' : duration})}</span>
    {children}
    {!loading && ((storage?.pendingCount ?? 0) > 0 || (metrics?.asrInputPendingCount ?? 0) > 0 || localPending) && <span>{tr('处理中，统计待更新')}</span>}
    {!loading && (storage?.unknownCount ?? 0) > 0 && <span>{tr('部分大小暂不可确认')}</span>}
    {!loading && (metrics?.asrInputUnknownCount ?? 0) > 0 && (metrics?.asrInputConfirmedCount ?? 0) > 0 && <span>{tr((metrics?.asrInputMissingHistoryCount ?? 0) > 0 ? '部分历史计量缺失' : '部分转写输入时长暂不可确认')}</span>}
  </div>
}
