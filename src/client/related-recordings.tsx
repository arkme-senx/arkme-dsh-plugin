import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { CaretDown } from '@phosphor-icons/react/dist/icons/CaretDown'
import { CaretRight } from '@phosphor-icons/react/dist/icons/CaretRight'
import { X } from '@phosphor-icons/react/dist/icons/X'
import type {
  ArkmeRelatedRecordingItem, ArkmeRelatedRecordingMonthBucket, ArkmeRelatedRecordingPageState,
} from '../types.js'
import { ArkmeUserAvatar } from './ArkmeAvatar.js'
import { arkmeTheme } from './arkme-theme.js'

const colors = {
  panel: arkmeTheme.menu,
  text: arkmeTheme.text,
  secondary: arkmeTheme.secondary,
  border: arkmeTheme.border,
  subtle: arkmeTheme.subtle,
  caption: arkmeTheme.caption,
}

export const ARKME_RELATED_RECORDING_TRANSCRIPT_BG = arkmeTheme.subtle
const ARKME_RELATED_RECORDING_MODAL_BODY_CLASS = 'arkme-related-recording-modal-body'
const ARKME_RELATED_RECORDING_MODAL_SCROLLBAR_CSS = `
.${ARKME_RELATED_RECORDING_MODAL_BODY_CLASS} {
  -ms-overflow-style: none;
  scrollbar-width: none;
}
.${ARKME_RELATED_RECORDING_MODAL_BODY_CLASS}::-webkit-scrollbar {
  width: 0;
  height: 0;
}
`

