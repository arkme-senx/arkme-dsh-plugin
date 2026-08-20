import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type {
  ArkmeAiVideoListItem, ArkmeAiVideoListResult, ArkmeFileAssetDisplayItem,
  ArkmeImageSearchItem, ArkmeImageSearchResult,
  ArkmeRecordSearchResult, ArkmeSearchHistoryResult, ArkmeSearchRecordItem,
} from '../types.js'
import { ArkmeClientError, callArkme } from './api.js'
import { arkmeTheme } from './arkme-theme.js'

const assetRoot = '/arkme-self/api/call'
const mediaRoute = '/arkme-self/api/media'
const colors = {
  text: arkmeTheme.text, secondary: arkmeTheme.secondary,
  tertiary: arkmeTheme.tertiary, border: arkmeTheme.border, panel: arkmeTheme.base,
  subtle: arkmeTheme.subtle, hover: arkmeTheme.hover, blue: arkmeTheme.info, danger: arkmeTheme.danger,
}

const styles: Record<string, CSSProperties> = {
  shell: { width: 'min(850px, 100%)', margin: '0 auto', padding: '20px 36px 40px', boxSizing: 'border-box', color: colors.text },
  column: { display: 'flex', flexDirection: 'column' },
  searchBox: { height: 44, flex: 'none', display: 'flex', alignItems: 'center', gap: 5, padding: '0 10px', boxSizing: 'border-box', border: '1px solid transparent', borderRadius: 12, background: colors.subtle },
  searchIcon: { width: 26, height: 26, flex: 'none' },
  input: { flex: 1, minWidth: 0, height: '100%', border: 0, outline: 0, padding: 0, background: 'transparent', color: colors.text, font: 'inherit', fontSize: 16 },
  clear: { width: 40, height: 40, display: 'grid', placeItems: 'center', flex: 'none', padding: 0, border: 0, background: 'transparent', cursor: 'pointer' },
  scroll: { overflowY: 'visible' },
  section: { margin: '18px 15px 0' }, sectionTitle: { margin: '0 0 12px', color: colors.tertiary, fontSize: 12, lineHeight: '24px', fontWeight: 400 },
  chips: { display: 'flex', flexWrap: 'wrap', gap: 12 }, chip: { minHeight: 28, padding: '3px 12px', border: `1px solid ${colors.border}`, borderRadius: 20, background: 'transparent', color: colors.blue, cursor: 'pointer', font: 'inherit', fontSize: 14, lineHeight: '20px' },
  tabs: { display: 'flex', alignItems: 'flex-end', gap: 30, flex: 'none', marginTop: 20, borderBottom: `1px solid ${colors.border}` },
  tab: { position: 'relative', minHeight: 38, padding: '0 0 11px', border: 0, background: 'transparent', color: colors.text, cursor: 'pointer', font: 'inherit', fontSize: 14, whiteSpace: 'nowrap' }, tabActive: { fontWeight: 600 },
  indicator: { position: 'absolute', left: '50%', bottom: 5, width: 10, height: 2, marginLeft: -5, borderRadius: 22, background: colors.text },
  status: { padding: '54px 12px', textAlign: 'center', color: colors.secondary, fontSize: 13 },
  error: { margin: '14px 0 0', padding: '10px 12px', borderRadius: 8, background: arkmeTheme.dangerSoft, color: colors.danger, fontSize: 13 },
  list: { display: 'flex', flexDirection: 'column' }, row: { width: '100%', minWidth: 0, padding: '14px 10px', border: 0, borderBottom: `1px solid ${colors.border}`, background: 'transparent', color: 'inherit', textAlign: 'left', cursor: 'pointer', font: 'inherit', boxSizing: 'border-box' },
  title: { margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 14, lineHeight: '21px', fontWeight: 600 },
  text: { margin: '4px 0 0', display: '-webkit-box', overflow: 'hidden', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflowWrap: 'anywhere', color: colors.secondary, fontSize: 13, lineHeight: '20px' },
  meta: { display: 'block', marginTop: 6, color: arkmeTheme.caption, fontSize: 11, lineHeight: '16px' },
  sourceLayout: { minHeight: 0, flex: 1, display: 'grid', gridTemplateColumns: 'minmax(180px, 36%) minmax(0, 1fr)', gap: 18, overflow: 'hidden' }, sourceList: { overflowY: 'auto', borderRight: `1px solid ${colors.border}`, paddingRight: 8 }, sourceResults: { overflowY: 'auto' },
  quickShell: { width: '100%' },
  quickHeader: { width: '100%' }, quickTopRow: { display: 'flex', alignItems: 'center', gap: 8 },
  back: { width: 32, height: 44, display: 'grid', placeItems: 'center', flex: 'none', padding: 0, border: 0, borderRadius: 8, background: 'transparent', cursor: 'pointer' },
  quickSearch: { height: 44, flex: 1, display: 'flex', alignItems: 'center', gap: 5, padding: '0 10px', boxSizing: 'border-box', border: '1px solid transparent', borderRadius: 12, background: colors.subtle }, quickSearchIcon: { width: 26, height: 26, flex: 'none' }, quickInput: { flex: 1, minWidth: 0, height: '100%', border: 0, outline: 0, padding: 0, background: 'transparent', color: colors.text, font: 'inherit', fontSize: 16 },
  quickBody: { paddingBottom: 40 },
  summary: { display: 'inline-block', margin: '12px 2px 4px', padding: '2px 8px', borderRadius: 4, background: colors.subtle, color: colors.secondary, fontSize: 10 }, month: { margin: '16px 2px 8px', fontSize: 13, fontWeight: 600 },
  mediaGrid: { display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 3 }, mediaButton: { position: 'relative', minWidth: 0, aspectRatio: '1', overflow: 'hidden', padding: 0, border: 0, borderRadius: 4, background: arkmeTheme.subtle, cursor: 'pointer' }, mediaImage: { width: '100%', height: '100%', display: 'block', objectFit: 'cover' }, play: { position: 'absolute', inset: 0, margin: 'auto', width: 38, height: 38, padding: 9, borderRadius: 999, background: 'rgba(0,0,0,.52)', boxSizing: 'border-box' }, duration: { position: 'absolute', right: 4, bottom: 4, padding: '1px 4px', borderRadius: 4, background: 'rgba(0,0,0,.58)', color: arkmeTheme.foreground, fontSize: 9 },
  imageSection: { marginTop: 12 }, imageSectionTitle: { margin: '0 0 6px 2px', color: colors.tertiary, fontSize: 12, lineHeight: '18px', fontWeight: 400 }, imageTile: { position: 'relative', minWidth: 0, aspectRatio: '1', overflow: 'hidden', padding: 0, border: 0, borderRadius: 0, background: arkmeTheme.subtle, cursor: 'pointer' },
  loadMore: { display: 'block', minWidth: 96, margin: '18px auto 0', padding: '7px 16px', border: `1px solid ${colors.border}`, borderRadius: 8, background: colors.panel, color: colors.text, cursor: 'pointer', font: 'inherit', fontSize: 13 },
  audioRow: { padding: '12px 8px', borderBottom: `1px solid ${colors.border}` }, audio: { width: '100%', height: 34, marginTop: 8 },
  fileRow: { display: 'flex', alignItems: 'center', gap: 10, padding: '12px 8px', borderBottom: `1px solid ${colors.border}`, color: colors.text, textDecoration: 'none' }, fileIcon: { width: 38, height: 38, flex: 'none' }, fileText: { minWidth: 0, flex: 1 },
  linkCard: { display: 'block', marginTop: 10, padding: 12, border: `1px solid ${colors.border}`, borderRadius: 10, color: colors.text, textDecoration: 'none', overflow: 'hidden' },
  aiGrid: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12, marginTop: 12 }, aiCard: { minWidth: 0, overflow: 'hidden', border: `1px solid ${colors.border}`, borderRadius: 9 }, aiCover: { ...({ position: 'relative', width: '100%', aspectRatio: '16 / 9', display: 'grid', placeItems: 'center', overflow: 'hidden', padding: 0, border: 0, background: '#20242c', cursor: 'pointer' } as CSSProperties) }, aiBody: { padding: '9px 10px 11px' },
  modal: { position: 'fixed', inset: 0, zIndex: 10000, display: 'grid', placeItems: 'center', padding: 28, background: 'var(--dsw-alias-bg-mask-3, rgba(0,0,0,.55))' }, detail: { width: 'min(700px, 92vw)', maxHeight: '86vh', overflowY: 'auto', padding: 24, boxSizing: 'border-box', borderRadius: 14, background: colors.panel }, preview: { width: 'min(960px, 92vw)', maxHeight: '90vh', padding: 12, borderRadius: 14, background: '#111' }, previewMedia: { maxWidth: '100%', maxHeight: '78vh', display: 'block', margin: '0 auto', borderRadius: 8 }, closeText: { display: 'block', margin: '12px 0 0 auto', border: 0, borderRadius: 8, padding: '7px 12px', background: colors.subtle, color: colors.text, cursor: 'pointer' },
}

