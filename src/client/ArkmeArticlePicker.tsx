import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import type { ArkmeLongArticleDetail, ArkmeRecordSearchResult, ArkmeSearchRecordItem } from '../types.js'
import { arkmeMarkdownPlainText } from '../markdown.js'
import { callArkme } from './api.js'
import { arkmeTheme as theme } from './arkme-theme.js'
import { ArkmeLongArticleDialog, ArkmeLongArticleSnapshotDialog } from './ArkmeLongArticleDialog.js'
import type { ComposerArticle } from './composer-article-store.js'

const styles: Record<string, CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(0,0,0,.45)', display: 'grid', placeItems: 'center', padding: 16 },
  dialog: { width: 'min(660px, 100%)', maxHeight: 'min(780px, 88vh)', minHeight: 320, borderRadius: 16, background: theme.base, color: theme.text, boxShadow: theme.shadow, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  header: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10, padding: '20px 24px 12px' },
  button: { border: `1px solid ${theme.border}`, borderRadius: 8, padding: '8px 12px', color: theme.text, background: theme.layer1, font: 'inherit', cursor: 'pointer' },
  search: { margin: '0 24px 16px', padding: '10px 12px', border: `1px solid ${theme.border}`, borderRadius: 10, color: theme.text, background: theme.input, font: 'inherit', minWidth: 0 },
  list: { padding: '0 24px', overflowY: 'auto', minHeight: 0, flex: 1 },
  row: { display: 'flex', gap: 12, alignItems: 'center', border: `1px solid ${theme.border}`, borderRadius: 10, padding: 12, marginBottom: 10 },
  select: { flex: 1, minWidth: 0, textAlign: 'left', background: 'transparent', color: 'inherit', border: 0, padding: 0, font: 'inherit', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10 },
  title: { display: 'block', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden', fontWeight: 600 },
  summary: { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', overflowWrap: 'anywhere', margin: '6px 0', color: theme.secondary, fontSize: 13, lineHeight: '20px' },
  meta: { color: theme.secondary, fontSize: 12 },
  state: { padding: '24px 8px', textAlign: 'center', color: theme.secondary, fontSize: 13 },
  footer: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10, borderTop: `1px solid ${theme.border}`, padding: '14px 24px' },
}
type OwnedArticle = { detail: ArkmeLongArticleDetail; messageActionRef: string }
export function isOwnArticle(item: ArkmeSearchRecordItem, userId: number): boolean {
  return (item.templateKind === 8 || item.displayKind === 1) && String(item.recordOwnerUserId) === String(userId)
    && (item.recordCreatorUserId === undefined || String(item.recordCreatorUserId) === String(userId))
}

