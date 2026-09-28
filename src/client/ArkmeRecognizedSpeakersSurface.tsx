import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { ArkmeDirectoryPage, ArkmeRecordingSpeakerCandidate, ArkmeRecordingSpeakerMembers, ArkmeRecordingSpeakerPresence } from '../types.js'
import { callArkme } from './api.js'
import { ArkmeUserAvatar } from './ArkmeAvatar.js'
import { arkmeTheme } from './arkme-theme.js'
import { tr, useArkmeLocale } from './locale.js'
import { UnmarkedSpeakerDetail } from './redesign/contacts/UnmarkedSpeakerDetail.js'
import { UnmarkedSpeakerTokenAvatar } from './redesign/contacts/UnmarkedSpeakerVisuals.js'
import { compareRecognizedSpeakers, readRecognizedSpeakerOrder, writeRecognizedSpeakerOrder, type RecognizedSpeakerOrder } from './recognized-speaker-order.js'
import { recognizedSpeakerTracker } from './recognized-speaker-tracker.js'
import { SpeakerSelfGuide } from './recordings/SpeakerSelfGuide.js'
import { RecognizedSpeakerDirectory, recognizedSpeakerDirectory, readSpeakerOptions as defaultLoadMarked, readSpeakerPage as defaultLoadUnmarked, readSpeakerPresence as defaultLoadPresence, speakerRetryDelay } from './recognized-speaker-directory.js'

type SpeakerFilter = 'all' | 'marked' | 'unmarked'
type UnmarkedSpeaker = Extract<ArkmeDirectoryPage['items'][number], { kind: 'unmarked-speaker' }>
export type IdentifiedSpeakerRow =
  | { kind: 'marked'; key: string; optionKey: string; speakerRef: string; name: string; avatarRef?: string; isCurrentUser: boolean }
  | { kind: 'unmarked'; key: string; name: string; token: string; subtitle: string; candidateRef: string; dayCount?: number | undefined; lastSeenAt?: number | undefined }

/** Group only by a stable owner identity, never by a shared name or speaker number. */
export function identifiedSpeakerRows(
  options: readonly ArkmeRecordingSpeakerCandidate[],
  candidates: readonly UnmarkedSpeaker[],
): IdentifiedSpeakerRow[] {
  const marked = new Map<string, Extract<IdentifiedSpeakerRow, { kind: 'marked' }>>()
  for (const option of options) {
    if (option.kind !== 'speaker') continue
    const key = option.personKey || option.optionKey
    if (marked.has(key)) continue
    marked.set(key, {
      kind: 'marked', key, optionKey: option.optionKey, speakerRef: option.speakerRef,
      name: option.label.trim() || '未命名说话人',
      ...(option.avatarRef === undefined ? {} : { avatarRef: option.avatarRef }),
      isCurrentUser: option.isCurrentUser,
    })
  }
  const unmarked = new Map<string, Extract<IdentifiedSpeakerRow, { kind: 'unmarked' }>>()
  for (const candidate of candidates) {
    if (unmarked.has(candidate.candidateRef)) continue
    unmarked.set(candidate.candidateRef, {
      kind: 'unmarked', key: candidate.candidateRef,
      name: tr('说话人 {v0}', { v0: candidate.speakerToken?.trim() || candidate.displayName }),
      token: candidate.speakerToken?.trim() || '', subtitle: candidate.subtitle,
      candidateRef: candidate.candidateRef,
      dayCount: candidate.appearanceDays, lastSeenAt: candidate.latestAtMillis,
    })
  }
  return [
    ...[...marked.values()].sort((left, right) => left.name.localeCompare(right.name)),
    ...unmarked.values(),
  ]
}

