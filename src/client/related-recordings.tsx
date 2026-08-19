import { useEffect, useState, type CSSProperties } from 'react'
import type {
  ArkmeRelatedRecordingItem, ArkmeRelatedRecordingMonthBucket, ArkmeRelatedRecordingPageState,
} from '../types.js'

const colors = {
  panel: 'var(--dsw-alias-bg-base, #ffffff)',
  text: 'var(--dsw-alias-label-primary, #17191c)',
  secondary: 'var(--dsw-alias-label-secondary, #68707c)',
  border: 'var(--dsw-alias-border-l2, #e2e5e9)',
  subtle: 'var(--dsw-alias-bg-subtle, #f6f7f9)',
}

const styles: Record<string, CSSProperties> = {
  panel: {
    position: 'absolute', zIndex: 30, top: 56, right: 0, bottom: 12, width: 'min(440px, 100%)',
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
    border: `1px solid ${colors.border}`, borderRight: 0, borderRadius: '18px 0 0 18px',
    background: colors.panel, boxSizing: 'border-box', boxShadow: '-12px 8px 30px rgba(0,0,0,.08)',
  },
  panelHeader: { flex: 'none', padding: '20px 20px 14px', borderBottom: `1px solid ${colors.border}` },
  titleRow: { display: 'flex', alignItems: 'center', gap: 12 },
  title: { margin: 0, flex: 1, fontSize: 20, lineHeight: '28px' },
  iconButton: { width: 34, height: 34, border: 0, borderRadius: 10, background: 'transparent', color: colors.secondary, fontSize: 24, cursor: 'pointer' },
  subtitle: { margin: '8px 0 0', color: colors.secondary, fontSize: 13, lineHeight: '20px' },
  filters: { display: 'flex', gap: 8, marginTop: 14, overflowX: 'auto', paddingBottom: 2 },
  filter: { flex: 'none', border: `1px solid ${colors.border}`, borderRadius: 999, padding: '6px 11px', background: colors.panel, color: colors.secondary, cursor: 'pointer', fontSize: 12 },
  filterActive: { background: colors.text, color: colors.panel, borderColor: colors.text },
  body: { flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px 16px 24px' },
  state: { minHeight: 180, display: 'grid', placeItems: 'center', textAlign: 'center', color: colors.secondary, fontSize: 13, padding: 24 },
  stateBox: { maxWidth: 280 },
  retry: { marginTop: 12, border: `1px solid ${colors.border}`, borderRadius: 9, padding: '7px 14px', background: colors.panel, color: colors.text, cursor: 'pointer' },
  partial: { marginBottom: 12, padding: '9px 11px', borderRadius: 9, background: 'rgba(57,100,254,.08)', color: colors.secondary, fontSize: 12 },
  group: { marginBottom: 20 },
  groupHeader: { display: 'flex', alignItems: 'center', gap: 8, margin: '0 4px 10px', color: colors.secondary, fontSize: 13, fontWeight: 600 },
  count: { marginLeft: 'auto', fontWeight: 400 },
  list: { display: 'flex', flexDirection: 'column', gap: 10 },
  card: { width: '100%', textAlign: 'left', border: `1px solid ${colors.border}`, borderRadius: 14, padding: 14, background: colors.panel, color: colors.text, cursor: 'pointer' },
  cardTop: { display: 'flex', alignItems: 'baseline', gap: 8 },
  cardTitle: { flex: 1, fontSize: 14, lineHeight: '20px', fontWeight: 600 },
  time: { flex: 'none', color: colors.secondary, fontSize: 11 },
  summary: { margin: '8px 0 0', color: colors.secondary, fontSize: 13, lineHeight: '20px', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' },
  participants: { marginTop: 10, color: '#969ca5', fontSize: 11 },
  status: { display: 'inline-block', marginTop: 9, padding: '3px 7px', borderRadius: 999, background: colors.subtle, color: colors.secondary, fontSize: 11 },
  more: { display: 'block', margin: '6px auto 0', border: `1px solid ${colors.border}`, borderRadius: 10, padding: '8px 16px', background: colors.panel, color: colors.text, cursor: 'pointer' },
  backdrop: { position: 'fixed', inset: 0, zIndex: 1000, display: 'grid', placeItems: 'center', padding: 24, background: 'rgba(20,22,26,.44)' },
  modal: { width: 'min(720px, calc(100vw - 48px))', maxHeight: 'min(720px, calc(100vh - 80px))', display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRadius: 18, background: colors.panel, boxShadow: '0 24px 80px rgba(0,0,0,.24)' },
  modalHeader: { display: 'flex', alignItems: 'center', gap: 12, padding: '20px 24px', borderBottom: `1px solid ${colors.border}` },
  modalTitle: { margin: 0, flex: 1, fontSize: 20, lineHeight: '28px' },
  modalBody: { overflowY: 'auto', padding: '22px 24px 28px' },
  sectionLabel: { margin: '0 0 10px', fontSize: 14, fontWeight: 600 },
  detailSummary: { margin: 0, whiteSpace: 'pre-wrap', color: colors.text, fontSize: 14, lineHeight: '24px' },
  detailMeta: { marginTop: 18, color: colors.secondary, fontSize: 12, lineHeight: '20px' },
  actions: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginTop: 20 },
  secondaryButton: { border: `1px solid ${colors.border}`, borderRadius: 10, padding: '8px 14px', background: colors.panel, color: colors.text, cursor: 'pointer' },
  actionLabel: { color: colors.secondary, fontSize: 12 },
  transcript: { margin: '14px 0 0', padding: 16, borderRadius: 12, background: colors.subtle, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 13, lineHeight: '22px' },
}

export interface RelatedRecordingGroup {
  key: string
  label: string
  items: ArkmeRelatedRecordingItem[]
}

function dateValue(item: ArkmeRelatedRecordingItem): number {
  return item.dateStamp ?? item.startAtMillis
}

export function groupRelatedRecordings(items: readonly ArkmeRelatedRecordingItem[]): RelatedRecordingGroup[] {
  const formatter = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' })
  const groups: RelatedRecordingGroup[] = []
  for (const item of items) {
    const date = new Date(dateValue(item))
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    const previous = groups.at(-1)
    if (previous?.key === key) previous.items.push(item)
    else groups.push({ key, label: formatter.format(date), items: [item] })
  }
  return groups
}

export function mergeRelatedRecordingItems(
  current: readonly ArkmeRelatedRecordingItem[],
  incoming: readonly ArkmeRelatedRecordingItem[],
): ArkmeRelatedRecordingItem[] {
  const seen = new Set<string>()
  const merged: ArkmeRelatedRecordingItem[] = []
  for (const item of [...current, ...incoming]) {
    if (seen.has(item.recordingRef)) continue
    seen.add(item.recordingRef)
    merged.push(item)
  }
  return merged
}

export function isCurrentRelatedRecordingRequest(
  requestGeneration: number,
  activeGeneration: number,
  requestSourceRef: string,
  activeSourceRef: string,
): boolean {
  return requestGeneration === activeGeneration && requestSourceRef === activeSourceRef
}

export function shouldShowRelatedRecordingsEntry(
  authenticated: boolean,
  sourceKind: string | undefined,
  eligibility: 'idle' | 'loading' | 'allowed' | 'denied' | 'error',
  panelOpen = false,
): boolean {
  return authenticated && sourceKind === 'private_chat' && eligibility === 'allowed' && !panelOpen
}

function monthLabel(monthKey: string): string {
  const [year, month] = monthKey.split('-')
  return `${year ?? ''}年${month ?? ''}月`
}

function participantText(item: ArkmeRelatedRecordingItem): string {
  const names = item.participants.map(value => value.displayName).filter(Boolean)
  return names.length === 0 ? '参与人信息暂不可用' : `参与人：${names.join(' / ')}`
}

function statusText(item: ArkmeRelatedRecordingItem): string {
  return item.isSharedByOther ? '对方共享' : ''
}

export interface RelatedRecordingsPanelProps {
  contactName: string
  state: 'loading' | ArkmeRelatedRecordingPageState
  stateMessage: string
  error: string
  items: ArkmeRelatedRecordingItem[]
  hasMore: boolean
  loadingMore: boolean
  monthBuckets: ArkmeRelatedRecordingMonthBucket[]
  selectedMonth: string
  onClose(): void
  onRetry(): void
  onLoadMore(): void
  onMonthChange(month: string): void
  onSelect(item: ArkmeRelatedRecordingItem): void
}

export function RelatedRecordingsPanel(props: RelatedRecordingsPanelProps) {
  const groups = groupRelatedRecordings(props.items)
  const showCards = props.items.length > 0
  return <aside style={styles.panel} aria-label="相关录音">
    <div style={styles.panelHeader}>
      <div style={styles.titleRow}>
        <h2 style={styles.title}>相关录音</h2>
        <button type="button" style={styles.iconButton} onClick={props.onClose} aria-label="关闭相关录音">×</button>
      </div>
      <p style={styles.subtitle}>你与 {props.contactName} 的线下交流记录</p>
      {props.monthBuckets.length > 0 && <div style={styles.filters} aria-label="按月份筛选">
        <button type="button" style={{ ...styles.filter, ...(props.selectedMonth === '' ? styles.filterActive : {}) }} onClick={() => { props.onMonthChange('') }}>全部时间</button>
        {props.monthBuckets.map(bucket => <button key={bucket.monthKey} type="button"
          style={{ ...styles.filter, ...(props.selectedMonth === bucket.monthKey ? styles.filterActive : {}) }}
          onClick={() => { props.onMonthChange(bucket.monthKey) }}>
          {monthLabel(bucket.monthKey)} · {bucket.itemCount}
        </button>)}
      </div>}
    </div>
    <div style={styles.body}>
      {props.state === 'partial' && <div style={styles.partial}>{props.stateMessage || '部分相关录音暂不可用，已展示可读取内容。'}</div>}
      {!showCards && props.state === 'loading' && <div style={styles.state}><div style={styles.stateBox}>正在读取相关录音…</div></div>}
      {!showCards && props.state === 'generating' && <div style={styles.state}><div style={styles.stateBox}>{props.stateMessage || '相关录音正在整理中，请稍后再试。'}<br /><button type="button" style={styles.retry} onClick={props.onRetry}>重新加载</button></div></div>}
      {!showCards && props.state === 'empty' && <div style={styles.state}><div style={styles.stateBox}>暂无相关录音</div></div>}
      {!showCards && (props.state === 'error' || props.error !== '') && <div style={styles.state}><div style={styles.stateBox}>{props.error || props.stateMessage || '相关录音暂时无法读取'}<br /><button type="button" style={styles.retry} onClick={props.onRetry}>重试</button></div></div>}
      {showCards && groups.map(group => <section key={group.key} style={styles.group}>
        <div style={styles.groupHeader}><span>⌄</span><span>{group.label}</span><span style={styles.count}>{group.items.length} 段</span></div>
        <div style={styles.list}>{group.items.map(item => <button key={item.recordingRef} type="button" style={styles.card} onClick={() => { props.onSelect(item) }}>
          <span style={styles.cardTop}><span style={styles.cardTitle}>{item.title || '未命名录音'}</span><span style={styles.time}>{item.timeRangeText}</span></span>
          <p style={styles.summary}>{item.summary || '暂无总结'}</p>
          <div style={styles.participants}>{participantText(item)}</div>
          {statusText(item) !== '' && <span style={styles.status}>{statusText(item)}</span>}
        </button>)}</div>
      </section>)}
      {props.hasMore && <button type="button" style={{ ...styles.more, opacity: props.loadingMore ? .55 : 1 }} disabled={props.loadingMore} onClick={props.onLoadMore}>
        {props.loadingMore ? '正在加载…' : '加载更多'}
      </button>}
    </div>
  </aside>
}

export interface RelatedRecordingDetailProps {
  item: ArkmeRelatedRecordingItem
  onClose(): void
}

export function RelatedRecordingDetail(props: RelatedRecordingDetailProps) {
  const [showTranscript, setShowTranscript] = useState(false)
  useEffect(() => { setShowTranscript(false) }, [props.item.recordingRef])
  return <div style={styles.backdrop} role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) props.onClose() }}>
    <section style={styles.modal} role="dialog" aria-modal="true" aria-label="相关录音详情">
      <header style={styles.modalHeader}>
        <h2 style={styles.modalTitle}>{props.item.title || '未命名录音'}</h2>
        <button type="button" style={styles.iconButton} onClick={props.onClose} aria-label="关闭录音详情">×</button>
      </header>
      <div style={styles.modalBody}>
        <h3 style={styles.sectionLabel}>时段总结</h3>
        <p style={styles.detailSummary}>{props.item.summary || '暂无总结'}</p>
        <div style={styles.detailMeta}>{props.item.timeRangeText || '时间范围暂不可用'}<br />{participantText(props.item)}</div>
        <div style={styles.actions}>
          {props.item.transcriptAvailable && props.item.transcript !== undefined &&
            <button type="button" style={styles.secondaryButton} onClick={() => { setShowTranscript(value => !value) }}>
              {showTranscript ? '收起原文' : '查看原文'}
            </button>
          }
          {props.item.isSharedByOther && <span style={styles.actionLabel}>对方共享 · 只读</span>}
        </div>
        {showTranscript && props.item.transcript !== undefined && <div style={styles.transcript}>{props.item.transcript}</div>}
      </div>
    </section>
  </div>
}
