import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { MagnifyingGlass } from '@phosphor-icons/react/dist/icons/MagnifyingGlass'
import { Waveform } from '@phosphor-icons/react/dist/icons/Waveform'
import { X } from '@phosphor-icons/react/dist/icons/X'
import type {
  ArkmeAiVideoListItem, ArkmeAiVideoListResult, ArkmeFileAssetDisplayItem,
  ArkmeImageSearchItem, ArkmeImageSearchResult,
  ArkmeRecordSearchResult, ArkmeRecordingSearchResult, ArkmeSearchHistoryResult, ArkmeSearchRecordItem,
  ArkmeTimelineCursor, ArkmeTimelinePage,
} from '../types.js'
import { ArkmeClientError, callArkme } from './api.js'
import { arkmeTheme } from './arkme-theme.js'
import { ArkmeDshAgentInputMarker, isDshAgentInputRecord } from './ArkmeDshAgentInputMarker.js'
import { arkmeUi } from './ui-controller.js'
import { ArkmeVoiceContent } from './ArkmeVoiceContent.js'
import { ArkmeRichText } from './ArkmeRichText.js'

const assetRoot = '/arkme-self/api/call'
const mediaRoute = '/arkme-self/api/media'
const colors = {
  text: arkmeTheme.text, secondary: arkmeTheme.secondary,
  tertiary: arkmeTheme.tertiary, border: arkmeTheme.border, panel: arkmeTheme.base,
  subtle: arkmeTheme.subtle, hover: arkmeTheme.hover, blue: arkmeTheme.info, danger: arkmeTheme.danger,
}