const styles: Record<string, CSSProperties> = {
  root: { flex: 1, minWidth: 0, minHeight: 0, height: '100%', overflow: 'auto', containerType: 'inline-size', background: arkmeTheme.base, color: arkmeTheme.text },
  inner: { width: 'min(1040px, calc(100% - 32px))', margin: '0 auto', padding: '28px 0 48px' },
  header: { display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginBottom: 22 },
  title: { margin: 0, fontSize: 26, lineHeight: '34px', fontWeight: 650 },
  subhead: { margin: '4px 0 0', color: arkmeTheme.secondary, fontSize: 13 },
  button: { minHeight: 34, padding: '6px 10px', border: `1px solid ${arkmeTheme.border}`, borderRadius: 9, background: arkmeTheme.base, color: arkmeTheme.text, cursor: 'pointer', font: 'inherit', fontSize: 13 },
  filters: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 14 },
  filter: { minHeight: 32, padding: '5px 12px', border: 0, borderRadius: 9, background: 'transparent', color: arkmeTheme.secondary, font: 'inherit', cursor: 'pointer' },
  selectedFilter: { background: arkmeTheme.layer2, color: arkmeTheme.text, fontWeight: 600 },
  search: { flex: 1, minWidth: 160, height: 36, marginLeft: 'auto', padding: '0 12px', border: `1px solid ${arkmeTheme.border}`, borderRadius: 9, outlineColor: arkmeTheme.accent, background: arkmeTheme.input, color: arkmeTheme.text, font: 'inherit', fontSize: 13 },
  sort: { flex: 'none', height: 36, maxWidth: '100%', padding: '0 9px', border: `1px solid ${arkmeTheme.border}`, borderRadius: 9, background: arkmeTheme.base, color: arkmeTheme.text, font: 'inherit', fontSize: 13, cursor: 'pointer' },
  list: { minWidth: 0, margin: 0, padding: 0, listStyle: 'none' },
  row: { width: '100%', minHeight: 64, display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', boxSizing: 'border-box', border: 0, borderBottom: `1px solid ${arkmeTheme.borderSoft}`, borderRadius: 8, background: 'transparent', color: arkmeTheme.text, textAlign: 'left', font: 'inherit' },
  copy: { minWidth: 0, flex: 1, display: 'grid', gap: 3 },
  name: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 14, fontWeight: 600 },
  meta: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: arkmeTheme.secondary, fontSize: 12 },
  badge: { flex: 'none', color: arkmeTheme.secondary, fontSize: 12 },
  state: { padding: '24px 12px', color: arkmeTheme.secondary, textAlign: 'center', fontSize: 13 },
  note: { margin: '0 0 12px', padding: '0 12px', color: arkmeTheme.secondary, fontSize: 12 },
  error: { padding: '10px 12px', marginBottom: 8, borderRadius: 8, background: arkmeTheme.dangerSoft, color: arkmeTheme.danger, fontSize: 13 },
  detail: { minWidth: 0, padding: '18px 20px', boxSizing: 'border-box', border: `1px solid ${arkmeTheme.border}`, borderRadius: 12, background: arkmeTheme.layer1 },
  detailTitle: { margin: '0 0 6px', fontSize: 19, fontWeight: 650 },
  detailSection: { margin: '24px 0 8px', fontSize: 14, fontWeight: 650 },
  memberRow: { display: 'flex', alignItems: 'center', gap: 11, padding: '10px 0', borderBottom: `1px solid ${arkmeTheme.borderSoft}` },
}

export interface ArkmeRecognizedSpeakersSurfaceProps {
  accountKey: string
  onBack(): void
  loadMarked?: (signal: AbortSignal) => Promise<ArkmeRecordingSpeakerCandidate[]>
  loadPresence?: (signal: AbortSignal) => Promise<ArkmeRecordingSpeakerPresence>
  loadMarkedMembers?: (speakerRef: string, signal: AbortSignal, expectedVersion?: string) => Promise<ArkmeRecordingSpeakerMembers>
  loadUnmarked?: (cursor: string, signal: AbortSignal) => Promise<ArkmeDirectoryPage>
  directory?: RecognizedSpeakerDirectory
}

const defaultLoadMarkedMembers = async (speakerRef: string, signal: AbortSignal, expectedVersion?: string) => await callArkme<ArkmeRecordingSpeakerMembers>(
  'recordings.speaker.members', { speakerRef, ...(expectedVersion === undefined ? {} : { expectedVersion }) }, signal,
)