const quickEntries: Array<{ key: QuickKey; label: string }> = [{ key: 'image', label: '图片' }, { key: 'ai_video', label: 'AI 视频' }]
type QuickKey = 'image' | 'ai_video'
type Preview = { kind: 'image' | 'video'; url: string; name: string; subtitle?: string }

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
function RecordRow({ item, onClick }: { item: ArkmeSearchRecordItem; onClick(): void }) {
  return <button type="button" style={styles.row} onClick={onClick}><p style={styles.title}>{item.title || item.nickname || '快记'}</p><p style={styles.text}>{item.snippet || item.textContent || (item.media.length + item.files.length > 0 || item.voice !== undefined ? '媒体内容' : '暂无文字内容')}</p><span style={styles.meta}>{item.sourceTitle === undefined ? '' : `${item.sourceTitle} · `}{dateTimeLabel(item.sendAtMillis)}</span></button>
}
function Status({ loading, error, empty }: { loading: boolean; error?: string; empty?: boolean }) {
  if (loading) return <div style={styles.status} role="status">正在加载…</div>
  if (error !== undefined && error !== '') return <div style={styles.error}>{error}</div>
  return empty === true ? <div style={styles.status}>暂无相关内容</div> : null
}

export function ArkmeSearchSurface() {
  const [query, setQuery] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [records, setRecords] = useState<ArkmeRecordSearchResult>()
  const [quick, setQuick] = useState<QuickKey>()
  const [images, setImages] = useState<ArkmeImageSearchItem[]>()
  const [imageCursor, setImageCursor] = useState('')
  const [imageHasMore, setImageHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [videos, setVideos] = useState<ArkmeAiVideoListItem[]>()
  const [assets, setAssets] = useState<Map<string, ArkmeFileAssetDisplayItem>>(() => new Map())
  const [resolvedAssetUids, setResolvedAssetUids] = useState<Set<string>>(() => new Set())
  const [selectedRecord, setSelectedRecord] = useState<ArkmeSearchRecordItem>()
  const [preview, setPreview] = useState<Preview>()
  const [loading, setLoading] = useState(false)
  const [recordError, setRecordError] = useState('')
  const requestId = useRef(0)

  useEffect(() => { void callArkme<ArkmeSearchHistoryResult>('search.history', { limit: 10 }).then(value => setHistory(value.items.map(item => item.keyword))).catch(() => undefined) }, [])
  const resetResults = useCallback(() => { requestId.current += 1; setRecords(undefined); setRecordError(''); setLoading(false) }, [])

  const runSearch = useCallback(async (raw: string) => {
    const keyword = raw.trim()
    if (keyword === '') { resetResults(); return }
    const id = ++requestId.current
    setLoading(true); setRecordError('')
    const recordResult = await Promise.allSettled([
      callArkme<ArkmeRecordSearchResult>('search.records', { query: keyword, limit: 50 }),
    ]).then(results => results[0])
    if (id !== requestId.current) return
    setRecords(recordResult.status === 'fulfilled' ? recordResult.value : undefined)
    setRecordError(recordResult.status === 'rejected' ? errorMessage(recordResult.reason) : '')
    setLoading(false)
    void callArkme('search.history.create', { query: keyword }).catch(() => undefined)
    setHistory(current => [keyword, ...current.filter(value => value !== keyword)].slice(0, 10))
  }, [resetResults])

  useEffect(() => { if (query.trim() === '') { resetResults(); return }; const timer = window.setTimeout(() => { void runSearch(query) }, 300); return () => window.clearTimeout(timer) }, [query, resetResults, runSearch])

  const loadQuick = useCallback(async (value: QuickKey) => {
    const id = ++requestId.current
    setQuick(value); setQuery(''); setLoading(true); setRecords(undefined); setImages(undefined); setImageCursor(''); setImageHasMore(false); setVideos(undefined); setRecordError('')
    try {
      if (value === 'image') {
        const result = await callArkme<ArkmeImageSearchResult>('search.scene', { scene: 'image_video', mediaKind: 'image', limit: 50 })
        if (id === requestId.current) { setImages(result.items); setImageCursor(result.nextCursor ?? ''); setImageHasMore(result.hasMore) }
      } else {
        const result = await callArkme<ArkmeAiVideoListResult>('ai-video.list', { limit: 30 })
        if (id === requestId.current) setVideos(result.items)
      }
    } catch (caught) { if (id === requestId.current) setRecordError(errorMessage(caught)) }
    finally { if (id === requestId.current) setLoading(false) }
  }, [])

  const loadMoreImages = useCallback(async () => {
    if (loadingMore || !imageHasMore || imageCursor === '') return
    setLoadingMore(true); setRecordError('')
    try {
      const result = await callArkme<ArkmeImageSearchResult>('search.scene', { scene: 'image_video', mediaKind: 'image', limit: 50, cursor: imageCursor })
      setImages(current => {
        const byKey = new Map((current ?? []).map(item => [item.itemKey, item]))
        for (const item of result.items) byKey.set(item.itemKey, item)
        return [...byKey.values()]
      })
      setImageCursor(result.nextCursor ?? '')
      setImageHasMore(result.hasMore)
    } catch (caught) { setRecordError(errorMessage(caught)) }
    finally { setLoadingMore(false) }
  }, [imageCursor, imageHasMore, loadingMore])

  const leaveQuick = useCallback(() => { requestId.current += 1; setQuick(undefined); setQuery(''); setRecords(undefined); setImages(undefined); setImageCursor(''); setImageHasMore(false); setVideos(undefined); setRecordError(''); setLoading(false); setLoadingMore(false) }, [])
  useEffect(() => {
    const videoAssets = (videos ?? []).flatMap(item => [item.coverAssetUid, item.videoAssetUid]).filter((value): value is string => value !== undefined).map(fileAssetUid => ({ fileAssetUid }))
    const uids = [...new Set(videoAssets.map(item => item.fileAssetUid))].filter(uid => !resolvedAssetUids.has(uid))
    if (uids.length === 0) return
    let active = true
    void callArkme<ArkmeFileAssetDisplayItem[]>('files.assets', { fileAssetUids: uids }).then(items => { if (!active) return; setAssets(current => { const next = new Map(current); for (const item of items) next.set(item.fileAssetUid, item); return next }); setResolvedAssetUids(current => new Set([...current, ...uids])) }).catch(() => { if (active) setResolvedAssetUids(current => new Set([...current, ...uids])) })
    return () => { active = false }
  }, [resolvedAssetUids, videos])

  const quickBody = useMemo<ReactNode>(() => {
    if (quick === undefined) return null
    if (loading || (recordError !== '' && quick !== 'image')) return <Status loading={loading} error={recordError} />
    if (quick === 'image') {
      const items = images ?? []
      const loadMoreButton = imageHasMore && <button type="button" style={styles.loadMore} disabled={loadingMore} onClick={() => { void loadMoreImages() }}>{loadingMore ? '正在加载…' : '加载更多'}</button>
      if (items.length === 0) return <><Status loading={false} error={recordError} empty={recordError === ''} />{loadMoreButton}</>
      const sections = new Map<string, ArkmeImageSearchItem[]>()
      for (const item of items) {
        const label = imageMonthLabel(item.sendAtMillis)
        sections.set(label, [...(sections.get(label) ?? []), item])
      }
      return <>{[...sections].map(([label, sectionItems]) => <section key={label} style={styles.imageSection}><h3 style={styles.imageSectionTitle}>{label}</h3><div style={styles.mediaGrid}>{sectionItems.map(item => <button key={item.itemKey} type="button" style={styles.imageTile} title={item.recordTitle} onClick={() => setPreview({ kind: 'image', url: mediaUrl(item.mediaRef), name: item.fileName, subtitle: [item.sourceTitle, dateTimeLabel(item.sendAtMillis)].filter(Boolean).join(' · ') })}><img src={mediaUrl(item.mediaRef)} alt={item.fileName} loading="lazy" style={styles.mediaImage} /></button>)}</div></section>)}{recordError !== '' && <div style={styles.error}>{recordError}</div>}{loadMoreButton}</>
    }
    const items = videos ?? []
    if (items.length === 0) return <Status loading={false} empty />
    return <div style={styles.aiGrid}>{items.map(item => {
        const cover = item.coverAssetUid === undefined ? '' : displayUrl(assets.get(item.coverAssetUid))
        const video = item.videoAssetUid === undefined ? '' : displayUrl(assets.get(item.videoAssetUid))
        return <article key={item.jobId} style={styles.aiCard}><button type="button" style={styles.aiCover} disabled={item.status !== 'succeeded' || video === ''} onClick={() => setPreview({ kind: 'video', url: video, name: item.title })}>{cover !== '' && <img src={cover} alt="" style={styles.mediaImage} />}{item.status === 'succeeded' ? <img src={`${assetRoot}/video_play_white.svg`} alt="" style={styles.play} /> : <span style={{ color: '#fff', fontSize: 12 }}>{item.status === 'failed' ? '生成失败' : `生成中 ${String(item.progress)}%`}</span>}</button><div style={styles.aiBody}><p style={styles.title}>{item.title}</p><span style={styles.meta}>{dateTimeLabel(item.sourceStartedAtMillis || item.createdAtMillis)}</span></div></article>
      })}</div>
  }, [assets, imageHasMore, images, loading, loadingMore, loadMoreImages, quick, recordError, videos])

  const hasQuery = query.trim() !== ''
  const recordItems = records?.items ?? []

  return <div style={styles.shell}>
    {quick === undefined ? <div style={styles.column}>
      <div style={styles.searchBox}>
        <img src={`${assetRoot}/image_search_grey.svg`} alt="" style={styles.searchIcon} />
        <input autoFocus style={styles.input} value={query} placeholder="搜索" aria-label="搜索" onChange={event => setQuery(event.target.value)} />
        {query !== '' && <button type="button" aria-label="清空搜索" style={styles.clear} onClick={() => setQuery('')}><img src={`${assetRoot}/icon_close_round_bold.svg`} alt="" width={16} height={16} /></button>}
      </div>
      {!hasQuery ? <div style={styles.scroll}>{history.length > 0 && <section style={styles.section}><h3 style={styles.sectionTitle}>搜索历史</h3><div style={styles.chips}>{history.map(value => <button key={value} type="button" style={styles.chip} onClick={() => setQuery(value)}>{value}</button>)}</div></section>}<section style={styles.section}><h3 style={styles.sectionTitle}>快速查找</h3><div style={styles.chips}>{quickEntries.map(entry => <button key={entry.key} type="button" style={styles.chip} onClick={() => { void loadQuick(entry.key) }}>{entry.label}</button>)}</div></section></div> : <>
        {recordError !== '' && <div style={styles.error}>{recordError}</div>}
        <div style={styles.scroll}>{loading ? <Status loading /> : recordItems.length === 0 && recordError === '' ? <Status loading={false} empty /> : <div style={styles.list}>{recordItems.map(item => <RecordRow key={item.recordUid} item={item} onClick={() => setSelectedRecord(item)} />)}</div>}</div>
      </>}
    </div> : <div style={styles.quickShell}>
      <header style={styles.quickHeader}><div style={styles.quickTopRow}><button type="button" aria-label="返回搜索" title="返回搜索" style={styles.back} onClick={leaveQuick}><img src={`${assetRoot}/arrow_left.svg`} alt="" width={20} height={20} /></button><div style={styles.quickSearch}><img src={`${assetRoot}/image_search_grey.svg`} alt="" style={styles.quickSearchIcon} /><input autoFocus style={styles.quickInput} value={query} placeholder="搜索快记" aria-label="搜索快记" onChange={event => setQuery(event.target.value)} />{query !== '' && <button type="button" aria-label="清空搜索" style={styles.clear} onClick={() => setQuery('')}><img src={`${assetRoot}/icon_close_round_bold.svg`} alt="" width={16} height={16} /></button>}</div></div><div style={styles.tabs}><button type="button" style={{ ...styles.tab, ...styles.tabActive }}>{hasQuery ? '搜索快记' : quick === 'image' ? '图片库' : 'AI 视频'}<span style={styles.indicator} /></button></div></header>
      <main style={styles.quickBody}>{hasQuery ? <>{loading ? <Status loading /> : recordError !== '' ? <Status loading={false} error={recordError} /> : recordItems.length === 0 ? <Status loading={false} empty /> : <div style={styles.list}>{recordItems.map(item => <RecordRow key={item.recordUid} item={item} onClick={() => setSelectedRecord(item)} />)}</div>}</> : quickBody}</main>
    </div>}

    {selectedRecord !== undefined && <div style={styles.modal} role="dialog" aria-modal="true" onClick={() => setSelectedRecord(undefined)}><article style={styles.detail} onClick={event => event.stopPropagation()}><h3 style={styles.title}>{selectedRecord.title || selectedRecord.nickname || '快记'}</h3>{selectedRecord.textContent !== '' && <p style={{ ...styles.text, display: 'block', color: colors.text, whiteSpace: 'pre-wrap' }}>{selectedRecord.textContent}</p>}<span style={styles.meta}>{selectedRecord.sourceTitle === undefined ? '' : `${selectedRecord.sourceTitle} · `}{dateTimeLabel(selectedRecord.sendAtMillis)}</span><button type="button" style={styles.closeText} onClick={() => setSelectedRecord(undefined)}>返回搜索结果</button></article></div>}
    {preview !== undefined && <div style={styles.modal} role="dialog" aria-modal="true" onClick={() => setPreview(undefined)}><div style={styles.preview} onClick={event => event.stopPropagation()}>{preview.kind === 'video' ? <video src={preview.url} controls autoPlay style={styles.previewMedia} /> : <img src={preview.url} alt={preview.name} style={styles.previewMedia} />}{preview.subtitle !== undefined && preview.subtitle !== '' && <span style={{ ...styles.meta, color: '#c7cbd1', textAlign: 'center' }}>{preview.subtitle}</span>}<button type="button" style={styles.closeText} onClick={() => setPreview(undefined)}>关闭</button></div></div>}
  </div>
}
