import type { CSSProperties } from 'react'
import type { ArkmeCallHistoryItem } from '../types.js'
import { tr, useArkmeLocale } from './locale.js'
import { useCallRecordPreview } from './use-call-record-preview.js'

/** Resolve only visible rows whose aggregate cannot render its speaker template. */
export function ArkmeCallHistorySummary({ item, style, textStyle }: {
  item: ArkmeCallHistoryItem
  style?: CSSProperties | undefined
  textStyle?: CSSProperties | undefined
}) {
  useArkmeLocale()
  const { element, detail, failed } = useCallRecordPreview<HTMLSpanElement>(
    item.summaryNeedsDetail ? item.callRef : undefined, item.summaryUpdatedAtMillis)
  const status = detail?.summaryStatus ?? item.summaryStatus
  const text = detail?.summaryText?.trim() ?? (item.summaryNeedsDetail ? '' : item.summaryPreview?.trim())
  const summary = item.summaryNeedsDetail && !detail
    ? failed ? tr('摘要暂不可用，点击查看详情') : tr('摘要加载中…')
    : status === 'pending' ? tr('摘要生成中…')
      : status === 'failed' ? tr('摘要生成失败，点击查看详情')
        : status === 'done' && text ? tr('AI 摘要：{v0}', { v0: text }) : ''
  if (!summary) return null
  return <span ref={element} style={style} data-arkme-call-summary="true">
    <span style={{ ...textStyle, ...(status === 'done' && text ? {} : { WebkitLineClamp: 1 }) }}>{summary}</span>
  </span>
}