const styles: Record<string, CSSProperties> = {
  panel: {
    position: 'absolute', zIndex: 30, top: 48, right: 0, bottom: 0, width: 'min(408px, 100%)',
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
    border: `1px solid ${colors.border}`, borderRight: 0, borderBottom: 0, borderRadius: '18px 0 0 0',
    background: colors.panel, boxSizing: 'border-box', boxShadow: '-14px 0 30px rgba(31,34,41,.09)',
  },
  panelHeader: { flex: 'none', padding: '34px 26px 18px' },
  titleRow: { display: 'flex', alignItems: 'center', gap: 12 },
  title: { margin: 0, flex: 1, fontSize: 22, lineHeight: '30px', fontWeight: 650 },
  iconButton: { width: 36, height: 36, display: 'grid', placeItems: 'center', padding: 0, border: 0, borderRadius: 10, background: 'transparent', color: colors.secondary, lineHeight: 1, cursor: 'pointer' },
  subtitleRow: { position: 'relative', marginTop: 18, display: 'flex', alignItems: 'center', gap: 14 },
  subtitle: { minWidth: 0, flex: 1, margin: 0, color: colors.secondary, fontSize: 13, lineHeight: '20px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  filterWrap: { position: 'relative', flex: 'none' },
  filter: {
    height: 36, minWidth: 104, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    border: `1px solid ${colors.border}`, borderRadius: 999, padding: '0 14px', background: colors.panel,
    color: colors.secondary, cursor: 'pointer', font: 'inherit', fontSize: 13, outline: 0,
  },
  filterChevron: { color: colors.secondary, fontSize: 15, lineHeight: 1 },
  filterMenu: {
    position: 'absolute', top: 42, right: 0, zIndex: 2, width: 202, maxHeight: 420, padding: 0, boxSizing: 'border-box',
    border: `1px solid ${colors.border}`, borderRadius: 12, background: colors.panel,
    overflowY: 'auto', boxShadow: '0 14px 36px rgba(24,27,34,.14)',
  },
  filterMenuItem: {
    width: '100%', height: 48, display: 'flex', alignItems: 'center', gap: 8, padding: '0 16px',
    border: 0, background: 'transparent', color: colors.secondary, cursor: 'pointer', textAlign: 'left',
    font: 'inherit', boxSizing: 'border-box', outline: 0,
  },
  filterMenuItemLabel: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 },
  filterMenuItemLabelActive: { color: colors.text, fontWeight: 650 },
  filterMenuItemCount: { flex: 'none', color: colors.caption, fontSize: 12 },
  body: { flex: 1, minHeight: 0, overflowY: 'auto', padding: '6px 24px 28px' },
  state: { minHeight: 180, display: 'grid', placeItems: 'center', textAlign: 'center', color: colors.secondary, fontSize: 13, padding: 24 },
  stateBox: { maxWidth: 280 },
  retry: { marginTop: 12, border: `1px solid ${colors.border}`, borderRadius: 9, padding: '7px 14px', background: colors.panel, color: colors.text, cursor: 'pointer' },
  partial: { marginBottom: 12, padding: '9px 11px', borderRadius: 9, background: 'rgba(57,100,254,.08)', color: colors.secondary, fontSize: 12 },
  group: { marginBottom: 16 },
  groupHeader: { width: 'calc(100% - 20px)', display: 'flex', alignItems: 'center', gap: 9, margin: '0 10px 16px', padding: 0, border: 0, background: 'transparent', color: colors.secondary, textAlign: 'left', font: 'inherit', fontSize: 14, lineHeight: '22px', fontWeight: 650, cursor: 'pointer', outline: 0 },
  groupChevron: { width: 12, flex: 'none', color: colors.secondary, display: 'inline-grid', placeItems: 'center' },
  count: { marginLeft: 'auto', fontWeight: 400 },
  list: { display: 'flex', flexDirection: 'column', gap: 10 },
  card: { width: '100%', textAlign: 'left', border: `1px solid ${colors.border}`, borderRadius: 12, padding: '12px 12px 12px 14px', background: colors.panel, color: colors.text, cursor: 'pointer', boxSizing: 'border-box', outline: 0 },
  cardTop: { display: 'flex', alignItems: 'baseline', gap: 8 },
  cardTitle: { flex: 1, minWidth: 0, fontSize: 14, lineHeight: '20px', fontWeight: 650, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  time: { flex: 'none', color: colors.secondary, fontSize: 12, lineHeight: '20px' },
  summary: { margin: '8px 0 0', color: colors.secondary, fontSize: 13, lineHeight: '19px', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' },
  cardBottom: { marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 },
  participants: { flex: 1, minWidth: 0, color: arkmeTheme.tertiary, fontSize: 12, lineHeight: '18px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  cardAvatar: { flex: 'none', width: 20, height: 20, pointerEvents: 'none' },
  end: { margin: '26px 0 0', textAlign: 'center', color: colors.caption, fontSize: 13, lineHeight: '20px' },
  more: { display: 'block', margin: '6px auto 0', border: `1px solid ${colors.border}`, borderRadius: 10, padding: '8px 16px', background: colors.panel, color: colors.text, cursor: 'pointer' },
  backdrop: { position: 'fixed', inset: 0, zIndex: 10020, display: 'grid', placeItems: 'center', padding: 24, background: 'var(--dsw-alias-bg-mask-1, rgba(20,22,26,.44))' },
  modal: { width: 'clamp(320px, calc(100vw - 40px), 560px)', height: 'clamp(420px, calc(100vh - 48px), 560px)', display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRadius: 12, background: colors.panel, boxShadow: '0 24px 80px rgba(0,0,0,.24)' },
  modalHeader: { height: 56, flex: 'none', display: 'flex', alignItems: 'center', gap: 12, padding: '0 20px', borderBottom: `1px solid ${colors.border}`, boxSizing: 'border-box' },
  modalTitleGroup: { flex: 1, minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 14 },
  modalTitle: { margin: 0, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 18, lineHeight: '24px', fontWeight: 600 },
  modalTitleTime: { flex: 'none', color: colors.caption, fontSize: 12, lineHeight: '18px', fontWeight: 400 },
  modalBody: { flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', padding: '18px 20px 20px' },
  sectionLabel: { margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 600 },
  sectionIcon: { width: 20, flex: 'none', fontSize: 18, lineHeight: 1 },
  detailSummary: { margin: 0, whiteSpace: 'pre-wrap', color: colors.secondary, fontSize: 14, lineHeight: '23px' },
  detailMeta: { marginTop: 16, color: colors.caption, fontSize: 13, lineHeight: '18px' },
  actions: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginTop: 18 },
  secondaryButton: { width: 92, height: 36, display: 'grid', placeItems: 'center', border: `1px solid ${colors.border}`, borderRadius: 8, padding: 0, background: colors.panel, color: colors.text, cursor: 'pointer', font: 'inherit', fontSize: 14, fontWeight: 500, outline: 0 },
  actionLabel: { color: colors.secondary, fontSize: 12 },
  transcript: { margin: '14px 0 0', padding: 16, borderRadius: 12, background: ARKME_RELATED_RECORDING_TRANSCRIPT_BG, color: colors.text, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 13, lineHeight: '22px' },
}

export interface RelatedRecordingGroup {
  key: string
  label: string
  items: ArkmeRelatedRecordingItem[]
}

interface RelatedRecordingMonthEntry {
  key: string
  label: string
  itemCount: number
}

const UNKNOWN_TIME_GROUP_KEY = '__unknown_time__'

interface RecordingDateParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  weekday: number
}

function safeTimestamp(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0
}

function displayDatePartsFromTimestamp(timestamp: number, timezoneOffsetMillis: number | undefined): RecordingDateParts | undefined {
  const safe = safeTimestamp(timestamp)
  if (safe <= 0) return undefined
  const offset = Number.isFinite(timezoneOffsetMillis) && timezoneOffsetMillis !== 0 ? timezoneOffsetMillis : undefined
  const date = new Date(safe + (offset ?? 0))
  return offset === undefined
    ? {
        year: date.getFullYear(),
        month: date.getMonth() + 1,
        day: date.getDate(),
        hour: date.getHours(),
        minute: date.getMinutes(),
        weekday: date.getDay(),
      }
    : {
        year: date.getUTCFullYear(),
        month: date.getUTCMonth() + 1,
        day: date.getUTCDate(),
        hour: date.getUTCHours(),
        minute: date.getUTCMinutes(),
        weekday: date.getUTCDay(),
      }
}

function displayDatePartsFromDateStamp(dateStamp: number | undefined): RecordingDateParts | undefined {
  const stamp = dateStamp ?? 0
  if (!Number.isInteger(stamp) || stamp < 10000101) return undefined
  const year = Math.trunc(stamp / 10000)
  const month = Math.trunc(stamp / 100) % 100
  const day = stamp % 100
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() + 1 !== month || date.getDate() !== day) return undefined
  return { year, month, day, hour: 0, minute: 0, weekday: date.getDay() }
}

function displayStartParts(item: ArkmeRelatedRecordingItem): RecordingDateParts | undefined {
  return displayDatePartsFromTimestamp(item.startAtMillis, item.timezoneOffsetMillis)
    ?? displayDatePartsFromDateStamp(item.dateStamp)
}

function recordingSortValue(item: ArkmeRelatedRecordingItem): number {
  const timestamp = safeTimestamp(item.startAtMillis)
  if (timestamp > 0) return timestamp
  const parts = displayDatePartsFromDateStamp(item.dateStamp)
  return parts === undefined ? 0 : new Date(parts.year, parts.month - 1, parts.day).getTime()
}

function twoDigits(value: number): string {
  return String(value).padStart(2, '0')
}

function relatedRecordingGroupLabel(parts: RecordingDateParts): string {
  const weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][parts.weekday] ?? ''
  return `${parts.year}-${twoDigits(parts.month)}-${twoDigits(parts.day)}${weekday === '' ? '' : ` ${weekday}`}`
}

