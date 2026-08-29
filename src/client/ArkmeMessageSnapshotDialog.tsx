import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { BatteryHighIcon as BatteryHigh } from '@phosphor-icons/react/dist/csr/BatteryHigh'
import { CalendarBlankIcon as CalendarBlank } from '@phosphor-icons/react/dist/csr/CalendarBlank'
import { CloudIcon as Cloud } from '@phosphor-icons/react/dist/csr/Cloud'
import { CloudArrowUpIcon as CloudArrowUp } from '@phosphor-icons/react/dist/csr/CloudArrowUp'
import { ClockIcon as Clock } from '@phosphor-icons/react/dist/csr/Clock'
import { DesktopIcon as Desktop } from '@phosphor-icons/react/dist/csr/Desktop'
import { EarIcon as Ear } from '@phosphor-icons/react/dist/csr/Ear'
import { GlobeIcon as Globe } from '@phosphor-icons/react/dist/csr/Globe'
import { MapPinIcon as MapPin } from '@phosphor-icons/react/dist/csr/MapPin'
import { MountainsIcon as Mountains } from '@phosphor-icons/react/dist/csr/Mountains'
import { PersonSimpleWalkIcon as PersonSimpleWalk } from '@phosphor-icons/react/dist/csr/PersonSimpleWalk'
import { XIcon as X } from '@phosphor-icons/react/dist/csr/X'
import type { ArkmeMessageSnapshotDetail, ArkmeTimelineItem } from '../types.js'
import { arkmeTheme } from './arkme-theme.js'

