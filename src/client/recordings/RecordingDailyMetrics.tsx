import type { ArkmeRecordingDailyMetrics } from '../../types.js'
import { arkmeTheme } from '../arkme-theme.js'
import { arkmeIntlLocale, tr, useArkmeLocale } from '../locale.js'

function bytesLabel(bytes: number): string {
  const unit = bytes < 1024 ? 0 : Math.min(3,Math.floor(Math.log(bytes)/Math.log(1024)))
  return `${new Intl.NumberFormat(arkmeIntlLocale(),{maximumFractionDigits:unit === 0 ? 0 : 1}).format(bytes / 1024 ** unit)} ${['B','KB','MB','GB'][unit]}`
}

export function RecordingDailyMetrics({metrics,loading=false,localPending=false}:{metrics?:ArkmeRecordingDailyMetrics | undefined;loading?:boolean;localPending?:boolean}) {
  useArkmeLocale()
  const incomplete = metrics?.archiveState !== 'ready' || localPending
  const bytes = !metrics || metrics.confirmedCount === 0 && incomplete ? tr('暂不可用')
    : `${bytesLabel(metrics.archiveBytes)}${incomplete ? tr('（已确认）') : ''}`
  return <div aria-label={tr('当天录音统计')} style={{display:'flex',alignItems:'center',flexWrap:'wrap',gap:'4px 12px',fontSize:11,lineHeight:'18px',color:arkmeTheme.secondary}}
    title={tr('人声存储仅统计归属于本人的录音，不包含原始文件或转写切片，跨日主档不估算分摊；字数按当天最终转写去除空白后计算。')}>
    <span>{tr('人声存储 {size}',{size:loading ? '—' : bytes})}</span>
    <span>{tr('转写 {count} 字',{count:loading || !metrics ? '—' : new Intl.NumberFormat(arkmeIntlLocale()).format(metrics.textCount)})}</span>
    {!loading && ((metrics?.pendingCount ?? 0) > 0 || localPending) && <span>{tr('处理中，统计待更新')}</span>}
    {!loading && (metrics?.unknownCount ?? 0) > 0 && <span>{tr('部分大小暂不可确认')}</span>}
  </div>
}