function failureMessage(error: unknown): string {
  return error instanceof Error && error.message.trim() !== '' ? error.message : tr('说话人列表暂时无法加载')
}

function markedPresenceLabel(stat: ArkmeRecordingSpeakerPresence['items'][number] | undefined, result: ArkmeRecordingSpeakerPresence | undefined, loading: boolean, error: string): string {
  if (loading || result?.state === 'building') return tr('出现统计整理中')
  if (error !== '' || result?.state === 'failed' || result === undefined) return tr('出现统计暂不可用')
  if (result.state === 'stale') return tr('出现统计更新中')
  if (stat !== undefined) {
    const date = new Date(stat.lastSeenAt)
    if (!Number.isNaN(date.getTime())) {
      const two = (value: number) => String(value).padStart(2, '0')
      const recent = `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`
      return tr('出现 {v0} 天 · 最近 {v1}', { v0: stat.dayCount, v1: recent })
    }
  }
  return tr('暂无可统计的录音片段')
}

function MarkedSpeakerDetail({ accountKey, speaker, loadMembers, version, onVersionChanged }: {
  version?: string | undefined
  onVersionChanged: () => void
  accountKey: string
  speaker: Extract<IdentifiedSpeakerRow, { kind: 'marked' }>
  loadMembers: (speakerRef: string, signal: AbortSignal, expectedVersion?: string) => Promise<ArkmeRecordingSpeakerMembers>
}) {
  const [state, setState] = useState<{ loading: boolean; result?: ArkmeRecordingSpeakerMembers; error: string }>({ loading: true, error: '' })
  useEffect(() => {
    const controller = new AbortController()
    setState({ loading: true, error: '' })
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = async () => {
      try {
        const result = await loadMembers(speaker.speakerRef, controller.signal, version)
        if (controller.signal.aborted) return
        setState({ loading: false, result, error: '' })
        if (result.state === 'stale' && result.version !== undefined && result.version !== version) onVersionChanged()
        if (result.state !== 'fresh') timer = setTimeout(() => { void load() }, Math.max(5_000, result.retryAfterMs ?? 10_000))
      } catch (error) {
        if (!controller.signal.aborted) setState({ loading: false, error: failureMessage(error) })
      }
    }
    void load()
    return () => { clearTimeout(timer); controller.abort() }
  }, [accountKey, speaker.speakerRef, loadMembers, version, onVersionChanged])

  return <section aria-label={tr('已标记说话人详情')}>
    <h2 style={styles.detailTitle}>{speaker.name}{speaker.isCurrentUser ? ` · ${tr('我')}` : ''}</h2>
    <p style={{ ...styles.meta, margin: 0 }}>{tr('查看已确认归属的原始识别身份')}</p>
    <h3 style={styles.detailSection}>{tr('对应的识别说话人')}</h3>
    <p style={{ ...styles.meta, margin: '0 0 8px', whiteSpace: 'normal' }}>{tr('展示全部历史已转写片段中可核实的关联。')}</p>
    {state.loading || state.result?.state === 'building' ? <div role="status" style={styles.state}>{tr('正在查找关联说话人…')}</div>
      : state.error !== '' || state.result?.state === 'failed' ? <div role="alert" style={styles.error}>{state.error || tr('出现统计暂不可用')}</div>
        : state.result?.state === 'stale' ? <div role="status" style={styles.state}>{tr('出现统计更新中')}</div>
        : state.result?.items.length === 0 ? <div role="status" style={styles.state}>{state.result.dayCount > 0
          ? tr('有发声，但未找到稳定的原始识别身份。')
          : tr('暂无可核实的关联说话人。')}</div>
          : <ul style={styles.list}>{state.result?.items.map(member => <li key={member.identityKey} style={styles.memberRow}>
            <UnmarkedSpeakerTokenAvatar token={member.token} size={36} label={tr('说话人 {v0}', { v0: member.token })} />
            <span style={styles.copy}><span style={styles.name}>{tr('说话人 {v0}', { v0: member.token })}</span>
              <span style={styles.meta}>{tr('出现 {v0} 天', { v0: member.dayCount })}</span></span>
          </li>)}</ul>}
  </section>
}