const styles = {
  backdrop: { position: 'fixed', inset: 0, zIndex: 10_200, display: 'grid', placeItems: 'center', padding: 24, boxSizing: 'border-box', background: 'rgba(18, 20, 24, .36)', backdropFilter: 'blur(2px)', WebkitBackdropFilter: 'blur(2px)' },
  dialog: { position: 'relative', width: 'min(420px, 100%)', maxHeight: '86vh', overflow: 'auto', border: `1px solid ${arkmeTheme.borderSoft}`, borderRadius: 12, background: arkmeTheme.base, color: arkmeTheme.text, boxShadow: '0 22px 64px rgba(20, 23, 31, .22)' },
  body: { padding: '28px 16px 20px' },
  close: { position: 'absolute', top: 10, right: 10, width: 32, height: 32, display: 'grid', placeItems: 'center', padding: 0, border: 0, borderRadius: 8, background: 'transparent', color: arkmeTheme.text, cursor: 'pointer' },
  preview: { minHeight: 28, margin: 0, paddingRight: 32, overflow: 'hidden', color: arkmeTheme.text, fontSize: 16, lineHeight: '25px', fontWeight: 600, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' },
  stats: { display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10, marginTop: 18 },
  stat: { minHeight: 74, display: 'grid', alignContent: 'center', justifyItems: 'center', gap: 4, borderRadius: 12, background: '#f5f5f5' },
  statLabel: { color: '#a6a6a8', fontSize: 12, lineHeight: '18px' },
  statValue: { color: '#222326', fontSize: 17, lineHeight: '22px', fontWeight: 650, fontVariantNumeric: 'tabular-nums' },
  location: { minHeight: 42, display: 'flex', alignItems: 'center', gap: 9, marginTop: 14, padding: '0 12px', borderRadius: 12, background: '#f5f5f5', color: '#aaaeb3' },
  locationText: { minWidth: 0, overflow: 'hidden', fontSize: 13, lineHeight: '18px', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  rows: { display: 'grid', gap: 1, marginTop: 19 },
  row: { minHeight: 39, display: 'flex', alignItems: 'center', gap: 10, padding: '0 2px', color: '#a4a6a9' },
  icon: { width: 20, flex: 'none', display: 'grid', placeItems: 'center', color: '#a4a6a9', fontSize: 18, lineHeight: 1 },
  rowLabel: { flex: 'none', fontSize: 14, lineHeight: '20px' },
  rowValue: { minWidth: 0, flex: 1, overflow: 'hidden', color: '#292a2d', fontSize: 14, lineHeight: '20px', textAlign: 'right', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  enabled: { color: '#09b94f' },
  loading: { margin: '9px 0 -3px 30px', color: '#a4a6a9', fontSize: 12, lineHeight: '18px' },
  error: { marginTop: 18, padding: '12px 14px', borderRadius: 12, background: '#fff3f2', color: '#b6423b', fontSize: 14, lineHeight: '21px' },
} as const

function epochMillis(value: number): number { return Number.isFinite(value) && value > 0 ? value < 100_000_000_000 ? value * 1000 : value : 0 }
function sentAtLabel(value: number): string {
  const timestamp = epochMillis(value)
  if (timestamp === 0) return '未记录'
  return new Date(timestamp).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
}
export function arkmeMessageSnapshotDurationLabel(value: number): string {
  const seconds = Math.max(0, Math.floor(value / 1000))
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}
export function arkmeCanOpenMessageSnapshot(item: ArkmeTimelineItem): boolean {
  return item.isMe && (item.messageActionRef?.trim() ?? '') !== '' && item.forwardRecords === undefined && item.sharedRecording === undefined
}
function detailTimeLabel(value: number | undefined): string { return value === undefined ? '未记录' : sentAtLabel(value) }
function numberLabel(value: number | undefined, suffix = ''): string { return value === undefined ? '未记录' : `${String(Math.round(value * 10) / 10)}${suffix}` }
function batteryLabel(context: ArkmeMessageSnapshotDetail['captureContext']): string {
  if (context?.electric === undefined) return '未记录'
  return `${String(context.electric)}%${context.charge === 1 ? '（充电中）' : context.charge === 3 ? '（暂停充电）' : ''}`
}
function locationDetailLabel(location: ArkmeTimelineItem['locationCapture']): string | undefined {
  if (location === undefined) return undefined
  const coordinates = `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}`
  return location.accuracyMeters === undefined ? `已记录位置（${coordinates}）` : `已记录位置（${coordinates}，±${String(Math.round(location.accuracyMeters))}m）`
}
function SnapshotGlyph({ children }: { children: ReactNode }) { return <span aria-hidden style={styles.icon}>{children}</span> }

export function ArkmeMessageSnapshotDialogContent({ item, detail, loading = false, loadError }: { item: ArkmeTimelineItem; detail?: ArkmeMessageSnapshotDetail; loading?: boolean; loadError?: string }) {
  const text = detail?.textContent.trim() || item.textContent.trim() || item.title.trim() || '暂无内容'
  const error = loadError?.trim()
  if (error !== undefined && error !== '') return <>
    <p style={styles.preview}>{text}</p>
    <div role="alert" style={styles.error}>快记详情未加载成功：{error}</div>
  </>
  const durationMillis = Math.max(0, detail?.recordDurationMillis ?? item.recordDurationMillis ?? 0) + Math.max(0, detail?.editDurationMillis ?? item.editDurationMillis ?? 0)
  const context = detail?.captureContext ?? item.captureContext
  const locationCapture = detail?.locationCapture ?? item.locationCapture
  const locationText = detail?.locationLabel ?? locationDetailLabel(locationCapture) ?? '暂无详细位置信息'
  const rows: Array<{ icon: ReactNode; label: string; value: string; enabled?: boolean }> = [
    { icon: <Ear size={19} weight="light" />, label: '背景音', value: detail?.backgroundSound === 'available' ? '已记录背景音' : '未开启背景音', enabled: detail?.backgroundSound !== 'available' },
    { icon: <Cloud size={19} weight="light" />, label: '天气', value: detail?.weather ?? '未记录' },
    { icon: <Mountains size={19} weight="light" />, label: '海拔', value: numberLabel(detail?.altitudeMeters, 'm') },
    { icon: <PersonSimpleWalk size={19} weight="light" />, label: '移动状态', value: detail?.movement ?? '未记录' },
    { icon: <Desktop size={19} weight="light" />, label: '终端', value: context?.clientName ?? '未记录' },
    { icon: <BatteryHigh size={19} weight="light" />, label: '设备电量', value: batteryLabel(context) },
    { icon: <Globe size={19} weight="light" />, label: '网络', value: context?.networkName ?? '未记录' },
    { icon: <CalendarBlank size={19} weight="light" />, label: '归属日期', value: detail?.belongDate ?? new Date(epochMillis(item.sendAtMillis)).toLocaleDateString('zh-CN') },
    { icon: <Clock size={19} weight="light" />, label: '开始时间', value: detailTimeLabel(detail?.startAtMillis) },
    { icon: <Clock size={19} weight="light" />, label: '完成时间', value: detailTimeLabel(detail?.completeAtMillis ?? item.sendAtMillis) },
    { icon: <CloudArrowUp size={19} weight="light" />, label: '同步时间', value: detail?.syncedAtMillis === undefined ? (detail?.syncState === 'syncing' ? '同步中' : detail?.syncState === 'failed' ? '同步失败' : detail?.syncState === 'synced' ? '已同步' : '未记录') : detailTimeLabel(detail.syncedAtMillis) },
  ]
  return <>
    <p style={styles.preview}>{text}</p>
    <div style={styles.stats} aria-label="快记统计">
      <div style={styles.stat}><span style={styles.statLabel}>字数</span><strong style={styles.statValue}>{String(Array.from(text).length)}</strong></div>
      <div style={styles.stat}><span style={styles.statLabel}>记录时长</span><strong style={styles.statValue}>{arkmeMessageSnapshotDurationLabel(durationMillis)}</strong></div>
      <div style={styles.stat}><span style={styles.statLabel}>查阅/回顾</span><strong style={styles.statValue}>{String(detail?.viewTimes ?? 0)}次</strong></div>
      <div style={styles.stat}><span style={styles.statLabel}>分享</span><strong style={styles.statValue}>{String(detail?.shareTimes ?? 0)}次</strong></div>
    </div>
    <div style={styles.location} title={locationText}><SnapshotGlyph><MapPin size={19} weight="fill" /></SnapshotGlyph><span style={styles.locationText}>{locationText}</span></div>
    {loading ? <p style={styles.loading}>正在补全记忆快照…</p> : null}
    <div style={styles.rows} aria-label="记忆快照">
      {rows.map(row => <div key={row.label} style={styles.row}><SnapshotGlyph>{row.icon}</SnapshotGlyph><span style={styles.rowLabel}>{row.label}</span><span title={row.value} style={{ ...styles.rowValue, ...(row.enabled ? styles.enabled : {}) }}>{row.value}{row.enabled ? '  去开启›' : ''}</span></div>)}
    </div>
  </>
}

export function ArkmeMessageSnapshotDialog({ item, detail, loading = false, loadError, onClose }: { item: ArkmeTimelineItem; detail?: ArkmeMessageSnapshotDetail; loading?: boolean; loadError?: string; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const triggerRef = useRef<HTMLElement>()
  useEffect(() => {
    triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    closeRef.current?.focus({ preventScroll: true })
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); onClose() } }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown); triggerRef.current?.focus({ preventScroll: true }) }
  }, [onClose])
  return createPortal(
    <div style={styles.backdrop} role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <section role="dialog" aria-modal="true" aria-label="快记详情" style={styles.dialog}>
        <button ref={closeRef} type="button" aria-label="关闭快记详情" style={styles.close} onClick={onClose}><X size={22} weight="bold" /></button>
        <div style={styles.body}><ArkmeMessageSnapshotDialogContent item={item} {...(detail === undefined ? {} : { detail })} loading={loading} {...(loadError === undefined ? {} : { loadError })} /></div>
      </section>
    </div>,
    document.body,
  )
}
