import { IconLoadingOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { arkmeTheme } from './arkme-theme.js'
import type { SelfCalendarNavigationStatus } from './use-self-calendar-navigation.js'

const actionStyle = { border: 0, borderRadius: 6, padding: '4px 8px', background: 'transparent',
  color: arkmeTheme.text, font: 'inherit', cursor: 'pointer', flexShrink: 0 } as const

export function ArkmeCalendarNavigationStatus({ status, onCancel, onRetry }: {
  status: SelfCalendarNavigationStatus
  onCancel(): void
  onRetry(): void
}) {
  const date = status.bucketDate.replace(/^(\d+)-(\d+)-(\d+)$/, '$1年$2月$3日')
  return <div data-arkme-calendar-navigation role="status" aria-live="polite" style={{
    display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
    margin: '8px 16px', padding: '10px 12px', borderRadius: 10,
    background: arkmeTheme.subtle, color: arkmeTheme.secondary, fontSize: 13,
  }}>
    {status.phase === 'loading' && <IconLoadingOutline16 className="arkme-icon-spin" />}
    <span style={{ flex: 1 }}>{status.phase === 'loading'
      ? `正在定位 ${date}…` : `${date}：${status.error ?? '定位失败'}`}</span>
    {status.phase === 'error' && <button type="button" style={actionStyle} data-arkme-feedback onClick={onRetry}>重试</button>}
    <button type="button" style={actionStyle} data-arkme-feedback onClick={onCancel}>{status.phase === 'error' ? '关闭' : '取消'}</button>
  </div>
}