export function groupRelatedRecordings(items: readonly ArkmeRelatedRecordingItem[]): RelatedRecordingGroup[] {
  const sorted = [...items].sort((left, right) => recordingSortValue(right) - recordingSortValue(left))
  const groups: RelatedRecordingGroup[] = []
  for (const item of sorted) {
    const parts = displayStartParts(item)
    const key = parts === undefined ? UNKNOWN_TIME_GROUP_KEY : `${parts.year}-${twoDigits(parts.month)}-${twoDigits(parts.day)}`
    const previous = groups.at(-1)
    if (previous?.key === key) previous.items.push(item)
    else groups.push({ key, label: parts === undefined ? '时间未知' : relatedRecordingGroupLabel(parts), items: [item] })
  }
  return groups.map(group => ({
    ...group,
    items: [...group.items].sort((left, right) => recordingSortValue(left) - recordingSortValue(right)),
  }))
}

function relatedRecordingMonthKey(item: ArkmeRelatedRecordingItem): string {
  const parts = displayStartParts(item)
  return parts === undefined ? UNKNOWN_TIME_GROUP_KEY : `${parts.year}-${twoDigits(parts.month)}`
}

function relatedRecordingMonthLabel(item: ArkmeRelatedRecordingItem): string {
  const parts = displayStartParts(item)
  return parts === undefined ? '时间未知' : `${parts.year}年${String(parts.month)}月`
}