const styles: Record<string, CSSProperties> = {
  shell: { width: 'min(980px, 100%)', margin: '0 auto', padding: '34px 48px 44px', boxSizing: 'border-box', color: colors.text },
  dialogOverlay: { position: 'fixed', inset: 0, zIndex: 10020, display: 'grid', placeItems: 'center', padding: 24, boxSizing: 'border-box', background: 'color-mix(in srgb, var(--dsw-alias-bg-base, #fff) 22%, transparent)', backdropFilter: 'blur(3px)', WebkitBackdropFilter: 'blur(3px)' },
  dialogPanel: { width: 'min(1480px, 84vw, calc(100vw - 48px))', height: 'min(940px, 84vh, calc(100vh - 48px))', minHeight: 420, overflow: 'hidden', border: `1px solid ${colors.border}`, borderRadius: 22, background: colors.panel, boxShadow: '0 24px 70px rgba(27, 31, 44, .18)', boxSizing: 'border-box' },
  dialogShell: { width: '100%', height: '100%', margin: 0, padding: '22px 22px 26px', display: 'flex', flexDirection: 'column', boxSizing: 'border-box', color: colors.text },
  hero: { marginBottom: 22 },
  eyebrow: { margin: '0 0 8px', color: '#858991', fontSize: 14, lineHeight: '20px' },
  heroTitle: { margin: 0, fontSize: 26, lineHeight: '34px', letterSpacing: '-.035em', fontWeight: 650 },
  heroSubtitle: { display: 'block', marginTop: 12, color: '#7d818b', fontSize: 15, lineHeight: '22px' },
  column: { minHeight: 0, flex: 1, display: 'flex', flexDirection: 'column' },
  searchTopRow: { display: 'flex', alignItems: 'center', gap: 12, flex: 'none' },
  searchBox: { height: 50, flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 10, padding: '0 16px', boxSizing: 'border-box', border: `1px solid ${colors.border}`, borderRadius: 14, background: arkmeTheme.input, boxShadow: '0 5px 20px rgba(25,28,38,.035)' },
  searchIcon: { width: 22, height: 22, flex: 'none' },
  input: { flex: 1, minWidth: 0, height: '100%', border: 0, outline: 0, padding: 0, background: 'transparent', color: colors.text, font: 'inherit', fontSize: 15 },
  clear: { width: 40, height: 40, display: 'grid', placeItems: 'center', flex: 'none', padding: 0, border: 0, background: 'transparent', cursor: 'pointer' },
  close: { width: 40, height: 50, display: 'grid', placeItems: 'center', flex: 'none', padding: 0, border: 0, borderRadius: 10, background: 'transparent', color: colors.secondary, cursor: 'pointer' },
  scroll: { minHeight: 0, overflowY: 'visible' }, dialogScroll: { flex: 1, overflowY: 'auto', paddingRight: 2 },
  section: { margin: '28px 0 0' }, sectionHeader: { minHeight: 24, margin: '0 0 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }, sectionTitle: { margin: 0, color: colors.text, fontSize: 14, lineHeight: '22px', fontWeight: 600 },
  historyChips: { display: 'flex', flexWrap: 'wrap', gap: 10 }, historyChip: { minHeight: 40, padding: '0 15px', display: 'inline-flex', alignItems: 'center', border: 0, borderRadius: 12, background: colors.subtle, color: colors.secondary, cursor: 'pointer', font: 'inherit', fontSize: 13, lineHeight: '20px' },
  quickChips: { display: 'flex', flexWrap: 'wrap', gap: 10 }, quickChip: { minHeight: 44, padding: '0 16px', display: 'inline-flex', alignItems: 'center', gap: 8, border: `1px solid ${colors.border}`, borderRadius: 12, background: 'transparent', color: colors.secondary, cursor: 'pointer', font: 'inherit', fontSize: 13, lineHeight: '20px', fontWeight: 600 }, quickChipIcon: { width: 18, height: 18, display: 'block', flex: 'none' }, quickHint: { color: colors.tertiary, fontSize: 12, lineHeight: '20px', fontWeight: 400 },
  tabs: { display: 'flex', alignItems: 'flex-end', gap: 30, flex: 'none', marginTop: 20, borderBottom: `1px solid ${colors.border}` },
  tab: { position: 'relative', minHeight: 38, padding: '0 0 11px', border: 0, background: 'transparent', color: colors.text, cursor: 'pointer', font: 'inherit', fontSize: 14, whiteSpace: 'nowrap' }, tabActive: { fontWeight: 600 },
  indicator: { position: 'absolute', left: '50%', bottom: 5, width: 10, height: 2, marginLeft: -5, borderRadius: 22, background: colors.text },
  resultTabs: { display: 'flex', alignItems: 'flex-end', gap: 32, flex: 'none', marginTop: 20 },
  resultTab: { position: 'relative', minHeight: 42, display: 'inline-flex', alignItems: 'center', padding: '0 0 12px', border: 0, outline: 0, background: 'transparent', color: colors.secondary, cursor: 'pointer', font: 'inherit', fontSize: 14, whiteSpace: 'nowrap' },
  resultTabActive: { color: colors.text, fontWeight: 600 },
  resultIndicator: { position: 'absolute', left: '50%', bottom: 5, width: 16, height: 2, marginLeft: -8, borderRadius: 22, background: colors.text },
  resultFrame: { minHeight: 0, flex: 1, marginTop: 2, overflow: 'hidden', border: '1px solid rgba(60, 60, 67, .10)', borderRadius: 14, background: '#fbfbfc' },
  resultHeader: { margin: 0, padding: '14px 16px 8px', color: colors.tertiary, fontSize: 13, lineHeight: '20px', fontWeight: 500 },
  status: { padding: '54px 12px', textAlign: 'center', color: colors.secondary, fontSize: 13 },
  error: { margin: '14px 0 0', padding: '10px 12px', borderRadius: 8, background: arkmeTheme.dangerSoft, color: colors.danger, fontSize: 13 },
  list: { display: 'flex', flexDirection: 'column', gap: 4, padding: '0 7px 7px' }, row: { width: '100%', minWidth: 0, padding: '13px 12px', border: 0, borderRadius: 10, background: colors.panel, boxShadow: '0 1px 3px rgba(60,60,67,.035)', color: 'inherit', textAlign: 'left', cursor: 'pointer', font: 'inherit', boxSizing: 'border-box' },
  rowTop: { display: 'flex', alignItems: 'center', gap: 7 }, dshBadge: { flex: 'none', padding: '1px 5px', borderRadius: 5, background: colors.subtle, color: colors.secondary, fontSize: 9, lineHeight: '15px', fontWeight: 600 },
  title: { margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 14, lineHeight: '21px', fontWeight: 600 },
  text: { margin: '4px 0 0', display: '-webkit-box', overflow: 'hidden', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflowWrap: 'anywhere', color: colors.secondary, fontSize: 13, lineHeight: '20px' },
  meta: { display: 'block', marginTop: 6, color: arkmeTheme.caption, fontSize: 11, lineHeight: '16px' },
  metaLine: { display: 'flex', marginTop: 6, alignItems: 'center', gap: 4, color: arkmeTheme.caption, fontSize: 11, lineHeight: '16px' },
  dshAgentInputMarker: { fontSize: 11, lineHeight: '16px' },
  dshAgentInputIcon: { width: 10, height: 10, opacity: .72 },
  sourceLayout: { minHeight: 0, height: '100%', display: 'grid', gridTemplateColumns: 'minmax(220px, 34%) minmax(0, 1fr)', gap: 8, padding: 8, overflow: 'hidden', boxSizing: 'border-box' }, sourceList: { minHeight: 0, overflowY: 'auto', padding: '0 5px 5px', borderRadius: 11, background: colors.panel }, sourceResults: { minHeight: 0, overflowY: 'auto', borderRadius: 11, background: colors.panel },
  sourceRow: { position: 'relative', width: '100%', minWidth: 0, marginTop: 3, padding: '12px 13px', border: 0, borderRadius: 9, background: 'transparent', color: colors.text, textAlign: 'left', cursor: 'pointer', font: 'inherit', boxSizing: 'border-box' },
  sourceRowActive: { background: 'rgba(10, 132, 255, .075)' }, sourceMarker: { position: 'absolute', left: 0, top: 10, bottom: 10, width: 2, borderRadius: '0 4px 4px 0', background: '#0a84ff' },
  sourcePrompt: { padding: '62px 20px', textAlign: 'center', color: colors.tertiary, fontSize: 13 },
  quickShell: { width: '100%' },
  quickHeader: { width: '100%', flex: 'none' }, quickTopRow: { display: 'flex', alignItems: 'center', gap: 8 },
  back: { width: 32, height: 44, display: 'grid', placeItems: 'center', flex: 'none', padding: 0, border: 0, borderRadius: 8, background: 'transparent', cursor: 'pointer' },
  quickSearch: { height: 44, flex: 1, display: 'flex', alignItems: 'center', gap: 5, padding: '0 10px', boxSizing: 'border-box', border: '1px solid transparent', borderRadius: 12, background: colors.subtle }, quickSearchIcon: { width: 26, height: 26, flex: 'none' }, quickInput: { flex: 1, minWidth: 0, height: '100%', border: 0, outline: 0, padding: 0, background: 'transparent', color: colors.text, font: 'inherit', fontSize: 16 },
  quickBody: { paddingBottom: 40 },
  quickDialogBody: { minHeight: 0, flex: 1, overflowY: 'auto', overscrollBehaviorY: 'contain' },
  summary: { display: 'inline-block', margin: '12px 2px 4px', padding: '2px 8px', borderRadius: 4, background: colors.subtle, color: colors.secondary, fontSize: 10 }, month: { margin: '16px 2px 8px', fontSize: 13, fontWeight: 600 },
  mediaGrid: { display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 3 }, mediaButton: { position: 'relative', minWidth: 0, aspectRatio: '1', overflow: 'hidden', padding: 0, border: 0, borderRadius: 4, background: arkmeTheme.subtle, cursor: 'pointer' }, mediaImage: { width: '100%', height: '100%', display: 'block', objectFit: 'cover' }, play: { position: 'absolute', inset: 0, margin: 'auto', width: 38, height: 38, padding: 9, borderRadius: 999, background: 'rgba(0,0,0,.52)', boxSizing: 'border-box' }, duration: { position: 'absolute', right: 4, bottom: 4, padding: '1px 4px', borderRadius: 4, background: 'rgba(0,0,0,.58)', color: arkmeTheme.foreground, fontSize: 9 },
  imageSection: { marginTop: 12 }, imageSectionTitle: { margin: '0 0 6px 2px', color: colors.tertiary, fontSize: 12, lineHeight: '18px', fontWeight: 400 }, imageTile: { position: 'relative', minWidth: 0, aspectRatio: '1', overflow: 'hidden', padding: 0, border: 0, borderRadius: 0, background: arkmeTheme.subtle, cursor: 'pointer' },
  loadMoreSentinel: { minHeight: 44, display: 'grid', placeItems: 'center', marginTop: 8, color: colors.secondary, fontSize: 13 },
  retryLoadMore: { display: 'block', minWidth: 96, padding: '7px 16px', border: `1px solid ${colors.border}`, borderRadius: 8, background: colors.panel, color: colors.text, cursor: 'pointer', font: 'inherit', fontSize: 13 },
  audioRow: { minHeight: 58, margin: '0 7px 5px', padding: '12px 14px', borderRadius: 12, background: colors.panel, boxShadow: '0 1px 3px rgba(60,60,67,.035)', boxSizing: 'border-box' },
  audioNavigate: { minWidth: 0, color: colors.text, textAlign: 'left', cursor: 'pointer' },
  audioMeta: { display: 'block', marginTop: 5, color: colors.tertiary, fontSize: 11, lineHeight: '16px' },
  fileRow: { display: 'flex', alignItems: 'center', gap: 10, padding: '12px 8px', borderBottom: `1px solid ${colors.border}`, color: colors.text, textDecoration: 'none' }, fileIcon: { width: 38, height: 38, flex: 'none' }, fileText: { minWidth: 0, flex: 1 },
  linkCard: { display: 'block', marginTop: 10, padding: 12, border: `1px solid ${colors.border}`, borderRadius: 10, color: colors.text, textDecoration: 'none', overflow: 'hidden' },
  aiGrid: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12, marginTop: 12 }, aiCard: { minWidth: 0, overflow: 'hidden', border: `1px solid ${colors.border}`, borderRadius: 9 }, aiCover: { ...({ position: 'relative', width: '100%', aspectRatio: '16 / 9', display: 'grid', placeItems: 'center', overflow: 'hidden', padding: 0, border: 0, background: '#20242c', cursor: 'pointer' } as CSSProperties) }, aiBody: { padding: '9px 10px 11px' },
  modal: { position: 'fixed', inset: 0, zIndex: 10000, display: 'grid', placeItems: 'center', padding: 28, background: 'var(--dsw-alias-bg-mask-3, rgba(0,0,0,.55))' }, detail: { width: 'min(700px, 92vw)', maxHeight: '86vh', overflowY: 'auto', padding: 24, boxSizing: 'border-box', borderRadius: 14, background: colors.panel }, preview: { width: 'min(960px, 92vw)', maxHeight: '90vh', padding: 12, borderRadius: 14, background: '#111' }, previewMedia: { maxWidth: '100%', maxHeight: '78vh', display: 'block', margin: '0 auto', borderRadius: 8 }, closeText: { display: 'block', margin: '12px 0 0 auto', border: 0, borderRadius: 8, padding: '7px 12px', background: colors.subtle, color: colors.text, cursor: 'pointer' },
}

