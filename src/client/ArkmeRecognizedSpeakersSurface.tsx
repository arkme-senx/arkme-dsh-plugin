import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { ArkmeDirectoryPage, ArkmeRecordingSpeakerCandidate, ArkmeRecordingSpeakerMembers, ArkmeRecordingSpeakerPresence } from '../types.js'
import { callArkme } from './api.js'
import { ArkmeUserAvatar } from './ArkmeAvatar.js'
import { arkmeTheme } from './arkme-theme.js'
import { tr, useArkmeLocale } from './locale.js'
import { UnmarkedSpeakerDetail } from './redesign/contacts/UnmarkedSpeakerDetail.js'
import { UnmarkedSpeakerTokenAvatar } from './redesign/contacts/UnmarkedSpeakerVisuals.js'

type SpeakerFilter = 'all' | 'marked' | 'unmarked'
type UnmarkedSpeaker = Extract<ArkmeDirectoryPage['items'][number], { kind: 'unmarked-speaker' }>
export type IdentifiedSpeakerRow =
  | { kind: 'marked'; key: string; optionKey: string; speakerRef: string; name: string; avatarRef?: string; isCurrentUser: boolean }
  | { kind: 'unmarked'; key: string; name: string; token: string; subtitle: string; candidateRef: string }

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
  loadMarkedMembers?: (speakerRef: string, signal: AbortSignal) => Promise<ArkmeRecordingSpeakerMembers>
  loadUnmarked?: (cursor: string, signal: AbortSignal) => Promise<ArkmeDirectoryPage>
}

const defaultLoadMarked = async (signal: AbortSignal) => await callArkme<ArkmeRecordingSpeakerCandidate[]>('recordings.speaker.options', {}, signal)
const defaultLoadPresence = async (signal: AbortSignal) => await callArkme<ArkmeRecordingSpeakerPresence>('recordings.speaker.presence', {}, signal)
const defaultLoadMarkedMembers = async (speakerRef: string, signal: AbortSignal) => await callArkme<ArkmeRecordingSpeakerMembers>(
  'recordings.speaker.members', { speakerRef }, signal,
)
const defaultLoadUnmarked = async (cursor: string, signal: AbortSignal) => await callArkme<ArkmeDirectoryPage>(
  'directory.list', { section: 'unmarked-speakers', limit: 50, ...(cursor === '' ? { refresh: true } : { cursor }) }, signal,
)

function failureMessage(error: unknown): string {
  return error instanceof Error && error.message.trim() !== '' ? error.message : tr('说话人列表暂时无法加载')
}

function markedPresenceLabel(stat: ArkmeRecordingSpeakerPresence['items'][number] | undefined, result: ArkmeRecordingSpeakerPresence | undefined, loading: boolean, error: string): string {
  if (stat !== undefined) {
    const date = new Date(stat.lastSeenAt)
    if (!Number.isNaN(date.getTime())) {
      const two = (value: number) => String(value).padStart(2, '0')
      const recent = `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`
      return result?.scope === 'recent-seven-days'
        ? tr('近 7 天出现 {v0} 天 · 最近 {v1}', { v0: stat.dayCount, v1: recent })
        : tr('出现 {v0} 天 · 最近 {v1}', { v0: stat.dayCount, v1: recent })
    }
  }
  if (loading || result?.state === 'building') return tr('出现统计整理中')
  if (error !== '' || result?.state === 'failed' || result === undefined) return tr('出现统计暂不可用')
  if (result.state === 'stale') return tr('出现统计更新中')
  if (result.scope === 'recent-seven-days') return tr('近 7 天未见已转写发声 · 全历史待接口')
  return tr('暂无可统计的录音片段')
}