function buildRelatedRecordingMonthEntries(items: readonly ArkmeRelatedRecordingItem[]): RelatedRecordingMonthEntry[] {
  const sorted = [...items].sort((left, right) => recordingSortValue(right) - recordingSortValue(left))
  const entries: RelatedRecordingMonthEntry[] = []
  const entryMap = new Map<string, RelatedRecordingMonthEntry>()
  for (const item of sorted) {
    const key = relatedRecordingMonthKey(item)
    const existing = entryMap.get(key)
    if (existing !== undefined) {
      existing.itemCount += 1
      continue
    }
    const entry = { key, label: relatedRecordingMonthLabel(item), itemCount: 1 }
    entryMap.set(key, entry)
    entries.push(entry)
  }
  return entries
}

function effectiveSelectedMonth(monthEntries: readonly RelatedRecordingMonthEntry[], selectedMonth: string): string {
  if (selectedMonth === '') return ''
  return monthEntries.some(entry => entry.key === selectedMonth) ? selectedMonth : ''
}

function filterItemsByMonth(items: readonly ArkmeRelatedRecordingItem[], selectedMonth: string): ArkmeRelatedRecordingItem[] {
  if (selectedMonth === '') return [...items]
  return items.filter(item => relatedRecordingMonthKey(item) === selectedMonth)
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

export function shouldShowPrivateChatActions(
  authenticated: boolean,
  sourceKind: string | undefined,
): boolean {
  return authenticated && sourceKind === 'private_chat'
}

function monthLabel(monthKey: string): string {
  const [year, month] = monthKey.split('-')
  const numericMonth = Number.parseInt(month ?? '', 10)
  return `${year ?? ''}年${Number.isFinite(numericMonth) ? String(numericMonth) : month ?? ''}月`
}

function participantNames(item: ArkmeRelatedRecordingItem): string[] {
  const names: string[] = []
  const seen = new Set<string>()
  const addName = (value: string | undefined) => {
    const name = value?.trim() ?? ''
    if (name === '' || seen.has(name)) return
    seen.add(name)
    names.push(name)
  }
  item.participants.forEach(participant => {
    addName(participant.displayName)
    addName(participant.nickname)
    if ((participant.displayName?.trim() ?? '') === '' && (participant.nickname?.trim() ?? '') === '') {
      if (participant.role === 2) addName('我')
      else if (participant.role === 1) addName('对方')
      else if (participant.role === 4) addName('其他说话人')
    }
  })
  if (names.length === 0) item.speakers.forEach(speaker => { addName(speaker.nickname) })
  return names
}

function participantCardText(item: ArkmeRelatedRecordingItem): string {
  const names = participantNames(item)
  return names.length === 0 ? '' : `参与者: ${names.join(' / ')}`
}

function participantDetailText(item: ArkmeRelatedRecordingItem): string {
  const names = participantNames(item)
  return names.length === 0 ? '' : `参与者：${names.join(' / ')}`
}

function sameDisplayMinute(start: RecordingDateParts, end: RecordingDateParts): boolean {
  return start.year === end.year
    && start.month === end.month
    && start.day === end.day
    && start.hour === end.hour
    && start.minute === end.minute
}

function timeSlotFromTimestamps(item: ArkmeRelatedRecordingItem): string {
  const start = displayDatePartsFromTimestamp(item.startAtMillis, item.timezoneOffsetMillis)
  const end = displayDatePartsFromTimestamp(item.endAtMillis, item.timezoneOffsetMillis)
  if (start === undefined || end === undefined || safeTimestamp(item.endAtMillis) <= safeTimestamp(item.startAtMillis)) return ''
  if (sameDisplayMinute(start, end)) return `${twoDigits(start.hour)}:${twoDigits(start.minute)}`
  return `${twoDigits(start.hour)}:${twoDigits(start.minute)} - ${twoDigits(end.hour)}:${twoDigits(end.minute)}`
}

function timeSlotFromText(text: string): string {
  const clocks = [...text.matchAll(/\b(?:[01]?\d|2[0-3]):[0-5]\d\b/g)].map(match => match[0]).slice(0, 2)
  if (clocks.length >= 2) return `${clocks[0]} - ${clocks[1]}`
  return clocks[0] ?? ''
}

function recordingTimeSlotText(item: ArkmeRelatedRecordingItem): string {
  return timeSlotFromTimestamps(item) || timeSlotFromText(item.timeRangeText) || '时间未知'
}

function bucketCountText(count: number): string {
  return `${count}段`
}

function initialExpandedGroupKeys(groups: readonly RelatedRecordingGroup[]): Set<string> {
  const firstKey = groups[0]?.key
  return firstKey === undefined ? new Set<string>() : new Set([firstKey])
}

export interface RelatedRecordingsPanelProps {
  contactName: string
  contactAvatarRef?: string
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
  const monthEntries = useMemo(() => buildRelatedRecordingMonthEntries(props.items), [props.items])
  const selectedMonth = effectiveSelectedMonth(monthEntries, props.selectedMonth)
  const visibleItems = useMemo(() => filterItemsByMonth(props.items, selectedMonth), [props.items, selectedMonth])
  const groups = useMemo(() => groupRelatedRecordings(visibleItems), [visibleItems])
  const showCards = visibleItems.length > 0
  const [filterOpen, setFilterOpen] = useState(false)
  const [expandedGroupKeys, setExpandedGroupKeys] = useState<Set<string>>(() => initialExpandedGroupKeys(groups))
  const filterRef = useRef<HTMLDivElement>(null)
  const selectedFilterLabel = selectedMonth === '' ? '全部时间' : monthEntries.find(entry => entry.key === selectedMonth)?.label ?? monthLabel(selectedMonth)
  const groupKeySignature = groups.map(group => group.key).join('|')
  const totalBucketCount = monthEntries.reduce((total, entry) => total + Math.max(0, entry.itemCount), 0)
  useEffect(() => {
    setExpandedGroupKeys(current => {
      const visibleKeys = new Set(groups.map(group => group.key))
      const retained = [...current].filter(key => visibleKeys.has(key))
      if (retained.length > 0) return retained.length === current.size ? current : new Set(retained)
      return initialExpandedGroupKeys(groups)
    })
  }, [groupKeySignature, groups])
  useEffect(() => {
    if (!filterOpen || typeof document === 'undefined') return
    const closeFromOutside = (event: PointerEvent | MouseEvent) => {
      if (filterRef.current?.contains(event.target as Node) !== true) setFilterOpen(false)
    }
    const closeFromKeyboard = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setFilterOpen(false)
    }
    document.addEventListener('pointerdown', closeFromOutside, true)
    document.addEventListener('mousedown', closeFromOutside, true)
    document.addEventListener('keydown', closeFromKeyboard)
    return () => {
      document.removeEventListener('pointerdown', closeFromOutside, true)
      document.removeEventListener('mousedown', closeFromOutside, true)
      document.removeEventListener('keydown', closeFromKeyboard)
    }
  }, [filterOpen])
  const chooseMonth = (month: string) => {
    props.onMonthChange(month)
    setFilterOpen(false)
  }
  return <aside style={styles.panel} aria-label="相关录音">
    <div style={styles.panelHeader}>
      <div style={styles.titleRow}>
        <h2 style={styles.title}>相关录音</h2>
        <button type="button" style={styles.iconButton} onClick={props.onClose} aria-label="关闭相关录音"><X size={25} aria-hidden /></button>
      </div>
      <div style={styles.subtitleRow}>
        <p style={styles.subtitle}>你与 {props.contactName} 的线下交流记录</p>
        <div ref={filterRef} style={styles.filterWrap}>
          <button
            type="button" style={styles.filter} aria-label="按时间筛选相关录音"
            aria-haspopup="menu" aria-expanded={filterOpen}
            onClick={() => { setFilterOpen(value => !value) }}
          >
            <span>{selectedFilterLabel}</span><CaretDown size={16} weight="bold" style={styles.filterChevron} aria-hidden />
          </button>
          {filterOpen && <div style={styles.filterMenu} role="menu" aria-label="按月份筛选">
            <button
              type="button" role="menuitem" style={styles.filterMenuItem}
              onClick={() => { chooseMonth('') }}
            ><span style={{ ...styles.filterMenuItemLabel, ...(selectedMonth === '' ? styles.filterMenuItemLabelActive : {}) }}>全部时间</span><span style={styles.filterMenuItemCount}>{bucketCountText(totalBucketCount)}</span></button>
            {monthEntries.map(entry => <button
              key={entry.key} type="button" role="menuitem"
              style={styles.filterMenuItem}
              onClick={() => { chooseMonth(entry.key) }}
            ><span style={{ ...styles.filterMenuItemLabel, ...(selectedMonth === entry.key ? styles.filterMenuItemLabelActive : {}) }}>{entry.label}</span><span style={styles.filterMenuItemCount}>{bucketCountText(entry.itemCount)}</span></button>)}
          </div>}
        </div>
      </div>
    </div>
    <div style={styles.body}>
      {props.state === 'partial' && <div style={styles.partial}>{props.stateMessage || '部分相关录音暂不可用，已展示可读取内容。'}</div>}
      {!showCards && props.state === 'loading' && <div style={styles.state}><div style={styles.stateBox}>正在读取相关录音…</div></div>}
      {!showCards && props.state === 'generating' && <div style={styles.state}><div style={styles.stateBox}>{props.stateMessage || '相关录音正在整理中，请稍后再试。'}<br /><button type="button" style={styles.retry} onClick={props.onRetry}>重新加载</button></div></div>}
      {!showCards && props.state === 'empty' && <div style={styles.state}><div style={styles.stateBox}>暂无相关录音</div></div>}
      {!showCards && (props.state === 'error' || props.error !== '') && <div style={styles.state}><div style={styles.stateBox}>{props.error || props.stateMessage || '相关录音暂时无法读取'}<br /><button type="button" style={styles.retry} onClick={props.onRetry}>重试</button></div></div>}
      {showCards && groups.map(group => {
        const expanded = expandedGroupKeys.has(group.key)
        return <section key={group.key} style={styles.group}>
          <button
            type="button"
            style={styles.groupHeader}
            aria-expanded={expanded}
            onClick={() => {
              setExpandedGroupKeys(current => {
                const next = new Set(current)
                if (!next.delete(group.key)) next.add(group.key)
                return next
              })
            }}
          >
            <span style={styles.groupChevron}>{expanded ? <CaretDown size={18} weight="bold" aria-hidden /> : <CaretRight size={18} weight="bold" aria-hidden />}</span>
            <span>{group.label}</span>
            <span style={styles.count}>{bucketCountText(group.items.length)}</span>
          </button>
          {expanded && <div style={styles.list}>{group.items.map(item => {
            const participantText = participantCardText(item)
            const showSourceAvatar = item.isSharedByOther
            return <button key={item.recordingRef} type="button" style={styles.card} onClick={() => { props.onSelect(item) }}>
              <span style={styles.cardTop}><span style={styles.cardTitle}>{item.title || '未命名录音'}</span><span style={styles.time}>{recordingTimeSlotText(item)}</span></span>
              <p style={styles.summary}>{item.summary || '暂无总结'}</p>
              {(participantText !== '' || showSourceAvatar) && <div style={styles.cardBottom}>
                {participantText === '' ? <span style={styles.participants} /> : <span style={styles.participants}>{participantText}</span>}
                {showSourceAvatar && <span style={styles.cardAvatar}><ArkmeUserAvatar
                  {...(props.contactAvatarRef === undefined ? {} : { avatarRef: props.contactAvatarRef })}
                  size={20}
                  label={`${props.contactName}头像`}
                /></span>}
              </div>}
            </button>
          })}</div>}
        </section>
      })}
      {props.hasMore && <button type="button" style={{ ...styles.more, opacity: props.loadingMore ? .55 : 1 }} disabled={props.loadingMore} onClick={props.onLoadMore}>
        {props.loadingMore ? '正在加载…' : '加载更多'}
      </button>}
      {showCards && !props.hasMore && <div style={styles.end}>没有更多内容了</div>}
    </div>
  </aside>
}