const quickEntries: Array<{ key: QuickKey; label: string; tabLabel: string }> = [
  { key: 'image', label: '图片', tabLabel: '图片库' },
  { key: 'ai_video', label: 'AI 视频', tabLabel: 'AI 视频' },
  { key: 'audio', label: '语音', tabLabel: '语音' },
]
type QuickKey = 'image' | 'ai_video' | 'audio'
type Preview = { kind: 'image' | 'video'; url: string; name: string; subtitle?: string }
type SearchResultTab = 'records' | 'topics' | 'recordings' | 'dsh'

export interface ArkmeDshMessageSearchItem {
  sessionId: string
  title: string
  snippet: string
  updatedAtMillis: number
}

export interface ArkmeDshMessageSearchResult {
  items: ArkmeDshMessageSearchItem[]
  hasMore: boolean
}

export interface ArkmeSearchSurfaceProps {
  variant?: 'page' | 'dialog'
  searchDshMessages?: (query: string, signal: AbortSignal) => Promise<ArkmeDshMessageSearchResult>
  onOpenDshSession?: (sessionId: string) => void
  onOpenRecord?: (item: ArkmeSearchRecordItem) => void
  onClose?: () => void
}

function errorMessage(error: unknown): string { return error instanceof ArkmeClientError ? error.body.message : error instanceof Error ? error.message : String(error) }
function dateTimeLabel(value: number): string { return Number.isFinite(value) && value > 0 ? new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)) : '' }
function displayUrl(item: ArkmeFileAssetDisplayItem | undefined): string { return item?.previewUrl || item?.downloadUrl || '' }
function mediaUrl(mediaRef: string): string { return `${mediaRoute}?ref=${encodeURIComponent(mediaRef)}` }
function imageMonthLabel(value: number): string {
  const date = new Date(value)
  if (!Number.isFinite(value) || value <= 0 || Number.isNaN(date.valueOf())) return '更早'
  const now = new Date()
  if (date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth()) return '这个月'
  return `${String(date.getFullYear())}年${String(date.getMonth() + 1).padStart(2, '0')}月`
}
function RecordMeta({ item }: { item: ArkmeSearchRecordItem }) {
  const dateLabel = dateTimeLabel(item.sendAtMillis)
  if (isDshAgentInputRecord(item)) {
    return <span style={styles.metaLine}>
      <ArkmeDshAgentInputMarker
        style={styles.dshAgentInputMarker}
        iconStyle={styles.dshAgentInputIcon}
      />
      {dateLabel === '' ? null : <span aria-hidden>·</span>}
      {dateLabel === '' ? null : <time>{dateLabel}</time>}
    </span>
  }
  return <span style={styles.meta}>{item.sourceTitle === undefined ? '' : `${item.sourceTitle} · `}{dateLabel}</span>
}
function normalizedSearchText(value: string): string { return value.replace(/\s+/g, ' ').trim() }
function recordTitle(item: ArkmeSearchRecordItem): string { return item.title || item.nickname || '快记' }
function recordSummary(item: ArkmeSearchRecordItem): string {
  const value = item.snippet || item.textContent || (item.media.length + item.files.length > 0 || item.voice !== undefined ? '媒体内容' : '暂无文字内容')
  return normalizedSearchText(value) === normalizedSearchText(recordTitle(item)) ? '' : value
}
export function RecordRow({ item, onClick }: { item: ArkmeSearchRecordItem; onClick(): void }) {
  if (item.voice !== undefined || item.templateKind === 3 || item.templateKind === 4) return <AudioQuickRow item={item} onOpen={onClick} />
  const summary = recordSummary(item)
  return <button type="button" style={styles.row} onClick={onClick}><p style={styles.title}>{recordTitle(item)}</p>{summary !== '' && <p style={styles.text}>{summary}</p>}<RecordMeta item={item} /></button>
}
function DshMessageRow({ item, onClick }: { item: ArkmeDshMessageSearchItem; onClick(): void }) {
  return <button type="button" style={styles.row} onClick={onClick}>
    <span style={styles.rowTop}><span style={styles.dshBadge}>DSH 任务</span><strong style={styles.title}>{item.title}</strong></span>
    <p style={styles.text}>{item.snippet}</p>
    <span style={styles.meta}>{dateTimeLabel(item.updatedAtMillis)}</span>
  </button>
}
function RecordingRow({ item }: { item: ArkmeRecordingSearchResult['items'][number] }) {
  return <button type="button" style={styles.row} onClick={() => arkmeUi.showRecordingTarget(item.dateStamp, item.startAtMillis)}>
    <p style={{ ...styles.text, marginTop: 0, color: colors.text }}>{item.snippet || '暂无转写内容'}</p>
    <span style={styles.meta}>{dateTimeLabel(item.startAtMillis || item.dateStamp)}</span>
  </button>
}
function AudioQuickRow({ item, asset, onOpen }: {
  item: ArkmeSearchRecordItem
  asset?: ArkmeFileAssetDisplayItem
  onOpen(): void
}) {
  const initialUrl = item.voice?.mediaRef === undefined ? displayUrl(asset) : mediaUrl(item.voice.mediaRef)
  const durationMillis = item.voice?.durationMillis ?? item.recordDurationMillis
  const transcript = item.snippet || item.textContent || '暂无转写内容'
  const sender = item.nickname || recordTitle(item)
  const resolveFromConversation = useCallback(async (signal: AbortSignal): Promise<string> => {
    if (item.targetSource === undefined) return ''
    let cursor: ArkmeTimelineCursor | undefined
    for (let pageIndex = 0; pageIndex < 80; pageIndex += 1) {
      if (signal.aborted) return ''
      const page = await callArkme<ArkmeTimelinePage>('source.timeline', {
        sourceRef: item.targetSource.sourceRef,
        limit: 100,
        ...(cursor === undefined ? {} : { cursor }),
      }, signal)
      if (signal.aborted) return ''
      const target = page.items.find(candidate => candidate.itemUid === item.recordUid)
      if (target !== undefined) {
        const contentBlocks = target.contentBlocks ?? []
        const audio = contentBlocks.find(block => block.kind === 'audio'
          && (item.voice?.fileAssetUid === undefined || block.fileAssetUid === item.voice.fileAssetUid))
        return audio === undefined ? '' : mediaUrl(audio.mediaRef)
      }
      if (!page.hasMore || page.nextCursor === undefined) return ''
      cursor = page.nextCursor
    }
    return ''
  }, [item])
  return <article style={styles.audioRow} data-arkme-search-voice="true">
    <div role="button" tabIndex={0} aria-label={`打开快记 ${recordTitle(item)}`} style={styles.audioNavigate}
      onClick={event => {
        if (event.target instanceof Element && event.target.closest('a') !== null) return
        onOpen()
      }}
      onKeyDown={event => {
        if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return
        event.preventDefault(); onOpen()
      }}
    >
      <ArkmeVoiceContent
        sourceKey={`${item.targetSource?.sourceRef ?? item.sourceUid ?? ''}:${item.recordUid}:${item.voice?.fileAssetUid ?? ''}`}
        src={initialUrl}
        durationSeconds={durationMillis === undefined ? undefined : durationMillis / 1000}
        resolveSrc={item.targetSource === undefined ? undefined : resolveFromConversation}
        downloadName={item.voice?.fileName}
        collapsible={transcript.length > 300 || transcript.split('\n').length > 5}
      ><ArkmeRichText text={transcript} /></ArkmeVoiceContent>
      {isDshAgentInputRecord(item) ? <RecordMeta item={item} /> : <span style={styles.audioMeta}>{sender}{item.sourceTitle === undefined ? '' : ` · ${item.sourceTitle}`}{dateTimeLabel(item.sendAtMillis) === '' ? '' : ` · ${dateTimeLabel(item.sendAtMillis)}`}</span>}
    </div>
  </article>
}
function Status({ loading, error, empty }: { loading: boolean; error?: string; empty?: boolean }) {
  if (loading) return <div style={styles.status} role="status">正在加载…</div>
  if (error !== undefined && error !== '') return <div style={styles.error}>{error}</div>
  return empty === true ? <div style={styles.status}>暂无相关内容</div> : null
}