function MarkedSpeakerDetail({ accountKey, speaker, loadMembers }: {
  accountKey: string
  speaker: Extract<IdentifiedSpeakerRow, { kind: 'marked' }>
  loadMembers: (speakerRef: string, signal: AbortSignal) => Promise<ArkmeRecordingSpeakerMembers>
}) {
  const [state, setState] = useState<{ loading: boolean; result?: ArkmeRecordingSpeakerMembers; error: string }>({ loading: true, error: '' })
  useEffect(() => {
    const controller = new AbortController()
    setState({ loading: true, error: '' })
    void loadMembers(speaker.speakerRef, controller.signal).then(result => {
      if (!controller.signal.aborted) setState({ loading: false, result, error: '' })
    }).catch(error => {
      if (!controller.signal.aborted) setState({ loading: false, error: failureMessage(error) })
    })
    return () => { controller.abort() }
  }, [accountKey, speaker.speakerRef, loadMembers])

  return <section aria-label={tr('已标记说话人详情')}>
    <h2 style={styles.detailTitle}>{speaker.name}{speaker.isCurrentUser ? ` · ${tr('我')}` : ''}</h2>
    <p style={{ ...styles.meta, margin: 0 }}>{tr('查看已确认归属的原始识别身份')}</p>
    <h3 style={styles.detailSection}>{tr('对应的识别说话人')}</h3>
    <p style={{ ...styles.meta, margin: '0 0 8px', whiteSpace: 'normal' }}>{tr('仅展示近 7 天已转写片段中可核实的关联；完整历史待接口。')}</p>
    {state.loading ? <div role="status" style={styles.state}>{tr('正在查找关联说话人…')}</div>
      : state.error !== '' ? <div role="alert" style={styles.error}>{state.error}</div>
        : state.result?.items.length === 0 ? <div role="status" style={styles.state}>{state.result.dayCount > 0
          ? tr('近 7 天有发声，但未找到稳定的原始识别身份。')
          : tr('近 7 天未找到关联，不代表完整历史中没有。')}</div>
          : <ul style={styles.list}>{state.result?.items.map((member, index) => <li key={`${member.token}:${index}`} style={styles.memberRow}>
            <UnmarkedSpeakerTokenAvatar token={member.token} size={36} label={tr('说话人 {v0}', { v0: member.token })} />
            <span style={styles.copy}><span style={styles.name}>{tr('说话人 {v0}', { v0: member.token })}</span>
              <span style={styles.meta}>{tr('近 7 天出现 {v0} 天', { v0: member.dayCount })}</span></span>
          </li>)}</ul>}
  </section>
}