export interface RelatedRecordingDetailProps {
  item: ArkmeRelatedRecordingItem
  loadDetail?: (item: ArkmeRelatedRecordingItem, signal?: AbortSignal) => Promise<ArkmeRelatedRecordingItem>
  showReadOnlyLabel?: boolean
  onClose(): void
}

export function RelatedRecordingDetail(props: RelatedRecordingDetailProps) {
  const [detailItem, setDetailItem] = useState(props.item)
  const [showTranscript, setShowTranscript] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')
  useEffect(() => {
    setDetailItem(props.item)
    setShowTranscript(false)
    setDetailError('')
    setDetailLoading(false)
  }, [props.item.recordingRef])
  const loadDetail = useCallback((item: ArkmeRelatedRecordingItem) => {
    const detailRef = item.sharedRecordingDetailRef?.trim() ?? ''
    if (props.loadDetail === undefined || detailRef === '' || item.transcriptAvailable
      || (item.transcript !== undefined && item.transcript.trim() !== '')) return () => undefined
    const controller = new AbortController()
    setDetailLoading(true)
    setDetailError('')
    void props.loadDetail(item, controller.signal)
      .then(nextItem => {
        if (controller.signal.aborted) return
        setDetailItem(nextItem)
        setDetailError('')
      })
      .catch(error => {
        if (controller.signal.aborted) return
        setDetailError(error instanceof Error && error.message.trim() !== '' ? error.message : '原文暂时无法加载')
      })
      .finally(() => {
        if (!controller.signal.aborted) setDetailLoading(false)
      })
    return () => { controller.abort() }
  }, [props.loadDetail])
  useEffect(() => loadDetail(detailItem), [detailItem.recordingRef, detailItem.transcript, detailItem.transcriptAvailable, loadDetail])
  const retryDetail = () => { loadDetail(detailItem) }
  const timeText = recordingTimeSlotText(detailItem)
  const detailMetaText = participantDetailText(detailItem)
  const transcript = detailItem.transcript?.trim() ?? ''
  const hasTranscript = transcript !== ''
  const detail = <>
    <style>{ARKME_RELATED_RECORDING_MODAL_SCROLLBAR_CSS}</style>
    <div style={styles.backdrop} role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) props.onClose() }}>
      <section style={styles.modal} role="dialog" aria-modal="true" aria-label="相关录音详情">
        <header style={styles.modalHeader}>
          <div style={styles.modalTitleGroup}>
            <h2 style={styles.modalTitle}>{detailItem.title || '未命名录音'}</h2>
            {timeText !== '' && <span style={styles.modalTitleTime}>{timeText}</span>}
          </div>
          <button type="button" style={styles.iconButton} onClick={props.onClose} aria-label="关闭录音详情"><X size={25} aria-hidden /></button>
        </header>
        <div className={ARKME_RELATED_RECORDING_MODAL_BODY_CLASS} style={styles.modalBody}>
          <h3 style={styles.sectionLabel}><span style={styles.sectionIcon} aria-hidden="true">📝</span><span>时段总结</span></h3>
          <p style={styles.detailSummary}>{detailItem.summary || '暂无总结'}</p>
          {detailMetaText !== '' && <div style={styles.detailMeta}>{detailMetaText}</div>}
          <div style={styles.actions}>
            {hasTranscript &&
              <button type="button" style={styles.secondaryButton} onClick={() => { setShowTranscript(value => !value) }}>
                {showTranscript ? '收起原文' : '查看原文'}
              </button>
            }
            {detailLoading && <span style={styles.actionLabel}>正在加载原文…</span>}
            {detailError !== '' && <button type="button" style={styles.secondaryButton} onClick={retryDetail}>重新加载原文</button>}
            {detailError !== '' && <span style={styles.actionLabel}>{detailError}</span>}
          </div>
          {showTranscript && hasTranscript && <div style={styles.transcript}>{transcript}</div>}
        </div>
      </section>
    </div>
  </>
  return typeof document === 'undefined' ? detail : createPortal(detail, document.body)
}