export function ArkmeSearchSurface({
  variant = 'page', searchDshMessages, onOpenDshSession, onOpenRecord, onClose,
}: ArkmeSearchSurfaceProps = {}) {
  const [query, setQuery] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [records, setRecords] = useState<ArkmeRecordSearchResult>()
  const [recordings, setRecordings] = useState<ArkmeRecordingSearchResult>()
  const [dshMessages, setDshMessages] = useState<ArkmeDshMessageSearchResult>()
  const [resultTab, setResultTab] = useState<SearchResultTab>('records')
  const [selectedSourceUid, setSelectedSourceUid] = useState('')
  const [sourceRecords, setSourceRecords] = useState<ArkmeSearchRecordItem[]>([])
  const [quick, setQuick] = useState<QuickKey>()
  const [images, setImages] = useState<ArkmeImageSearchItem[]>()
  const [imageCursor, setImageCursor] = useState('')
  const [imageHasMore, setImageHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [videos, setVideos] = useState<ArkmeAiVideoListItem[]>()
  const [audioRecords, setAudioRecords] = useState<ArkmeSearchRecordItem[]>()
  const [assets, setAssets] = useState<Map<string, ArkmeFileAssetDisplayItem>>(() => new Map())
  const [resolvedAssetUids, setResolvedAssetUids] = useState<Set<string>>(() => new Set())
  const [preview, setPreview] = useState<Preview>()
  const [loading, setLoading] = useState(false)
  const [sourceLoading, setSourceLoading] = useState(false)
  const [recordError, setRecordError] = useState('')
  const [recordingError, setRecordingError] = useState('')
  const [dshError, setDshError] = useState('')
  const requestId = useRef(0)
  const quickRef = useRef<QuickKey>()
  const searchAbort = useRef<AbortController>()
  const quickRequestAbort = useRef<AbortController>()
  const imageLoadMoreSentinel = useRef<HTMLDivElement>(null)
  const quickScroll = useRef<HTMLElement>(null)
  const imageLoadMoreInFlight = useRef(false)

  useEffect(() => { void callArkme<ArkmeSearchHistoryResult>('search.history', { limit: 10 }).then(value => setHistory(value.items.map(item => item.keyword))).catch(() => undefined) }, [])
  const resetResults = useCallback(() => { searchAbort.current?.abort(); searchAbort.current = undefined; requestId.current += 1; setRecords(undefined); setRecordings(undefined); setDshMessages(undefined); setSelectedSourceUid(''); setSourceRecords([]); setRecordError(''); setRecordingError(''); setDshError(''); setLoading(false); setSourceLoading(false) }, [])

  const runSearch = useCallback(async (raw: string) => {
    const keyword = raw.trim()
    if (keyword === '') { resetResults(); return }
    const id = ++requestId.current
    searchAbort.current?.abort()
    const controller = new AbortController()
    searchAbort.current = controller
    setLoading(true); setRecordError(''); setRecordingError(''); setDshError('')
    const [recordResult, recordingResult, dshResult] = await Promise.allSettled([
      callArkme<ArkmeRecordSearchResult>('search.records', { query: keyword, limit: 50 }, controller.signal),
      quickRef.current !== undefined ? Promise.resolve(undefined) : callArkme<ArkmeRecordingSearchResult>('search.recordings', { query: keyword, limit: 50 }, controller.signal),
      quickRef.current !== undefined || searchDshMessages === undefined ? Promise.resolve(undefined) : searchDshMessages(keyword, controller.signal),
    ])
    if (id !== requestId.current || controller.signal.aborted) return
    const nextRecords = recordResult.status === 'fulfilled' ? recordResult.value : undefined
    setRecords(nextRecords)
    setRecordings(recordingResult.status === 'fulfilled' ? recordingResult.value : undefined)
    setRecordingError(recordingResult.status === 'rejected' ? errorMessage(recordingResult.reason) : '')
    setRecordError(recordResult.status === 'rejected' ? errorMessage(recordResult.reason) : '')
    setDshMessages(dshResult.status === 'fulfilled' ? dshResult.value : undefined)
    setDshError(dshResult.status === 'rejected' ? errorMessage(dshResult.reason) : '')
    const firstSource = nextRecords?.sourceAggregates[0]
    setSelectedSourceUid(firstSource?.sourceUid ?? '')
    setSourceRecords(firstSource === undefined ? [] : nextRecords?.items.filter(item => item.sourceUid === firstSource.sourceUid) ?? [])
    setLoading(false)
    if (searchAbort.current === controller) searchAbort.current = undefined
    void callArkme('search.history.create', { query: keyword }).catch(() => undefined)
    setHistory(current => [keyword, ...current.filter(value => value !== keyword)].slice(0, 10))
  }, [resetResults, searchDshMessages])

  const chooseSource = useCallback(async (sourceUid: string, sourceKind: number) => {
    const keyword = query.trim()
    if (keyword === '') return
    setSelectedSourceUid(sourceUid)
    const cached = (records?.items ?? []).filter(item => item.sourceUid === sourceUid)
    setSourceRecords(cached)
    setSourceLoading(true)
    try {
      const result = await callArkme<ArkmeRecordSearchResult>('search.records', {
        query: keyword, limit: 50, sourceUid, searchScope: sourceKind === 2 ? 'topic' : 'chat_session',
      })
      setSourceRecords(result.items)
    } catch (caught) { setRecordError(errorMessage(caught)) }
    finally { setSourceLoading(false) }
  }, [query, records])

  useEffect(() => { if (query.trim() === '') { resetResults(); return }; const timer = window.setTimeout(() => { void runSearch(query) }, 300); return () => window.clearTimeout(timer) }, [query, resetResults, runSearch])

  const loadQuick = useCallback(async (value: QuickKey) => {
    searchAbort.current?.abort()
    searchAbort.current = undefined
    quickRequestAbort.current?.abort()
    quickRequestAbort.current = undefined
    const hasCachedPage = value === 'image' ? images !== undefined : value === 'ai_video' ? videos !== undefined : audioRecords !== undefined
    const id = ++requestId.current
    quickRef.current = value
    setQuick(value); setQuery(''); setRecords(undefined); setRecordings(undefined); setDshMessages(undefined); setSelectedSourceUid(''); setSourceRecords([]); setRecordError(''); setRecordingError(''); setDshError('')
    if (hasCachedPage) { setLoading(false); return }
    const controller = new AbortController()
    quickRequestAbort.current = controller
    const timeout = window.setTimeout(() => controller.abort(), 20_000)
    setLoading(true)
    try {
      if (value === 'image') {
        const result = await callArkme<ArkmeImageSearchResult>('images.list', { limit: 50 }, controller.signal)
        if (id === requestId.current) { setImages(result.items); setImageCursor(result.nextCursor ?? ''); setImageHasMore(result.hasMore) }
      } else if (value === 'ai_video') {
        const result = await callArkme<ArkmeAiVideoListResult>('ai-video.list', { limit: 30 }, controller.signal)
        if (id === requestId.current) setVideos(result.items)
      } else {
        const result = await callArkme<ArkmeRecordSearchResult>('search.scene', { scene: 'audio', limit: 50 }, controller.signal)
        if (id === requestId.current) setAudioRecords(result.items)
      }
    } catch (caught) { if (id === requestId.current) setRecordError(controller.signal.aborted ? '加载超时，请重试' : errorMessage(caught)) }
    finally {
      window.clearTimeout(timeout)
      if (quickRequestAbort.current === controller) quickRequestAbort.current = undefined
      if (id === requestId.current) setLoading(false)
    }
  }, [audioRecords, images, videos])

  const loadMoreImages = useCallback(async () => {
    if (imageLoadMoreInFlight.current || !imageHasMore || imageCursor === '') return
    imageLoadMoreInFlight.current = true
    setLoadingMore(true); setRecordError('')
    try {
      const result = await callArkme<ArkmeImageSearchResult>('images.list', { limit: 50, cursor: imageCursor })
      setImages(current => {
        const byKey = new Map((current ?? []).map(item => [item.itemKey, item]))
        for (const item of result.items) byKey.set(item.itemKey, item)
        return [...byKey.values()]
      })
      setImageCursor(result.nextCursor ?? '')
      setImageHasMore(result.hasMore)
    } catch (caught) { setRecordError(errorMessage(caught)) }
    finally { imageLoadMoreInFlight.current = false; setLoadingMore(false) }
  }, [imageCursor, imageHasMore])

  useEffect(() => {
    const target = imageLoadMoreSentinel.current
    if (loading || query.trim() !== '' || quick !== 'image' || target === null || !imageHasMore || imageCursor === '' || recordError !== '') return
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) void loadMoreImages()
    }, { root: variant === 'dialog' ? quickScroll.current : null, rootMargin: '240px 0px' })
    observer.observe(target)
    return () => observer.disconnect()
  }, [imageCursor, imageHasMore, loadMoreImages, loading, query, quick, recordError, variant])

  const leaveQuick = useCallback(() => { quickRequestAbort.current?.abort(); quickRequestAbort.current = undefined; searchAbort.current?.abort(); searchAbort.current = undefined; requestId.current += 1; quickRef.current = undefined; setQuick(undefined); setQuery(''); setRecords(undefined); setRecordings(undefined); setDshMessages(undefined); setSelectedSourceUid(''); setSourceRecords([]); setImages(undefined); setImageCursor(''); setImageHasMore(false); setVideos(undefined); setAudioRecords(undefined); setRecordError(''); setRecordingError(''); setDshError(''); setLoading(false); setLoadingMore(false) }, [])
  useEffect(() => () => { quickRequestAbort.current?.abort(); searchAbort.current?.abort() }, [])
  useEffect(() => {
    const videoAssets = (videos ?? []).flatMap(item => [item.coverAssetUid, item.videoAssetUid]).filter((value): value is string => value !== undefined)
    const audioAssets = (audioRecords ?? []).flatMap(item => item.voice === undefined || item.voice.mediaRef !== undefined ? [] : [item.voice.fileAssetUid])
    const uids = [...new Set([...videoAssets, ...audioAssets])].filter(uid => !resolvedAssetUids.has(uid))
    if (uids.length === 0) return
    let active = true
    void callArkme<ArkmeFileAssetDisplayItem[]>('files.assets', { fileAssetUids: uids }).then(items => { if (!active) return; setAssets(current => { const next = new Map(current); for (const item of items) next.set(item.fileAssetUid, item); return next }); setResolvedAssetUids(current => new Set([...current, ...uids])) }).catch(() => { if (active) setResolvedAssetUids(current => new Set([...current, ...uids])) })
    return () => { active = false }
  }, [audioRecords, resolvedAssetUids, videos])

  const openRecord = useCallback((item: ArkmeSearchRecordItem) => {
    if (onOpenRecord !== undefined) { onOpenRecord(item); return }
    if (item.targetSource !== undefined) arkmeUi.showConversationTarget(item.targetSource, item.recordUid, item.sendAtMillis)
  }, [onOpenRecord])

  const quickBody = useMemo<ReactNode>(() => {
    if (quick === undefined) return null
    if (loading || (recordError !== '' && quick !== 'image')) return <Status loading={loading} error={recordError} />
    if (quick === 'image') {
      const items = images ?? []
      const loadMoreSentinel = imageHasMore && <div ref={imageLoadMoreSentinel} style={styles.loadMoreSentinel}>{recordError !== '' ? <button type="button" style={styles.retryLoadMore} onClick={() => { void loadMoreImages() }}>重试加载</button> : loadingMore ? '正在加载…' : null}</div>
      if (items.length === 0) return <><Status loading={false} error={recordError} empty={recordError === ''} />{loadMoreSentinel}</>
      const sections = new Map<string, ArkmeImageSearchItem[]>()
      for (const item of items) {
        const label = imageMonthLabel(item.sendAtMillis)
        sections.set(label, [...(sections.get(label) ?? []), item])
      }
      return <>{[...sections].map(([label, sectionItems]) => <section key={label} style={styles.imageSection}><h3 style={styles.imageSectionTitle}>{label}</h3><div style={styles.mediaGrid}>{sectionItems.map(item => <button key={item.itemKey} type="button" style={styles.imageTile} title={item.recordTitle} onClick={() => setPreview({ kind: 'image', url: mediaUrl(item.mediaRef), name: item.fileName, subtitle: [item.sourceTitle, dateTimeLabel(item.sendAtMillis)].filter(Boolean).join(' · ') })}><img src={mediaUrl(item.mediaRef)} alt={item.fileName} loading="lazy" style={styles.mediaImage} /></button>)}</div></section>)}{recordError !== '' && <div style={styles.error}>{recordError}</div>}{loadMoreSentinel}</>
    }
    if (quick === 'audio') {
      const items = audioRecords ?? []
      if (items.length === 0) return <Status loading={false} empty />
      return <div style={{ paddingTop: 12 }}>{items.map(item => {
        const asset = item.voice === undefined ? undefined : assets.get(item.voice.fileAssetUid)
        return <AudioQuickRow key={item.recordUid} item={item} {...(asset === undefined ? {} : { asset })} onOpen={() => { openRecord(item) }} />
      })}</div>
    }
    const items = videos ?? []
    if (items.length === 0) return <Status loading={false} empty />
    return <div style={styles.aiGrid}>{items.map(item => {
        const cover = item.coverAssetUid === undefined ? '' : displayUrl(assets.get(item.coverAssetUid))
        const video = item.videoAssetUid === undefined ? '' : displayUrl(assets.get(item.videoAssetUid))
        return <article key={item.jobId} style={styles.aiCard}><button type="button" style={styles.aiCover} disabled={item.status !== 'succeeded' || video === ''} onClick={() => setPreview({ kind: 'video', url: video, name: item.title })}>{cover !== '' && <img src={cover} alt="" style={styles.mediaImage} />}{item.status === 'succeeded' ? <img src={`${assetRoot}/video_play_white.svg`} alt="" style={styles.play} /> : <span style={{ color: '#fff', fontSize: 12 }}>{item.status === 'failed' ? '生成失败' : `生成中 ${String(item.progress)}%`}</span>}</button><div style={styles.aiBody}><p style={styles.title}>{item.title}</p><span style={styles.meta}>{dateTimeLabel(item.sourceStartedAtMillis || item.createdAtMillis)}</span></div></article>
      })}</div>
  }, [assets, audioRecords, imageHasMore, images, loading, loadingMore, loadMoreImages, openRecord, quick, recordError, videos])

  const hasQuery = query.trim() !== ''
  const recordItems = records?.items ?? []
  const recordingItems = recordings?.items ?? []
  const sourceItems = records?.sourceAggregates ?? []
  const dshItems = dshMessages?.items ?? []
  const resultTabs: Array<[SearchResultTab, string]> = [
    ['records', '快记'], ['topics', '主题'], ['recordings', '录音·转写'],
    ...(searchDshMessages === undefined ? [] : [['dsh', 'DSH'] as [SearchResultTab, string]]),
  ]
  const searchResults = <>
    <nav style={styles.resultTabs} aria-label="全局搜索结果类型">
      {resultTabs.map(([key, label]) => <button
        key={key} type="button" style={{ ...styles.resultTab, ...(resultTab === key ? styles.resultTabActive : {}) }}
        onClick={() => setResultTab(key)}
      >{label}{resultTab === key && <span style={styles.resultIndicator} />}</button>)}
    </nav>
    <div style={{ ...styles.resultFrame, ...(variant === 'dialog' ? { flex: 1 } : {}) }}>
      {loading ? <Status loading /> : resultTab === 'records' ? <div style={{ height: '100%', overflowY: 'auto' }} aria-label="快记搜索结果">
        <h3 style={styles.resultHeader}>{String(records?.itemCount ?? recordItems.length)}个关联快记</h3>
        {recordError !== '' ? <div style={styles.error}>快记暂不可用：{recordError}</div>
          : recordItems.length > 0 ? <div style={styles.list}>{recordItems.map(item => <RecordRow key={item.recordUid} item={item} onClick={() => { openRecord(item) }} />)}</div>
            : <Status loading={false} empty />}
      </div> : resultTab === 'topics' ? <div style={styles.sourceLayout} aria-label="主题搜索结果">
        <div style={styles.sourceList}>
          <h3 style={styles.resultHeader}>{String(sourceItems.length)}个关联主题</h3>
          {recordError !== '' ? <div style={styles.error}>主题暂不可用：{recordError}</div> : sourceItems.length === 0 ? <Status loading={false} empty /> : sourceItems.map(item => {
            const active = selectedSourceUid === item.sourceUid
            return <button key={`${String(item.sourceKind)}:${item.sourceUid}`} type="button" style={{ ...styles.sourceRow, ...(active ? styles.sourceRowActive : {}) }} onClick={() => { void chooseSource(item.sourceUid, item.sourceKind) }}>
              {active && <span style={styles.sourceMarker} />}
              <p style={styles.title}>{item.title}</p>
              <span style={styles.meta}>{item.matchedRecordCountExact ? item.matchedRecordCount : `约 ${String(item.matchedRecordCount)}`}条关联快记</span>
            </button>
          })}
        </div>
        <div style={styles.sourceResults}>
          <h3 style={styles.resultHeader}>记录详情</h3>
          {selectedSourceUid === '' ? <div style={styles.sourcePrompt}>选择一个主题查看关联快记</div>
            : sourceLoading ? <Status loading />
              : sourceRecords.length > 0 ? <div style={styles.list}>{sourceRecords.map(item => <RecordRow key={item.recordUid} item={item} onClick={() => { openRecord(item) }} />)}</div>
                : <Status loading={false} empty />}
        </div>
      </div> : resultTab === 'recordings' ? <div style={{ height: '100%', overflowY: 'auto' }} aria-label="录音转写搜索结果">
        <h3 style={styles.resultHeader}>{String(recordingItems.length)}个关联录音</h3>
        {recordingError !== '' ? <div style={styles.error}>录音·转写暂不可用：{recordingError}</div>
          : recordingItems.length > 0 ? <div style={styles.list}>{recordingItems.map(item => <RecordingRow key={`${item.sessionId}:${String(item.startAtMillis)}`} item={item} />)}</div>
            : <Status loading={false} empty />}
      </div> : <div style={{ height: '100%', overflowY: 'auto' }} aria-label="DSH 搜索结果">
        <h3 style={styles.resultHeader}>{String(dshItems.length)}个关联DSH任务</h3>
        {dshError !== '' ? <div style={styles.error}>DSH 任务暂不可用：{dshError}</div>
          : dshItems.length > 0 ? <div style={styles.list}>{dshItems.map(item => <DshMessageRow key={item.sessionId} item={item} onClick={() => onOpenDshSession?.(item.sessionId)} />)}</div>
            : <Status loading={false} empty />}
      </div>}
    </div>
  </>

  return <div style={variant === 'dialog' ? styles.dialogShell : styles.shell}>
    {variant === 'page' && <header style={styles.hero}>
      <h1 style={styles.heroTitle}>一句话，找到所有内容</h1>
    </header>}
    {quick === undefined ? <div style={styles.column}>
      <div style={styles.searchTopRow}>
        <div style={styles.searchBox}>
          <MagnifyingGlass size={20} color="#a3a7af" aria-hidden />
          <input autoFocus style={styles.input} value={query} placeholder="搜索对话、快记或消息" aria-label="搜索" onChange={event => setQuery(event.target.value)} />
          {query !== '' && <button type="button" aria-label="清空搜索" style={styles.clear} onClick={() => setQuery('')}><img src={`${assetRoot}/icon_close_round_bold.svg`} alt="" width={16} height={16} /></button>}
        </div>
        {onClose !== undefined && <button type="button" aria-label="关闭全局搜索" style={styles.close} onClick={onClose}><X size={21} aria-hidden /></button>}
      </div>
      {!hasQuery ? <div style={{ ...styles.scroll, ...(variant === 'dialog' ? styles.dialogScroll : {}) }}>
        {history.length > 0 && <section style={styles.section} aria-label="搜索历史">
          <div style={styles.sectionHeader}><h3 style={styles.sectionTitle}>搜索历史</h3></div>
          <div style={styles.historyChips}>{history.map(value => <button key={value} type="button" style={styles.historyChip} onClick={() => setQuery(value)}>{value}</button>)}</div>
        </section>}
        <section style={styles.section} aria-label="快速查找">
          <div style={styles.sectionHeader}><h3 style={styles.sectionTitle}>快速查找</h3><span style={styles.quickHint}>按内容类型浏览</span></div>
          <div style={styles.quickChips}>{quickEntries.map(entry => <button key={entry.key} type="button" style={styles.quickChip} onClick={() => { void loadQuick(entry.key) }}>{entry.key === 'audio' ? <Waveform size={18} aria-hidden /> : <img src={`${assetRoot}/${entry.key === 'image' ? 'gallery-linear.svg' : 'arkme-video-linear.svg'}`} alt="" aria-hidden style={styles.quickChipIcon} />}<span>{entry.label}</span></button>)}</div>
        </section>
      </div> : searchResults}
    </div> : <div style={{ ...styles.quickShell, ...(variant === 'dialog' ? styles.column : {}) }}>
      <header style={styles.quickHeader}>
        <div style={styles.quickTopRow}><button type="button" aria-label="返回搜索" title="返回搜索" style={styles.back} onClick={leaveQuick}><img src={`${assetRoot}/arrow_left.svg`} alt="" width={20} height={20} /></button><div style={styles.quickSearch}><MagnifyingGlass size={20} color="#a3a7af" aria-hidden /><input autoFocus style={styles.quickInput} value={query} placeholder="搜索快记" aria-label="搜索快记" onChange={event => setQuery(event.target.value)} />{query !== '' && <button type="button" aria-label="清空搜索" style={styles.clear} onClick={() => setQuery('')}><img src={`${assetRoot}/icon_close_round_bold.svg`} alt="" width={16} height={16} /></button>}</div>{onClose !== undefined && <button type="button" aria-label="关闭全局搜索" style={styles.close} onClick={onClose}><X size={21} aria-hidden /></button>}</div>
        <div style={styles.tabs}>{hasQuery
          ? <button type="button" style={{ ...styles.tab, ...styles.tabActive }}>搜索快记<span style={styles.indicator} /></button>
          : quickEntries.map(entry => {
            const active = quick === entry.key
            return <button key={entry.key} type="button" style={{ ...styles.tab, ...(active ? styles.tabActive : {}) }} onClick={() => { if (!active) void loadQuick(entry.key) }}>{entry.tabLabel}{active && <span style={styles.indicator} />}</button>
          })}
        </div>
      </header>
      <main key={quick} ref={quickScroll} aria-label="快速查找内容" tabIndex={variant === 'dialog' ? 0 : undefined} style={{ ...styles.quickBody, ...(variant === 'dialog' ? styles.quickDialogBody : {}) }}>{hasQuery ? <>{loading ? <Status loading /> : recordError !== '' ? <Status loading={false} error={recordError} /> : recordItems.length === 0 ? <Status loading={false} empty /> : <div style={styles.list}>{recordItems.map(item => <RecordRow key={item.recordUid} item={item} onClick={() => { openRecord(item) }} />)}</div>}</> : quickBody}</main>
    </div>}
    {preview !== undefined && <div style={styles.modal} role="dialog" aria-modal="true" onClick={() => setPreview(undefined)}><div style={styles.preview} onClick={event => event.stopPropagation()}>{preview.kind === 'video' ? <video src={preview.url} controls autoPlay style={styles.previewMedia} /> : <img src={preview.url} alt={preview.name} style={styles.previewMedia} />}{preview.subtitle !== undefined && preview.subtitle !== '' && <span style={{ ...styles.meta, color: '#c7cbd1', textAlign: 'center' }}>{preview.subtitle}</span>}<button type="button" style={styles.closeText} onClick={() => setPreview(undefined)}>关闭</button></div></div>}
  </div>
}

export function ArkmeGlobalSearchDialog({
  searchDshMessages, onOpenDshSession, onOpenRecord, onClose,
}: Required<Pick<ArkmeSearchSurfaceProps, 'onClose'>> & Omit<ArkmeSearchSurfaceProps, 'variant' | 'onClose'>) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [onClose])
  return <div style={styles.dialogOverlay} role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section style={styles.dialogPanel} role="dialog" aria-modal="true" aria-label="全局搜索">
      <ArkmeSearchSurface
        variant="dialog"
        {...(searchDshMessages === undefined ? {} : { searchDshMessages })}
        {...(onOpenDshSession === undefined ? {} : { onOpenDshSession })}
        {...(onOpenRecord === undefined ? {} : { onOpenRecord })}
        onClose={onClose}
      />
    </section>
  </div>
}
