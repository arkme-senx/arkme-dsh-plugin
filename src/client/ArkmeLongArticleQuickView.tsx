import { useCallback, useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { ArkmeRecordSearchResult, ArkmeSearchRecordItem } from '../types.js'
import { arkmeMarkdownPlainText } from '../markdown.js'
import { callArkme } from './api.js'
import { arkmeTheme } from './arkme-theme.js'
import { ArkmeLongArticleDialog } from './ArkmeLongArticleDialog.js'

const styles: Record<string, CSSProperties> = {
  list: { display: 'flex', flexDirection: 'column', gap: 12, padding: '16px 2px' },
  card: { width: '100%', minWidth: 0, padding: 16, textAlign: 'left', border: `1px solid ${arkmeTheme.border}`, borderRadius: 12, background: arkmeTheme.layer1, color: arkmeTheme.text, cursor: 'pointer', font: 'inherit' },
  title: { margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 15, lineHeight: '22px', fontWeight: 600 },
  summary: { margin: '8px 0', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', overflowWrap: 'anywhere', color: arkmeTheme.secondary, fontSize: 13, lineHeight: '21px' },
  meta: { color: arkmeTheme.caption, fontSize: 12, lineHeight: '18px' },
  state: { padding: '24px 12px', color: arkmeTheme.secondary, textAlign: 'center', fontSize: 13 },
  retry: { marginLeft: 8, padding: '6px 12px', border: `1px solid ${arkmeTheme.border}`, borderRadius: 8, background: arkmeTheme.layer1, color: arkmeTheme.text, font: 'inherit', cursor: 'pointer' },
}

function identity(item: ArkmeSearchRecordItem): string {
  return `${String(item.recordOwnerUserId ?? '')}:${item.recordUid}`
}

function articleDate(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return ''
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(value)
}

/** Browse the same long-article scene as Flutter, without turning it into an unfiltered keyword search. */
export function ArkmeLongArticleQuickView({ scrollRoot }: { scrollRoot?: RefObject<HTMLElement> }) {
  const [page, setPage] = useState<ArkmeRecordSearchResult>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [openError, setOpenError] = useState('')
  const [selected, setSelected] = useState<ArkmeSearchRecordItem>()
  const generation = useRef(0)
  const request = useRef<AbortController>()
  const inFlight = useRef(false)
  const sentinel = useRef<HTMLDivElement>(null)
  const opener = useRef<HTMLButtonElement>()

  const load = useCallback(async (cursor?: string) => {
    if (inFlight.current) return
    inFlight.current = true
    const id = ++generation.current
    const controller = new AbortController()
    request.current = controller
    setLoading(true); setError('')
    const timeout = setTimeout(() => controller.abort(), 20_000)
    try {
      const result = await callArkme<ArkmeRecordSearchResult>('search.scene', {
        scene: 'long_article', limit: 30, ...(cursor === undefined ? {} : { cursor }),
      }, controller.signal)
      if (id !== generation.current) return
      if (controller.signal.aborted) throw new Error('加载超时，请重试')
      // Do not mix ordinary notes/files into this category, even if an older provider returns them.
      const items = result.items.filter(item => item.templateKind === 8 || item.displayKind === 1)
      const nextCursor = result.nextCursor?.trim()
      const canContinue = result.hasMore && !!nextCursor && nextCursor !== cursor
      setPage(current => ({
        ...result, hasMore: canContinue,
        items: [...new Map([...(cursor === undefined ? [] : current?.items ?? []), ...items].map(item => [identity(item), item])).values()],
      }))
      if (result.hasMore && !canContinue) setError('后续分页暂不可用，请返回后重试')
    } catch (caught) {
      if (id === generation.current) setError(controller.signal.aborted ? '加载超时，请重试' : caught instanceof Error ? caught.message : '长文加载失败，请重试')
    } finally {
      clearTimeout(timeout)
      if (id === generation.current) { inFlight.current = false; setLoading(false) }
    }
  }, [])

  useEffect(() => {
    void load()
    return () => { generation.current += 1; request.current?.abort(); inFlight.current = false }
  }, [load])

  useEffect(() => {
    if (loading || error || !page?.hasMore || !page.nextCursor || !sentinel.current || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) void load(page.nextCursor)
    }, { root: scrollRoot?.current ?? null, rootMargin: '240px 0px' })
    observer.observe(sentinel.current)
    return () => observer.disconnect()
  }, [error, load, loading, page, scrollRoot])

  const closeArticle = useCallback(() => {
    setSelected(undefined)
    opener.current?.focus({ preventScroll: true })
  }, [])

  return <section aria-label="长文快速查找">
    {openError !== '' && <p role="alert" style={styles.state}>{openError}</p>}
    <div style={styles.list}>
      {page?.items.map(item => {
        const text = item.snippet || item.textContent
        const summary = item.textFormat === 'markdown' ? arkmeMarkdownPlainText(text) : text
        return <button key={identity(item)} type="button" data-arkme-feedback="neutral" data-arkme-long-article-result="true" style={styles.card} onClick={event => {
          setOpenError('')
          if (item.targetSource === undefined) { setOpenError('原会话暂不可访问，请返回后重试'); return }
          opener.current = event.currentTarget
          setSelected(item)
        }}>
          <h3 style={styles.title}>{item.title || '无标题长文'}</h3>
          {summary !== '' && <p style={styles.summary}>{summary}</p>}
          <span style={styles.meta}>{[item.sourceTitle, articleDate(item.sendAtMillis)].filter(Boolean).join(' · ')}</span>
        </button>
      })}
    </div>
    {!loading && !error && page?.items.length === 0 && <p style={styles.state}>{page.hasMore ? '正在查找更多长文…' : '暂无长文'}</p>}
    <div ref={sentinel} style={styles.state}>
      {loading ? <span role="status">正在加载长文…</span> : error ? <span role="alert">{error}<button type="button" style={styles.retry} onClick={() => { void load(page?.hasMore ? page.nextCursor : undefined) }}>重试</button></span>
        : page?.hasMore && <button type="button" style={styles.retry} onClick={() => { void load(page.nextCursor) }}>加载更多长文</button>}
    </div>
    {selected?.targetSource !== undefined && typeof document !== 'undefined' && createPortal(
      <ArkmeLongArticleDialog
        sourceRef={selected.targetSource.sourceRef}
        item={{ itemUid: selected.recordUid, title: selected.title, textContent: selected.textContent, sendAtMillis: selected.sendAtMillis }}
        overlayZIndex={10040}
        onClose={closeArticle}
        onUpdated={detail => {
          setPage(current => current === undefined ? current : { ...current, items: current.items.map(item => identity(item) !== identity(selected) ? item : { ...item, title: detail.title, textContent: detail.textContent, snippet: '', ...(detail.textFormat === undefined ? {} : { textFormat: detail.textFormat }) }) })
        }}
      />, document.body,
    )}
  </section>
}