export function ArkmeRecognizedSpeakersSurface({ accountKey, onBack, loadMarked = defaultLoadMarked, loadPresence = defaultLoadPresence, loadMarkedMembers = defaultLoadMarkedMembers, loadUnmarked = defaultLoadUnmarked }: ArkmeRecognizedSpeakersSurfaceProps) {
  useArkmeLocale()
  const [filter, setFilter] = useState<SpeakerFilter>('all')
  const [query, setQuery] = useState('')
  const [refreshRevision, setRefreshRevision] = useState(0)
  const [marked, setMarked] = useState<{ loading: boolean; items: ArkmeRecordingSpeakerCandidate[]; error: string }>({ loading: true, items: [], error: '' })
  const [presence, setPresence] = useState<{ loading: boolean; result?: ArkmeRecordingSpeakerPresence; error: string }>({ loading: true, error: '' })
  const [unmarked, setUnmarked] = useState<{ loading: boolean; loadingMore: boolean; items: UnmarkedSpeaker[]; nextCursor: string; hasMore: boolean; projectionState?: ArkmeDirectoryPage['projectionState']; error: string }>({ loading: true, loadingMore: false, items: [], nextCursor: '', hasMore: false, error: '' })
  const [selectedCandidate, setSelectedCandidate] = useState<string>()
  const [selectedMarked, setSelectedMarked] = useState<Extract<IdentifiedSpeakerRow, { kind: 'marked' }>>()
  const moreController = useRef<AbortController>()
  const moreBusy = useRef(false)
  const refresh = useCallback(() => { moreController.current?.abort(); moreBusy.current = false; setSelectedMarked(undefined); setRefreshRevision(value => value + 1) }, [])

  useEffect(() => {
    const controller = new AbortController()
    setMarked(previous => ({ ...previous, loading: true, error: '' }))
    setPresence(previous => ({ ...previous, loading: true, error: '' }))
    setUnmarked(previous => ({ ...previous, loading: true, loadingMore: false, error: '' }))
    void loadMarked(controller.signal).then(items => {
      if (!controller.signal.aborted) setMarked({ loading: false, items, error: '' })
    }).catch(error => {
      if (!controller.signal.aborted) setMarked(previous => ({ ...previous, loading: false, error: failureMessage(error) }))
    })
    void loadPresence(controller.signal).then(result => {
      if (!controller.signal.aborted) setPresence({ loading: false, result, error: '' })
    }).catch(error => {
      if (!controller.signal.aborted) setPresence(previous => ({ ...previous, loading: false, error: failureMessage(error) }))
    })
    void loadUnmarked('', controller.signal).then(page => {
      if (controller.signal.aborted) return
      if (page.section !== 'unmarked-speakers') throw new Error('未标记说话人列表响应无效')
      setUnmarked({ loading: false, loadingMore: false, items: page.items.filter((item): item is UnmarkedSpeaker => item.kind === 'unmarked-speaker'), nextCursor: page.nextCursor ?? '', hasMore: page.hasMore, projectionState: page.projectionState, error: '' })
    }).catch(error => {
      if (!controller.signal.aborted) setUnmarked(previous => ({ ...previous, loading: false, loadingMore: false, error: failureMessage(error) }))
    })
    return () => { controller.abort(); moreController.current?.abort(); moreBusy.current = false }
  }, [accountKey, refreshRevision, loadMarked, loadPresence, loadUnmarked])

  useEffect(() => {
    const state = presence.result?.state
    if (presence.error !== '' || (state !== 'building' && state !== 'stale')) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      void loadPresence(controller.signal).then(result => {
        if (!controller.signal.aborted) setPresence({ loading: false, result, error: '' })
      }).catch(error => {
        if (!controller.signal.aborted) setPresence(previous => ({ ...previous, loading: false, error: failureMessage(error) }))
      })
    }, Math.max(5_000, presence.result?.retryAfterMs ?? 10_000))
    return () => { clearTimeout(timer); controller.abort() }
  }, [accountKey, loadPresence, presence.error, presence.result])

  const loadMore = useCallback(() => {
    if (moreBusy.current || unmarked.loading || !unmarked.hasMore || unmarked.nextCursor === '') return
    moreBusy.current = true
    const controller = new AbortController()
    moreController.current = controller
    setUnmarked(previous => ({ ...previous, loadingMore: true, error: '' }))
    void loadUnmarked(unmarked.nextCursor, controller.signal).then(page => {
      if (controller.signal.aborted) return
      if (page.section !== 'unmarked-speakers') throw new Error('未标记说话人列表响应无效')
      if (page.cursorStale === true) { refresh(); return }
      setUnmarked(previous => ({ ...previous, loadingMore: false, items: [...new Map([...previous.items, ...page.items.filter((item): item is UnmarkedSpeaker => item.kind === 'unmarked-speaker')].map(item => [item.candidateRef, item])).values()], nextCursor: page.nextCursor ?? '', hasMore: page.hasMore, projectionState: page.projectionState ?? previous.projectionState, error: '' }))
    }).catch(error => {
      if (!controller.signal.aborted) setUnmarked(previous => ({ ...previous, loadingMore: false, error: failureMessage(error) }))
    }).finally(() => { moreBusy.current = false })
  }, [loadUnmarked, refresh, unmarked.hasMore, unmarked.loading, unmarked.nextCursor])

  const rows = useMemo(() => identifiedSpeakerRows(marked.items, unmarked.items), [marked.items, unmarked.items])
  const presenceByOption = useMemo(() => new Map(presence.result?.items.map(item => [item.optionKey, item]) ?? []), [presence.result])
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const visible = rows.filter(row => (filter === 'all' || row.kind === filter)
    && (normalizedQuery === '' || row.name.toLocaleLowerCase().includes(normalizedQuery)
      || (row.kind === 'unmarked' && row.subtitle.toLocaleLowerCase().includes(normalizedQuery))))
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
        <input aria-label={tr('搜索说话人')} placeholder={tr('搜索已加载的说话人')} value={query} onChange={event => { setQuery(event.target.value) }} style={styles.search} />
      </div>
      <div className="arkme-recognized-speakers-grid" data-detail-open={selectedCandidate === undefined && selectedMarked === undefined ? 'false' : 'true'}>
        <div className="arkme-recognized-speakers-list">
          {presence.result?.scope === 'recent-seven-days' && <p style={styles.note}>{tr('已标记项仅统计近 7 天已转写发声；全历史统计待接口。')}</p>}
          {marked.error !== '' && <div role="alert" style={styles.error}>{tr('已标记说话人读取失败：')} {marked.error}</div>}
          {unmarked.error !== '' && <div role="alert" style={styles.error}>{tr('未标记说话人读取失败：')} {unmarked.error}</div>}
          {unmarked.projectionState === 'building' && <div role="status" style={styles.state}>{tr('未标记说话人正在整理，结果可能不完整。')}</div>}
          {unmarked.projectionState === 'stale' && <div role="status" style={styles.state}>{tr('未标记说话人正在更新，结果可能不完整。')}</div>}
          {unmarked.projectionState === 'failed' && <div role="alert" style={styles.error}>{tr('未标记说话人整理失败，请稍后刷新。')}</div>}
          {loading && rows.length === 0 ? <div role="status" style={styles.state}>{tr('正在加载说话人…')}</div>
            : visible.length === 0 ? <div role="status" style={styles.state}>{loading ? tr('正在更新说话人…') : rows.length === 0 && marked.error === '' && unmarked.error === '' && (unmarked.projectionState === undefined || unmarked.projectionState === 'fresh') ? tr('暂无已识别说话人') : tr('暂无可显示的说话人')}</div>
              : <ul style={styles.list}>{visible.map(row => <li key={`${row.kind}:${row.key}`}>
                {row.kind === 'unmarked'
                  ? <button type="button" className="arkme-recognized-speakers-row" aria-current={selectedCandidate === row.candidateRef ? 'true' : undefined} style={{ ...styles.row, cursor: 'pointer' }} onClick={() => { setSelectedCandidate(row.candidateRef); setSelectedMarked(undefined) }}>
                    <UnmarkedSpeakerTokenAvatar token={row.token} size={38} label={row.name} />
                    <span style={styles.copy}><span style={styles.name}>{row.name}</span><span style={styles.meta}>{row.subtitle}</span></span><span style={styles.badge}>{tr('未标记')} ›</span>
                  </button>
                  : <button type="button" className="arkme-recognized-speakers-row" aria-current={selectedMarked?.key === row.key ? 'true' : undefined} style={{ ...styles.row, cursor: 'pointer' }} onClick={() => { setSelectedMarked(row); setSelectedCandidate(undefined) }}><ArkmeUserAvatar {...(row.avatarRef === undefined ? {} : { avatarRef: row.avatarRef })} size={38} label={row.name} /><span style={styles.copy}><span style={styles.name}>{row.name}{row.isCurrentUser ? ` · ${tr('我')}` : ''}</span><span style={styles.meta}>{markedPresenceLabel(presenceByOption.get(row.optionKey), presence.result, presence.loading, presence.error)}</span></span><span style={styles.badge}>{tr('已标记')} ›</span></button>}
              </li>)}</ul>}
          {unmarked.hasMore && <button type="button" style={{ ...styles.button, marginTop: 14 }} disabled={unmarked.loading || unmarked.loadingMore || unmarked.nextCursor === ''} onClick={loadMore}>{unmarked.loadingMore ? tr('正在加载…') : tr('加载更多未标记说话人')}</button>}
          {unmarked.hasMore && query.trim() !== '' && <p style={{ ...styles.meta, marginTop: 10 }}>{tr('搜索仅覆盖已加载的说话人，可继续加载更多。')}</p>}
        </div>
        {selectedCandidate !== undefined && <div style={styles.detail}>
          <button type="button" className="arkme-recognized-speakers-mobile-back" style={styles.button} onClick={() => { setSelectedCandidate(undefined) }}>{tr('‹ 返回列表')}</button>
          <UnmarkedSpeakerDetail key={`${accountKey}:${selectedCandidate}`} accountKey={accountKey} candidateRef={selectedCandidate} onDirectoryRefresh={refresh} onCandidateCleared={() => { setSelectedCandidate(undefined) }} />
        </div>}
        {selectedMarked !== undefined && <div style={styles.detail}>
          <button type="button" className="arkme-recognized-speakers-mobile-back" style={styles.button} onClick={() => { setSelectedMarked(undefined) }}>{tr('‹ 返回列表')}</button>
          <MarkedSpeakerDetail key={`${accountKey}:${selectedMarked.speakerRef}`} accountKey={accountKey} speaker={selectedMarked} loadMembers={loadMarkedMembers} />
        </div>}
      </div>
    </div>
  </div>
}