export function ArkmeArticlePicker({ sourceRef, userId, onClose, onSelect }: {
  sourceRef: string; userId: number; onClose: () => void; onSelect: (article: ComposerArticle) => void
}) {
  const [query, setQuery] = useState('')
  const [page, setPage] = useState<ArkmeRecordSearchResult>()
  const [selected, setSelected] = useState('')
  const [loading, setLoading] = useState(true)
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState('')
  const [openError, setOpenError] = useState('')
  const [creating, setCreating] = useState(false)
  const [preview, setPreview] = useState<OwnedArticle>()
  const generation = useRef(0)
  const controller = useRef<AbortController>()
  const detailController = useRef<AbortController>()
  const busy = useRef(false)
  const cursorSeen = useRef(new Set<string>())
  const root = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const mounted = useRef(true)
  const load = useCallback(async (cursor?: string) => {
    if (busy.current) return
    busy.current = true
    const epoch = generation.current
    const request = new AbortController(); controller.current = request
    const timeout = setTimeout(() => request.abort(), 20_000)
    setLoading(true); setError('')
    try {
      const normalized = query.trim()
      const result = await callArkme<ArkmeRecordSearchResult>(normalized ? 'search.records' : 'search.scene', {
        ...(normalized ? { query: normalized } : { scene: 'long_article' }), limit: 30, ...(cursor ? { cursor } : {}),
      }, request.signal)
      if (epoch !== generation.current || !mounted.current) return
      if (request.signal.aborted) throw new Error('加载超时，请重试')
      const next = result.nextCursor?.trim()
      const hasMore = result.hasMore && !!next && next !== cursor && !cursorSeen.current.has(next)
      if (cursor) cursorSeen.current.add(cursor)
      setPage(current => ({ ...result, hasMore, items: [...new Map([
        ...(cursor ? current?.items ?? [] : []), ...result.items.filter(item => isOwnArticle(item, userId)),
      ].map(item => [item.recordUid, item])).values()].sort((a, b) => b.sendAtMillis - a.sendAtMillis) }))
      if (result.hasMore && !hasMore) setError('后续分页暂不可用，请重新搜索后重试')
    } catch (caught) {
      if (epoch === generation.current && mounted.current) setError(request.signal.aborted ? '加载超时，请重试' : caught instanceof Error ? caught.message : '长文加载失败')
    } finally {
      clearTimeout(timeout)
      if (epoch === generation.current && mounted.current) { busy.current = false; setLoading(false) }
    }
  }, [query, userId])
  useEffect(() => {
    generation.current += 1; controller.current?.abort(); busy.current = false
    detailController.current?.abort(); setOpening(false); setOpenError('')
    cursorSeen.current.clear(); setPage(undefined); setSelected(''); setLoading(true); setError('')
    const timer = setTimeout(() => { void load() }, query.trim() ? 250 : 0)
    return () => { clearTimeout(timer); generation.current += 1; controller.current?.abort() }
  }, [load, query])
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; controller.current?.abort(); detailController.current?.abort() }
  }, [])
  useEffect(() => {
    if (!creating && !preview) search.current?.focus({ preventScroll: true })
  }, [creating, preview])
  const resolveArticle = async (uid: string, attach: boolean) => {
    if (opening || detailController.current) return
    const request = new AbortController(); detailController.current = request
    const epoch = generation.current
    const timeout = setTimeout(() => request.abort(), 20_000)
    setOpening(true); setOpenError('')
    try {
      const owned = await callArkme<OwnedArticle>('source.long-article.own', { itemUid: uid, expectedUserId: userId }, request.signal)
      if (!mounted.current || request.signal.aborted || epoch !== generation.current) return
      if (attach) { onSelect({ kind: 'existing', ...owned }); onClose() } else setPreview(owned)
    } catch (caught) {
      if (mounted.current && epoch === generation.current) setOpenError(request.signal.aborted ? '读取超时，请重试' : caught instanceof Error ? caught.message : '无法读取长文，请重试')
    } finally { clearTimeout(timeout); if (detailController.current === request) detailController.current = undefined; if (mounted.current && epoch === generation.current) setOpening(false) }
  }
  const close = () => { detailController.current?.abort(); onClose() }
  return <>
    <div style={styles.overlay} onMouseDown={event => { if (event.target === event.currentTarget) close() }}>
      <div ref={root} role="dialog" aria-modal="true" aria-label="添加长文" style={styles.dialog} onKeyDown={event => {
        if (creating || preview) return
        if (event.key === 'Escape') { event.stopPropagation(); close() }
        if (event.key === 'Tab') {
          const controls = [...(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)') ?? [])]
          const first = controls[0]; const last = controls.at(-1)
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
          if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
        }
      }}>
        <header style={styles.header}><h2 style={{ margin: 0, flex: 1, fontSize: 19 }}>添加长文</h2>
          <button type="button" style={styles.button} disabled={opening} onClick={() => setCreating(true)}>＋新建长文</button>
          <button type="button" style={styles.button} aria-label="关闭添加长文" onClick={close}>×</button></header>
        <input ref={search} style={styles.search} value={query} aria-label="搜索自己的长文" placeholder="搜索自己的长文" onChange={event => setQuery(event.target.value)} />
        <div style={styles.list}>
          {page?.items.map(item => <div key={item.recordUid} data-arkme-article-choice={item.recordUid} style={{ ...styles.row, background: selected === item.recordUid ? theme.accentSoft : theme.base }}>
            <button type="button" style={styles.select} role="radio" aria-checked={selected === item.recordUid} aria-label={item.title || '无标题长文'} disabled={opening} onClick={() => setSelected(item.recordUid)}>
              <span aria-hidden="true" style={{ color: selected === item.recordUid ? theme.accent : theme.secondary }}>{selected === item.recordUid ? '◉' : '○'}</span>
              <span style={{ minWidth: 0, flex: 1 }}><span style={styles.title}>{item.title || '无标题长文'}</span>
                <span style={styles.summary}>{arkmeMarkdownPlainText(item.snippet || item.textContent)}</span>
                <span style={styles.meta}>{item.sendAtMillis > 0 ? new Date(item.sendAtMillis).toLocaleDateString('zh-CN') : ''}</span></span>
            </button>
            <button type="button" style={styles.button} aria-label={`预览${item.title || '长文'}`} disabled={opening} onClick={() => { void resolveArticle(item.recordUid, false) }}>预览</button>
          </div>)}
          {!loading && !error && page?.items.length === 0 && <div style={styles.state}>{page.hasMore ? '本页暂无自己的长文，可继续加载' : query.trim() ? '没有找到匹配的长文' : '还没有自己的长文，点击上方新建'}</div>}
          <div style={styles.state}>{loading ? <span role="status">正在加载…</span> : error ? <span role="alert">{error}<button style={styles.button} onClick={() => { void load(page?.hasMore ? page.nextCursor : undefined) }}>重试</button></span>
            : page?.hasMore && <button style={styles.button} onClick={() => { void load(page.nextCursor) }}>加载更多</button>}</div>
        </div>
        {openError && <p role="alert" style={{ color: theme.danger, margin: '0 24px 12px' }}>{openError}</p>}
        <footer style={styles.footer}><span style={{ ...styles.meta, flex: 1 }}>只添加到输入框，不会立即发送</span>
          <button style={styles.button} onClick={close}>取消</button>
          <button style={{ ...styles.button, background: theme.primaryAction, color: theme.onPrimaryAction, opacity: !selected || opening ? .5 : 1 }} disabled={!selected || opening} onClick={() => { void resolveArticle(selected, true) }}>{opening ? '正在读取…' : '添加所选'}</button></footer>
      </div>
    </div>
    {creating && <ArkmeLongArticleDialog sourceRef={sourceRef} overlayZIndex={1201} onClose={() => setCreating(false)} onPrepared={draft => {
      if (!draft.recordUid || !draft.relationUid) return
      onSelect({ kind: 'new', draft: { ...draft, recordUid: draft.recordUid, relationUid: draft.relationUid } }); onClose()
    }} />}
    {preview && <ArkmeLongArticleSnapshotDialog item={{ ...preview.detail, isMe: true, senderName: '我', status: 1, templateKind: 8, displayKind: 1 }} onClose={() => setPreview(undefined)} />}
  </>
}
