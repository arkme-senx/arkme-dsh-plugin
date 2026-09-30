import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import type { ArkmeRecordingSpeakerMembers } from '../types.js'
import type { SpeakerDirectoryDetail, SpeakerDirectoryPerson, SpeakerDirectoryQuery, SpeakerDirectoryStatus } from '../speaker-directory-contract.js'
import { callArkme } from './api.js'
import { ArkmeUserAvatar } from './ArkmeAvatar.js'
import { arkmeTheme } from './arkme-theme.js'
import { tr, useArkmeLocale, arkmeIntlLocale } from './locale.js'
import { UnmarkedSpeakerDetail } from './redesign/contacts/UnmarkedSpeakerDetail.js'
import { UnmarkedSpeakerTokenAvatar } from './redesign/contacts/UnmarkedSpeakerVisuals.js'
import { readRecognizedSpeakerOrder, writeRecognizedSpeakerOrder } from './recognized-speaker-order.js'
import { SpeakerSelfGuide } from './recordings/SpeakerSelfGuide.js'
import { RecognizedSpeakerDirectory, recognizedSpeakerDirectory, directoryQueryValid, directoryVisible, directoryErrorCode, normalizeDirectoryQuery, speakerRetryDelay, type DirectoryList } from './recognized-speaker-directory.js'

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
  directory?: RecognizedSpeakerDirectory
  loadMarkedMembers?: (speakerRef: string, signal: AbortSignal, expectedVersion?: string) => Promise<ArkmeRecordingSpeakerMembers>
}
const defaultLoadMarkedMembers = (speakerRef: string, signal: AbortSignal, expectedVersion?: string) => callArkme<ArkmeRecordingSpeakerMembers>(
  'recordings.speaker.members', { speakerRef, ...(expectedVersion === undefined ? {} : { expectedVersion }) }, signal)
const failureMessage = (error: unknown) => error instanceof Error ? error.message : tr('说话人列表暂时无法加载')
function personStats(row: SpeakerDirectoryPerson) {
  const recent = row.lastSeenAt > 0 ? new Intl.DateTimeFormat(arkmeIntlLocale(), { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(row.lastSeenAt) : tr('时间未知')
  return tr('出现 {v0} 天 · 最近 {v1}', { v0: row.dayCount, v1: recent })
}
function statusText(status: SpeakerDirectoryStatus | undefined): string {
  if (status?.state === 'disabled') return tr('说话人目录暂不可用，请稍后再试。')
  if (status?.coverage === 'unknown') return status.state === 'failed' ? tr('说话人目录暂不可用，请稍后刷新。') : tr('正在整理说话人目录…')
  if (status?.state === 'failed') return tr('更新暂未完成，当前显示上次整理的目录。')
  if (status?.state === 'stale') return tr('正在更新，当前显示已整理的目录。')
  if (status && (status.processingSessionCount > 0 || status.pendingIdentityAggregationCount > 0 || status.insufficientEvidenceCount > 0 || status.scanTruncated)) return tr('部分录音仍在整理，人物可能继续更新。')
  return ''
}
function PersonDetail({ row, accountKey, directory, loadMembers, onChanged }: {
  row: SpeakerDirectoryPerson; accountKey: string; directory: RecognizedSpeakerDirectory
  loadMembers: NonNullable<ArkmeRecognizedSpeakersSurfaceProps['loadMarkedMembers']>; onChanged(): void
}) {
  const [detail, setDetail] = useState<SpeakerDirectoryDetail>()
  const [members, setMembers] = useState<ArkmeRecordingSpeakerMembers>()
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    let retry: ReturnType<typeof setTimeout> | undefined
    setDetail(undefined); setMembers(undefined); setError('')
    void directory.open(accountKey, row.detailRef, controller.signal).then(async value => {
      if (controller.signal.aborted) return
      setDetail(value)
      if (value.type === 'speaker') {
        const result = await loadMembers(value.speakerRef, controller.signal, value.expectedVersion)
        if (controller.signal.aborted) return
        setMembers(result)
        if (result.state === 'stale') onChanged()
        else if (result.state !== 'fresh') retry = setTimeout(() => { if (directoryVisible()) setRevision(value => value + 1) }, Math.max(5_000, result.retryAfterMs ?? 10_000))
      }
    }).catch(error => {
      if (controller.signal.aborted) return
      if (directoryErrorCode(error) === 'unmarked-candidate-not-found') onChanged()
      else setError(failureMessage(error))
    })
    return () => { controller.abort(); clearTimeout(retry) }
  }, [row.detailRef, accountKey, directory, loadMembers, onChanged, revision])
  if (error) return <div role="alert" style={styles.error}>{error} <button style={styles.button} onClick={() => setRevision(value => value + 1)}>{tr('重试')}</button></div>
  if (!detail) return <div role="status" style={styles.state}>{tr('正在加载人物详情…')}</div>
  if (detail.type === 'candidate') return <UnmarkedSpeakerDetail accountKey={accountKey} candidateRef={detail.candidateRef} onDirectoryRefresh={onChanged} onCandidateCleared={onChanged} />
  return <section aria-label={tr('已标记说话人详情')}>
    <h2 style={styles.detailTitle}>{row.displayName}{row.isSelf ? ` · ${tr('我')}` : ''}</h2>
    <p style={{ ...styles.meta, margin: 0 }}>{personStats(row)}</p>
    <h3 style={styles.detailSection}>{tr('对应的识别说话人')}</h3>
    <p style={{ ...styles.meta, whiteSpace: 'normal' }}>{tr('展示全部历史已转写片段中可核实的关联。')}</p>
    {!members || members.state !== 'fresh' ? <div role="status" style={styles.state}>{members?.state === 'failed' ? tr('出现统计暂不可用') : tr('出现统计整理中')}</div>
      : members.items.length === 0 ? <div style={styles.state}>{tr('暂无可核实的关联说话人。')}</div>
        : <ul style={styles.list}>{members.items.map(member => <li key={member.identityKey} style={styles.memberRow}>
          <UnmarkedSpeakerTokenAvatar token={member.token} size={36} label={tr('说话人 {v0}', { v0: member.token })} />
          <span style={styles.copy}><span style={styles.name}>{tr('说话人 {v0}', { v0: member.token })}</span><span style={styles.meta}>{tr('出现 {v0} 天', { v0: member.dayCount })}</span></span>
        </li>)}</ul>}
  </section>
}

