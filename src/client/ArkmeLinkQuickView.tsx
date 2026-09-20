import { tr, useArkmeLocale, arkmeIntlLocale } from './locale.js'
import { useCallback, useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'
import type { ArkmeRecordSearchResult, ArkmeSearchRecordItem } from '../types.js'
import { arkmeSearchRecordLinks } from '../search-record-links.js'
import { callArkme } from './api.js'
import { arkmeTheme } from './arkme-theme.js'
import { ArkmeTextLink } from './ArkmeLinkText.js'

const styles: Record<string, CSSProperties> = {
  list: { display: 'flex', flexDirection: 'column', gap: 12, padding: '16px 2px' },
  card: { minWidth: 0, padding: '4px 16px 12px', border: `1px solid ${arkmeTheme.border}`, borderRadius: 12, background: arkmeTheme.layer1, color: arkmeTheme.text },
  link: { minWidth: 0, padding: '14px 0', borderBottom: `1px solid ${arkmeTheme.border}`, fontSize: 15, lineHeight: '22px' },
  url: { display: 'block', marginTop: 5, color: arkmeTheme.secondary, fontSize: 12, lineHeight: '18px', overflowWrap: 'anywhere' },
  footer: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 10 },
  meta: { color: arkmeTheme.secondary, fontSize: 12, lineHeight: '18px', overflowWrap: 'anywhere' },
  button: { padding: '6px 10px', border: `1px solid ${arkmeTheme.border}`, borderRadius: 8, background: arkmeTheme.layer1, color: arkmeTheme.text, font: 'inherit', fontSize: 12, cursor: 'pointer' },
  state: { padding: '24px 12px', color: arkmeTheme.secondary, textAlign: 'center', fontSize: 13 },
}

function identity(item: ArkmeSearchRecordItem): string {
  return JSON.stringify([item.recordOwnerUserId, item.recordUid, item.sourceKind, item.sourceUid ?? item.routeTargetUid])
}

function links(item: ArkmeSearchRecordItem): string[] {
  // Validate again at the rendering boundary; older hosts only provide linkUrl/textContent.
  return arkmeSearchRecordLinks((item.linkUrls ?? [item.linkUrl ?? '', item.textContent]).join('\n'))
}

function LinkResult({ href, scrollRoot }: { href: string; scrollRoot?: RefObject<HTMLElement> | undefined }) {
  useArkmeLocale()
  const node = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    if (visible || node.current === null || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect() }
    }, { root: scrollRoot?.current ?? null, rootMargin: '160px 0px' })
    observer.observe(node.current)
    return () => observer.disconnect()
  }, [scrollRoot, visible])
  return <div ref={node} style={styles.link} data-arkme-external-link-result="true">
    <ArkmeTextLink href={href} text={href} fallbackLabel={href} linkLabelMode={visible ? 'resolved' : 'raw'} />
    <span style={styles.url}>{new URL(href).hostname} · {href}</span>
  </div>
}

function LinkRecord({ item, scrollRoot, onOpenRecord }: {
  item: ArkmeSearchRecordItem
  scrollRoot?: RefObject<HTMLElement> | undefined
  onOpenRecord(item: ArkmeSearchRecordItem): void | Promise<void>
}) {
  useArkmeLocale()
  const [expanded, setExpanded] = useState(false)
  const urls = links(item)
  const date = Number.isFinite(item.sendAtMillis) && item.sendAtMillis > 0
    ? new Intl.DateTimeFormat(arkmeIntlLocale(), { year: 'numeric', month: '2-digit', day: '2-digit' }).format(item.sendAtMillis) : ''
  return <article style={styles.card} data-arkme-link-record="true">
    {(expanded ? urls : urls.slice(0, 5)).map(href => <LinkResult key={href} href={href} scrollRoot={scrollRoot} />)}
    <footer style={styles.footer}>
      <span style={styles.meta}>{[item.sourceTitle || item.targetSource?.displayName, date].filter(Boolean).join(' · ')}</span>
      {urls.length > 5 && <button type="button" style={styles.button} onClick={() => setExpanded(value => !value)}>{expanded ? '收起链接' : tr("展开另外 {v0} 个链接", { v0: String(urls.length - 5) })}</button>}
      <button type="button" style={styles.button} data-arkme-feedback="neutral" onClick={() => { void onOpenRecord(item) }}>{tr("查看来源")}</button>
    </footer>
  </article>
}

/** Same scene as Flutter; URL opening and source navigation are separate actions. */
export function ArkmeLinkQuickView({ scrollRoot, onOpenRecord }: {
  scrollRoot?: RefObject<HTMLElement>
  onOpenRecord(item: ArkmeSearchRecordItem): void | Promise<void>
}) {
  useArkmeLocale()
  const [page, setPage] = useState<ArkmeRecordSearchResult>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const generation = useRef(0)
  const request = useRef<AbortController>()
  const inFlight = useRef(false)
  const seenCursors = useRef(new Set<string>())
  const sentinel = useRef<HTMLDivElement>(null)

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
        scene: 'link', limit: 30, ...(cursor === undefined ? {} : { cursor }),
      }, controller.signal)
      if (id !== generation.current) return
      if (controller.signal.aborted) throw new Error('加载超时，请重试')
      if (cursor === undefined) seenCursors.current.clear()
      else seenCursors.current.add(cursor)
      const nextCursor = result.nextCursor?.trim()
      const canContinue = result.hasMore && !!nextCursor && !seenCursors.current.has(nextCursor)
      setPage(current => ({
        ...result, hasMore: canContinue,
        items: [...new Map([...(cursor === undefined ? [] : current?.items ?? []), ...result.items]
          .map(item => [identity(item), item])).values()].filter(item => links(item).length > 0),
      }))
      if (result.hasMore && !canContinue) setError('后续分页暂不可用，请重试')
    } catch (caught) {
      if (id === generation.current) setError(controller.signal.aborted ? '加载超时，请重试' : caught instanceof Error ? caught.message : '链接加载失败，请重试')
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

  return <section aria-label={tr("外部链接快速查找")}>
    <div style={styles.list}>{page?.items.map(item => <LinkRecord key={identity(item)} item={item} scrollRoot={scrollRoot} onOpenRecord={onOpenRecord} />)}</div>
    {!loading && !error && page?.items.length === 0 && <p style={styles.state}>{page.hasMore ? '继续加载以查找更多链接' : '暂无外部链接'}</p>}
    <div ref={sentinel} style={styles.state}>
      {loading ? <span role="status">{tr("正在加载链接…")}</span> : error ? <span role="alert">{error} <button type="button" style={styles.button} onClick={() => { void load(page?.hasMore ? page.nextCursor : undefined) }}>{tr("重试")}</button></span>
        : page?.hasMore && <button type="button" style={styles.button} onClick={() => { void load(page.nextCursor) }}>{tr("加载更多链接")}</button>}
    </div>
  </section>
}