export function ArkmeRecognizedSpeakersSurface({ accountKey, onBack, loadMarked = defaultLoadMarked, loadPresence = defaultLoadPresence, loadMarkedMembers = defaultLoadMarkedMembers, loadUnmarked = defaultLoadUnmarked, directory: providedDirectory }: ArkmeRecognizedSpeakersSurfaceProps) {
  useArkmeLocale()
  const directory = useMemo(() => providedDirectory ?? (loadMarked === defaultLoadMarked && loadUnmarked === defaultLoadUnmarked && loadPresence === defaultLoadPresence ? recognizedSpeakerDirectory
    : new RecognizedSpeakerDirectory({ marked: loadMarked, page: loadUnmarked, presence: loadPresence }, 0)), [providedDirectory, loadMarked, loadUnmarked, loadPresence])
  const [filter, setFilter] = useState<SpeakerFilter>('all')
  const [query, setQuery] = useState('')
  const [orderPreference, setOrderPreference] = useState(() => ({ accountKey, value: readRecognizedSpeakerOrder(accountKey) }))
  const order = orderPreference.accountKey === accountKey ? orderPreference.value : readRecognizedSpeakerOrder(accountKey)
  const [visibleCount, setVisibleCount] = useState(100)
  const [refreshRevision, setRefreshRevision] = useState(0)
  const [marked, setMarked] = useState<{ loading: boolean; items: ArkmeRecordingSpeakerCandidate[]; error: string }>({ loading: true, items: [], error: '' })
  const [presence, setPresence] = useState<{ loading: boolean; result?: ArkmeRecordingSpeakerPresence; error: string }>({ loading: true, error: '' })
  const [unmarked, setUnmarked] = useState<{ loading: boolean; complete: boolean; items: UnmarkedSpeaker[]; projectionState: ArkmeDirectoryPage['projectionState']; error: string }>({ loading: true, complete: false, items: [], projectionState: undefined, error: '' })
  const [selectedCandidate, setSelectedCandidate] = useState<string>()
  const [selectedMarked, setSelectedMarked] = useState<Extract<IdentifiedSpeakerRow, { kind: 'marked' }>>()
  const lastAccountKey = useRef(accountKey)
  const readAccount = useRef<string>()
  const refresh = useCallback(() => { directory.invalidate(accountKey); setSelectedMarked(undefined); setRefreshRevision(value => value + 1) }, [directory, accountKey])
  useEffect(() => { setVisibleCount(100) }, [accountKey, filter, query, order])

  useEffect(() => {
    const controller = new AbortController()
    const retryTimers: ReturnType<typeof setTimeout>[] = []
    const retry = (error: unknown, read: () => void) => {
      const delay = speakerRetryDelay(error)
      if (delay !== undefined) retryTimers.push(setTimeout(() => { if (!controller.signal.aborted) read() }, delay))
    }
    readAccount.current = undefined
    if (lastAccountKey.current !== accountKey) {
      lastAccountKey.current = accountKey
      setMarked({ loading: true, items: [], error: '' })
      setPresence({ loading: true, error: '' })
      setUnmarked({ loading: true, complete: false, items: [], projectionState: undefined, error: '' })
      setOrderPreference({ accountKey, value: readRecognizedSpeakerOrder(accountKey) })
      setQuery('')
      setSelectedMarked(undefined)
      setSelectedCandidate(undefined)
    }
    setMarked(previous => ({ ...previous, loading: true, error: '' }))
    setPresence(previous => ({ ...previous, loading: true, error: '' }))
    setUnmarked(previous => ({ ...previous, loading: true, complete: false, error: '' }))
    const cachedMarked = directory.peekMarked(accountKey)
    if (cachedMarked !== undefined) setMarked({ loading: false, items: cachedMarked, error: '' })
    const readMarked = () => { void directory.readMarked(accountKey, controller.signal).then(items => {
      if (!controller.signal.aborted) setMarked({ loading: false, items, error: '' })
    }).catch(error => {
      if (!controller.signal.aborted) { setMarked(previous => ({ ...previous, loading: false, error: failureMessage(error) })); retry(error, readMarked) }
    }) }
    readMarked()
    const cachedPresence = directory.peekPresence(accountKey)
    if (cachedPresence !== undefined) setPresence({ loading: false, result: cachedPresence, error: '' })
    const readPresence = () => { void directory.readPresence(accountKey, controller.signal).then(result => {
      if (!controller.signal.aborted) setPresence({ loading: false, result, error: '' })
    }).catch(error => {
      if (!controller.signal.aborted) { setPresence(previous => ({ ...previous, loading: false, error: failureMessage(error) })); retry(error, readPresence) }
    }) }
    readPresence()
    const readCandidates = () => { void directory.readCandidates(accountKey, controller.signal, snapshot => {
      if (!controller.signal.aborted) { readAccount.current = accountKey; setUnmarked({ ...snapshot, loading: true, error: '' }) }
    }).then(snapshot => {
      if (!controller.signal.aborted) setUnmarked({ ...snapshot, loading: false, error: '' })
    }).catch(error => {
      if (!controller.signal.aborted) {
        setUnmarked(previous => ({ ...previous, loading: false, complete: false, error: failureMessage(error) }))
        retry(error, readCandidates)
      }
    }) }
    readCandidates()
    return () => { controller.abort(); retryTimers.forEach(clearTimeout) }
  }, [accountKey, refreshRevision, directory])

  useEffect(() => {
    const state = presence.result?.state
    if (presence.loading || presence.error !== '' || (state !== 'building' && state !== 'stale' && state !== 'failed')) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      void directory.refreshPresence(accountKey, controller.signal).then(result => {
        if (!controller.signal.aborted) setPresence({ loading: false, result, error: '' })
      }).catch(error => {
        if (!controller.signal.aborted) setPresence(previous => ({ ...previous, loading: false, error: failureMessage(error) }))
      })
    }, Math.max(5_000, presence.result?.retryAfterMs ?? 10_000))
    return () => { clearTimeout(timer); controller.abort() }
  }, [accountKey, refreshRevision, directory, presence.loading, presence.error, presence.result])

  const refreshPresenceVersion = useCallback(() => { setPresence({ loading: false, result: { state: 'stale', scope: 'all-history', items: [], retryAfterMs: 1000 }, error: '' }) }, [])

  const rows = useMemo(() => identifiedSpeakerRows(marked.items, unmarked.items), [marked.items, unmarked.items])
  const hasSelf = rows.some(row => row.kind === 'marked' && row.isCurrentUser)
  useEffect(() => {
    if (readAccount.current !== accountKey || marked.loading || marked.error !== '') return
    // Opening a successfully rendered directory clears the already-known notification.
    if (rows.length > 0 || (!unmarked.loading && unmarked.complete)) recognizedSpeakerTracker.acknowledge(accountKey)
    if (!unmarked.loading && unmarked.complete && unmarked.error === '') {
      recognizedSpeakerTracker.observe(accountKey, marked.items, unmarked.items, true)
    }
  }, [accountKey, marked.loading, marked.error, marked.items, unmarked.loading, unmarked.complete, unmarked.error, unmarked.items, rows.length])
  const presenceByOption = useMemo(() => new Map(presence.error === '' && presence.result?.state === 'fresh' ? presence.result.items.map(item => [item.optionKey, item]) : []), [presence.result, presence.error])
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const orderValue = (row: IdentifiedSpeakerRow) => {
    const stat = row.kind === 'marked' ? presenceByOption.get(row.optionKey)
      : unmarked.projectionState === undefined || unmarked.projectionState === 'fresh' ? row : undefined
    return { key: `${row.kind}:${row.key}`, name: row.name, dayCount: stat?.dayCount, lastSeenAt: stat?.lastSeenAt }
  }
  const visible = rows.filter(row => (filter === 'all' || row.kind === filter)
    && (normalizedQuery === '' || row.name.toLocaleLowerCase().includes(normalizedQuery)
      || (row.kind === 'unmarked' && row.subtitle.toLocaleLowerCase().includes(normalizedQuery))))
    .sort((left, right) => Number(right.kind === 'marked' && right.isCurrentUser) - Number(left.kind === 'marked' && left.isCurrentUser)
      || compareRecognizedSpeakers(orderValue(left), orderValue(right), order))
  const loading = marked.loading || unmarked.loading

  return <div style={styles.root} data-arkme-owned="recognized-speakers-surface">
    <style>{`
      .arkme-recognized-speakers-grid { display: grid; grid-template-columns: minmax(0, 320px) minmax(0, 1fr); gap: 16px; align-items: start; }
      .arkme-recognized-speakers-grid:not([data-detail-open="true"]) { display: block; max-width: 760px; }
      .arkme-recognized-speakers-row:hover, .arkme-recognized-speakers-row:focus-visible { background: ${arkmeTheme.hover} !important; }
      .arkme-recognized-speakers-row[aria-current="true"] { background: ${arkmeTheme.layer2} !important; }
      .arkme-recognized-speakers-mobile-back { display: none; }
      @container (max-width: 680px) {
        .arkme-recognized-speakers-grid[data-detail-open="true"] { display: block; }
        .arkme-recognized-speakers-grid[data-detail-open="true"] .arkme-recognized-speakers-list { display: none; }
        .arkme-recognized-speakers-mobile-back { display: inline-flex; margin-bottom: 14px; }
      }
    `}</style>
    <div style={styles.inner}>
      <header style={styles.header}>
        <button type="button" style={styles.button} onClick={onBack}>{tr('‹ 返回录音')}</button>
        <div><h1 style={styles.title}>{tr('已识别说话人')}</h1><p style={styles.subhead}>{tr('查看录音中已标记和未标记的说话人')}</p></div>
        <button type="button" style={{ ...styles.button, marginLeft: 'auto' }} onClick={refresh}>{tr('刷新')}</button>
      </header>
      <div style={styles.filters}>
        {([['all', '全部'], ['marked', '已标记'], ['unmarked', '未标记']] as const).map(([kind, label]) => <button key={kind} type="button" aria-pressed={filter === kind} style={{ ...styles.filter, ...(filter === kind ? styles.selectedFilter : {}) }} onClick={() => { setFilter(kind); setSelectedCandidate(undefined); setSelectedMarked(undefined) }}>{tr(label)}</button>)}
        <input aria-label={tr('搜索说话人')} placeholder={tr('搜索说话人')} value={query} onChange={event => { setQuery(event.target.value) }} style={styles.search} />
        <select aria-label={tr('说话人排序')} value={order} onChange={event => {
          const next: RecognizedSpeakerOrder = event.target.value === 'recent' ? 'recent' : 'frequent'
          setOrderPreference({ accountKey, value: next }); writeRecognizedSpeakerOrder(accountKey, next)
        }} style={styles.sort}>
          <option value="frequent">{tr('经常出现')}</option>
          <option value="recent">{tr('最近出现')}</option>
        </select>
      </div>
      {!marked.loading && marked.error === '' && !hasSelf && <SpeakerSelfGuide key={accountKey} onOpenRecordings={onBack} />}
      <div className="arkme-recognized-speakers-grid" data-detail-open={selectedCandidate === undefined && selectedMarked === undefined ? 'false' : 'true'}>
        <div className="arkme-recognized-speakers-list">
          {filter !== 'marked' && unmarked.loading && !unmarked.complete && rows.length > 0 && <p role="status" style={styles.note}>{tr('正在补齐说话人列表，排序仍在更新…')}</p>}
          {filter !== 'marked' && !unmarked.loading && !unmarked.complete && <p role="status" style={styles.note}>{tr('列表尚未完整，当前仅对已加载的说话人排序和搜索。')}</p>}
          {marked.error !== '' && <div role="alert" style={styles.error}>{tr('已标记说话人读取失败：')} {marked.error}</div>}
          {unmarked.error !== '' && <div role="alert" style={styles.error}>{tr('未标记说话人读取失败：')} {unmarked.error}</div>}
          {unmarked.projectionState === 'building' && <div role="status" style={styles.state}>{tr('未标记说话人正在整理，结果可能不完整。')}</div>}
          {unmarked.projectionState === 'stale' && <div role="status" style={styles.state}>{tr('未标记说话人正在更新，结果可能不完整。')}</div>}
          {unmarked.projectionState === 'failed' && <div role="alert" style={styles.error}>{tr('未标记说话人整理失败，请稍后刷新。')}</div>}
          {loading && rows.length === 0 ? <div role="status" style={styles.state}>{tr('正在加载说话人…')}</div>
            : visible.length === 0 ? <div role="status" style={styles.state}>{loading ? tr('正在更新说话人…') : rows.length === 0 && marked.error === '' && unmarked.error === '' && (unmarked.projectionState === undefined || unmarked.projectionState === 'fresh') ? tr('暂无已识别说话人') : tr('暂无可显示的说话人')}</div>
              : <ul style={styles.list}>{visible.slice(0, visibleCount).map(row => <li key={`${row.kind}:${row.key}`}>
                {row.kind === 'unmarked'
                  ? <button type="button" className="arkme-recognized-speakers-row" aria-current={selectedCandidate === row.candidateRef ? 'true' : undefined} style={{ ...styles.row, cursor: 'pointer' }} onClick={() => { setSelectedCandidate(row.candidateRef); setSelectedMarked(undefined) }}>
                    <UnmarkedSpeakerTokenAvatar token={row.token} size={38} label={row.name} />
                    <span style={styles.copy}><span style={styles.name}>{row.name}</span><span style={styles.meta}>{row.subtitle}</span></span><span style={styles.badge}>{tr('未标记')} ›</span>
                  </button>
                  : <button type="button" className="arkme-recognized-speakers-row" aria-current={selectedMarked?.key === row.key ? 'true' : undefined} style={{ ...styles.row, cursor: 'pointer' }} onClick={() => { setSelectedMarked(row); setSelectedCandidate(undefined) }}><ArkmeUserAvatar {...(row.avatarRef === undefined ? {} : { avatarRef: row.avatarRef })} size={38} label={row.name} /><span style={styles.copy}><span style={styles.name}>{row.name}{row.isCurrentUser ? ` · ${tr('我')}` : ''}</span><span style={styles.meta}>{markedPresenceLabel(presenceByOption.get(row.optionKey), presence.result, presence.loading, presence.error)}</span></span><span style={styles.badge}>{tr('已标记')} ›</span></button>}
              </li>)}</ul>}
          {visible.length > visibleCount && <button type="button" style={{ ...styles.button, marginTop: 14 }} onClick={() => { setVisibleCount(count => count + 100) }}>{tr('显示更多说话人')}</button>}
        </div>
        {selectedCandidate !== undefined && <div style={styles.detail}>
          <button type="button" className="arkme-recognized-speakers-mobile-back" style={styles.button} onClick={() => { setSelectedCandidate(undefined) }}>{tr('‹ 返回列表')}</button>
          <UnmarkedSpeakerDetail key={`${accountKey}:${selectedCandidate}`} accountKey={accountKey} candidateRef={selectedCandidate} onDirectoryRefresh={refresh} onCandidateCleared={() => { setSelectedCandidate(undefined) }} />
        </div>}
        {selectedMarked !== undefined && <div style={styles.detail}>
          <button type="button" className="arkme-recognized-speakers-mobile-back" style={styles.button} onClick={() => { setSelectedMarked(undefined) }}>{tr('‹ 返回列表')}</button>
          <MarkedSpeakerDetail key={`${accountKey}:${selectedMarked.speakerRef}`} accountKey={accountKey} speaker={selectedMarked} loadMembers={loadMarkedMembers} version={presence.result?.version} onVersionChanged={refreshPresenceVersion} />
        </div>}
      </div>
    </div>
  </div>
}