export function ArkmeRecognizedSpeakersSurface(props: ArkmeRecognizedSpeakersSurfaceProps) {
  return <DirectorySurface key={props.accountKey} {...props} />
}
function DirectorySurface({ accountKey, onBack, directory = recognizedSpeakerDirectory, loadMarkedMembers = defaultLoadMarkedMembers }: ArkmeRecognizedSpeakersSurfaceProps) {
  useArkmeLocale()
  const [filter, setFilter] = useState<SpeakerDirectoryQuery['filter']>('all')
  const [input, setInput] = useState(''), [queryText, setQueryText] = useState('')
  const [sort, setSort] = useState(() => readRecognizedSpeakerOrder(accountKey))
  const query = useMemo<SpeakerDirectoryQuery>(() => ({ filter, sort, query: queryText }), [filter, sort, queryText])
  const [list, setList] = useState<DirectoryList>()
  const listRef = useRef(list); listRef.current = list
  const [loading, setLoading] = useState(true), [moreLoading, setMoreLoading] = useState(false)
  const [error, setError] = useState(''), [seenError, setSeenError] = useState('')
  const [selected, setSelected] = useState<SpeakerDirectoryPerson>()
  const rootRef = useRef<HTMLDivElement>(null), listScroll = useRef(0), hadSelection = useRef(false)
  useLayoutEffect(() => {
    const root = rootRef.current
    if (root && root.clientWidth <= 680) {
      if (selected && !hadSelection.current) { listScroll.current = root.scrollTop; root.scrollTop = 0 }
      else if (!selected && hadSelection.current) root.scrollTop = listScroll.current
    }
    hadSelection.current = selected !== undefined
  }, [selected])
  const [revision, setRevision] = useState(0)
  const force = useRef(false), recoveryAttempts = useRef(0)
  const controllerRef = useRef<AbortController>()
  const snapshot = useSyncExternalStore(directory.subscribe, () => directory.get(accountKey), () => directory.get(accountKey))
  const summary = snapshot.summary
  const queryValid = directoryQueryValid(input)
  const queryPending = normalizeDirectoryQuery(input) !== queryText
  const listMatches = list?.query.filter === filter && list.query.sort === sort && list.query.query === queryText
  useEffect(() => { if (!directory.hasPendingSeen(accountKey)) setSeenError('') }, [directory, accountKey, snapshot])
  useEffect(() => { const timer = setTimeout(() => setQueryText(normalizeDirectoryQuery(input)), 300); return () => clearTimeout(timer) }, [input])
  const refresh = useCallback(() => { force.current = true; directory.invalidate(accountKey); setRevision(value => value + 1) }, [directory, accountKey])
  useEffect(() => {
    const controller = new AbortController(); controllerRef.current = controller
    let retry: ReturnType<typeof setTimeout> | undefined
    let busy = false
    const cached = directory.peek(accountKey, query)
    setList(cached); setSelected(undefined); setError(''); setMoreLoading(false)
    const load = async () => {
      if (busy || !directoryVisible() || controller.signal.aborted) return
      if (!directoryQueryValid(query.query)) { setLoading(false); return }
      busy = true; setLoading(true)
      try {
        const result = await directory.first(accountKey, query, controller.signal, force.current)
        if (!controller.signal.aborted) { force.current = false; setList(result); setError('') }
      } catch (error) {
        if (controller.signal.aborted) return
        setError(failureMessage(error))
        const delay = speakerRetryDelay(error)
        if (delay !== undefined) retry = setTimeout(() => { void load() }, delay)
      } finally { busy = false; if (!controller.signal.aborted) setLoading(false) }
    }
    void load()
    const unwatch = directory.watch(accountKey, () => {
      if (controller.signal.aborted) return
      const current = listRef.current
      if (!current || current.coverage === 'unknown' || directory.needsReload(accountKey, current)) void load()
    })
    return () => { controller.abort(); clearTimeout(retry); unwatch() }
  }, [accountKey, directory, query, revision])
  // A committed, visible main-directory render is the only source of acknowledgement.
  useEffect(() => {
    if (!list || loading || queryPending || list.query.filter !== filter || list.query.query !== queryText) return
    let disposed = false
    const confirm = () => { if (directoryVisible()) void directory.confirmDisplayed(accountKey, list).then(() => {
      if (!disposed) { setSeenError(''); if (directory.needsReload(accountKey, list)) refresh() }
    }).catch(() => { if (!disposed) setSeenError(tr('查看状态暂未同步，联网后自动重试。')) }) }
    confirm()
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', confirm)
    return () => { disposed = true; if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', confirm) }
  }, [accountKey, directory, list, loading, queryPending, filter, queryText, refresh])
  const recoverDetail = useCallback(() => {
    if (!selected || recoveryAttempts.current >= 1) { setSelected(undefined); refresh(); return }
    recoveryAttempts.current += 1
    const controller = controllerRef.current
    if (!controller) return
    void directory.first(accountKey, query, controller.signal, true).then(next => {
      if (controller.signal.aborted) return
      setList(next); setSelected(next.items.find(item => item.personKey === selected.personKey))
    }).catch(error => { if (!controller.signal.aborted) { setSelected(undefined); setError(failureMessage(error)) } })
  }, [accountKey, directory, selected, query, refresh])
  const loadMore = async () => {
    const controller = controllerRef.current
    if (!list || !controller || moreLoading || queryPending) return
    setMoreLoading(true); setError('')
    try { const next = await directory.more(accountKey, list, controller.signal); if (!controller.signal.aborted) setList(next) }
    catch (error) { if (!controller.signal.aborted) setError(failureMessage(error)) }
    finally { if (!controller.signal.aborted) setMoreLoading(false) }
  }
  const disabled = summary?.state === 'disabled' || list?.state === 'disabled'
  const rows = disabled || queryPending || !listMatches ? [] : list?.items ?? []
  const state = disabled ? tr('说话人目录暂不可用，请稍后再试。') : statusText(summary?.snapshotVersion === list?.snapshotVersion ? summary : list?.coverage === 'complete' ? list : summary)
  const hasNewVersion = list?.coverage === 'complete' && summary?.snapshotVersion && summary.snapshotVersion !== list.snapshotVersion
  const mainFirst = listMatches && filter === 'all' && queryText === '' && !queryPending && list?.coverage === 'complete' && list.state === 'fresh'
  const selfMissing = mainFirst && !list.items.some(row => row.isSelf)
  return <div ref={rootRef} style={styles.root} data-arkme-owned="recognized-speakers-surface">
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
      <header style={styles.header}><button type="button" style={styles.button} onClick={onBack}>{tr('‹ 返回录音')}</button>
        <div><h1 style={styles.title}>{tr('已识别说话人')}</h1><p style={styles.subhead}>{tr('查看录音中已标记和未标记的说话人')}</p></div>
        <button type="button" style={{ ...styles.button, marginLeft: 'auto' }} onClick={refresh} disabled={loading}>{tr('刷新')}</button>
      </header>
      <div style={styles.filters}>
        {([['all', '全部', summary?.totalCount], ['marked', '已标记', summary?.markedCount], ['unmarked', '未标记', summary?.unmarkedCount]] as const).map(([kind, label, count]) => <button key={kind} type="button" aria-pressed={filter === kind} style={{ ...styles.filter, ...(filter === kind ? styles.selectedFilter : {}) }} onClick={() => setFilter(kind)}>{tr(label)}{!disabled && count != null ? ` ${count}` : ''}</button>)}
        <input aria-label={tr('搜索说话人')} placeholder={tr('搜索名称或编号')} value={input} onChange={event => setInput(event.target.value)} style={styles.search} />
        <select aria-label={tr('说话人排序')} value={sort} onChange={event => { const next = event.target.value === 'recent' ? 'recent' : 'frequent'; setSort(next); writeRecognizedSpeakerOrder(accountKey, next) }} style={styles.sort}>
          <option value="frequent">{tr('经常出现')}</option><option value="recent">{tr('最近出现')}</option>
        </select>
      </div>
      {!queryValid && <p role="alert" style={styles.error}>{tr('搜索内容过长，请缩短至 256 字节以内。')}</p>}
      {selfMissing && <SpeakerSelfGuide key={accountKey} onOpenRecordings={onBack} />}
      {hasNewVersion && <p role="status" style={styles.note}>{tr('目录有更新，刷新后查看最新人物。')}</p>}
      {state && <p role="status" style={styles.note}>{state}</p>}
      {seenError && <p role="status" style={styles.note}>{seenError}</p>}
      {error && <div role="alert" style={styles.error}>{error}</div>}
      <div className="arkme-recognized-speakers-grid" data-detail-open={selected !== undefined ? 'true' : 'false'}>
        <div className="arkme-recognized-speakers-list" aria-busy={loading || queryPending}>
          {!disabled && (loading || queryPending) && rows.length === 0 ? <div role="status" style={styles.state}>{tr('正在加载说话人…')}</div>
            : !disabled && !error && rows.length === 0 && list?.coverage === 'complete' && !queryPending ? <div role="status" style={styles.state}>{tr(queryText ? '没有匹配的说话人' : filter === 'all' ? '暂无已识别说话人' : '该分类暂无说话人')}</div>
              : <ul style={styles.list}>{rows.map(row => <li key={row.personKey}><button type="button" className="arkme-recognized-speakers-row" aria-current={selected?.personKey === row.personKey ? 'true' : undefined} style={{ ...styles.row, cursor: 'pointer' }} onClick={() => { recoveryAttempts.current = 0; setSelected(row) }}>
                {row.type === 'unmarked' ? <UnmarkedSpeakerTokenAvatar token={row.displayNumber > 0 ? String(row.displayNumber) : ''} size={38} label={row.displayName} /> : <ArkmeUserAvatar size={38} label={row.displayName} />}
                <span style={styles.copy}><span style={styles.name}>{row.displayName}{row.isSelf ? ` · ${tr('我')}` : ''}</span><span style={styles.meta}>{personStats(row)}</span></span>
                <span style={styles.badge}>{tr(row.type === 'marked' ? '已标记' : '未标记')} ›</span>
              </button></li>)}</ul>}
          {!disabled && !queryPending && list?.hasMore && <button type="button" disabled={moreLoading || loading} style={{ ...styles.button, marginTop: 14 }} onClick={() => { void loadMore() }}>{tr(moreLoading ? '正在加载…' : '加载更多说话人')}</button>}
        </div>
        {selected && !disabled && <div style={styles.detail}><button type="button" className="arkme-recognized-speakers-mobile-back" style={styles.button} onClick={() => setSelected(undefined)}>{tr('‹ 返回列表')}</button>
          <PersonDetail key={selected.detailRef} row={selected} accountKey={accountKey} directory={directory} loadMembers={loadMarkedMembers} onChanged={recoverDetail} />
        </div>}
      </div>
    </div>
  </div>
}
