import { useEffect, useId, useRef, useState, useSyncExternalStore, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Plus } from '@phosphor-icons/react/dist/icons/Plus'
import { X } from '@phosphor-icons/react/dist/icons/X'
import type { ArkmeLongArticleBrowseScope, ArkmeSearchRecordItem, ArkmeSourceItem } from '../types.js'
import { callArkme } from './api.js'
import { arkmeAuthStore } from './auth-store.js'
import { arkmeTheme } from './arkme-theme.js'
import { ArkmeLongArticleQuickView } from './ArkmeLongArticleQuickView.js'
import { ArkmeLongArticleDialog } from './ArkmeLongArticleDialog.js'
import { withArkmeReadDeadline } from './read-deadline.js'
import { arkmeUi } from './ui-controller.js'
import { tr, useArkmeLocale } from './locale.js'
import { openBrowseWindow, openLongArticleWindow, longArticleWindowBridge } from './long-article-window.js'
import css from './long-article-library.css?inline'
import { longArticleSearchTimelineItem } from './long-article-search-item.js'

const scopes: { key: ArkmeLongArticleBrowseScope; label: string }[] = [
  { key: 'recent', label: '最近' }, { key: 'shared_by_me', label: '我共享的' }, { key: 'shared_with_me', label: '共享给我的' },
]

type LibraryProps = { onClose(): void; returnFocusRef?: RefObject<HTMLElement>; standalone?: boolean }
export function ArkmeLongArticleLibraryDialog(props: LibraryProps) {
  const [fallback, setFallback] = useState(props.standalone === true || (longArticleWindowBridge()?.version ?? 0) < 3)
  const [error, setError] = useState('')
  const close = useRef(props.onClose); close.current = props.onClose
  useEffect(() => {
    if (props.standalone) return
    let active = true
    void openBrowseWindow('library').then(opened => { if (active) { if (opened) close.current(); else setFallback(true) } })
      .catch(reason => { if (active) { setError(reason instanceof Error ? reason.message : '无法打开长文窗口'); setFallback(true) } })
    return () => { active = false }
  }, [])
  return <>{error && <p role="alert">{error}</p>}{fallback && <LibraryContent {...props} />}</>
}
function LibraryContent({ onClose, returnFocusRef, standalone }: LibraryProps) {
  useArkmeLocale()
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    if (!standalone) return
    const refresh = () => setRevision(value => value + 1)
    const stop = longArticleWindowBridge()?.onChanged?.(refresh)
    return () => { stop?.() }
  }, [standalone])
  const id = useId(), root = useRef<HTMLElement>(null)
  const recent = useRef<HTMLDivElement>(null), sent = useRef<HTMLDivElement>(null), received = useRef<HTMLDivElement>(null)
  const panels = { recent, shared_by_me: sent, shared_with_me: received }
  const auth = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot, arkmeAuthStore.getSnapshot)
  const account = auth.auth ? `${auth.auth.environment}:${auth.auth.userId}` : ''
  const originalAccount = useRef(account), mounted = useRef(true), close = useRef(onClose); close.current = onClose
  const [scope, setScope] = useState<ArkmeLongArticleBrowseScope>('recent')
  const [visited, setVisited] = useState<ArkmeLongArticleBrowseScope[]>(['recent'])
  const [preparing, setPreparing] = useState(false), [error, setError] = useState('')
  const request = useRef<AbortController>()
  const [creating, setCreating] = useState<ArkmeSourceItem>()
  const [created, setCreated] = useState<ArkmeSearchRecordItem>()
  const choose = (next: ArkmeLongArticleBrowseScope) => { setScope(next); setVisited(previous => previous.includes(next) ? previous : [...previous, next]) }
  useEffect(() => {
    mounted.current = true
    const previous = returnFocusRef?.current ?? (typeof document === 'undefined' ? null : document.activeElement)
    root.current?.focus()
    return () => { mounted.current = false; request.current?.abort(); if (typeof HTMLElement !== 'undefined' && previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true }) }
  }, [])
  useEffect(() => { if (account !== originalAccount.current) { request.current?.abort(); close.current() } }, [account])
  const create = async () => {
    if (request.current) return
    const controller = new AbortController(); request.current = controller
    setPreparing(true); setError('')
    try {
      const target = await withArkmeReadDeadline(signal => callArkme<ArkmeSourceItem>('sources.self-target', {}, signal), controller.signal)
      if (controller.signal.aborted || !mounted.current) return
      const current = arkmeAuthStore.getSnapshot().auth
      if (`${current?.environment}:${current?.userId}` !== originalAccount.current) throw new Error('账号已切换，请重新打开长文')
      if (target.kind !== 'send_to_self' || !target.sourceRef) throw new Error('暂时无法读取发给自己，请重试')
      if (standalone) {
        if (!await openLongArticleWindow({ ...target, sourceKey: target.sourceKey ?? target.sourceRef }, undefined, true)) throw new Error('当前客户端不支持长文窗口')
      } else setCreating(target)
    } catch (reason) { if (!controller.signal.aborted && mounted.current) setError(reason instanceof Error ? reason.message : '无法新建长文，请重试') }
    finally { if (request.current === controller) { request.current = undefined; if (mounted.current) setPreparing(false) } }
  }
  const body = <div className="arkme-article-library-backdrop" data-native-window={standalone || undefined} data-arkme-notification-blocking-overlay="true" onMouseDown={event => { if (event.target === event.currentTarget && !creating) onClose() }}>
    <style>{css}</style>
    <section ref={root} data-arkme-long-article-library role="dialog" aria-modal={standalone ? undefined : true} aria-label={tr('长文库')} tabIndex={-1}
      className="arkme-article-library" style={{ background: arkmeTheme.base, color: arkmeTheme.text }}
      {...(creating ? { inert: '', 'aria-hidden': true } : {})}
      onKeyDown={event => {
        if (event.defaultPrevented || !root.current?.contains(event.target as Node)) return
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose() }
        if (event.key === 'Tab') {
          const nodes = [...(root.current.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),[tabindex="0"]'))].filter(node => node.getClientRects().length > 0)
          const first = nodes[0], last = nodes.at(-1)
          if (event.shiftKey && (document.activeElement === first || document.activeElement === root.current)) { event.preventDefault(); last?.focus() }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
        }
      }}>
      <header className="arkme-article-library-header"><h2>{tr('长文')}</h2>
        <button type="button" disabled={preparing} aria-busy={preparing} onClick={() => { void create() }}><Plus size={16} aria-hidden />{tr(preparing ? '准备中…' : '新建长文')}</button>
        {!standalone && <button type="button" aria-label={tr('关闭长文库')} onClick={onClose}><X size={20} aria-hidden /></button>}
      </header>
      {error && <p className="arkme-article-library-error" role="alert" style={{ color: arkmeTheme.danger }}>{error}</p>}
      <div className="arkme-article-library-tabs" role="tablist" aria-label={tr('长文分类')}>
        {scopes.map((item, index) => <button key={item.key} id={`${id}-${item.key}-tab`} type="button" role="tab" aria-selected={scope === item.key}
          aria-controls={`${id}-${item.key}-panel`} tabIndex={scope === item.key ? 0 : -1} onClick={() => choose(item.key)}
          onKeyDown={event => {
            const next = event.key === 'ArrowRight' ? (index + 1) % scopes.length : event.key === 'ArrowLeft' ? (index + scopes.length - 1) % scopes.length : event.key === 'Home' ? 0 : event.key === 'End' ? scopes.length - 1 : -1
            if (next < 0) return
            event.preventDefault(); choose(scopes[next]!.key)
            root.current?.querySelector<HTMLButtonElement>(`[id="${id}-${scopes[next]!.key}-tab"]`)?.focus()
          }}>{tr(item.label)}</button>)}
      </div>
      {scopes.filter(item => visited.includes(item.key)).map(item => <div key={item.key} ref={panels[item.key]} id={`${id}-${item.key}-panel`} role="tabpanel"
        aria-labelledby={`${id}-${item.key}-tab`} className="arkme-article-library-panel" hidden={scope !== item.key}>
        <ArkmeLongArticleQuickView key={`${item.key}:${revision}`} onChooseArticle={standalone ? item => {
          if (!item.targetSource) return
          void openLongArticleWindow({ ...item.targetSource, sourceKey: item.targetSource.sourceKey ?? item.targetSource.sourceRef }, { mode: 'existing', item: longArticleSearchTimelineItem(item) }).catch(reason => setError(reason instanceof Error ? reason.message : '无法打开长文'))
        } : undefined} scope={item.key} active={scope === item.key} scrollRoot={panels[item.key]} created={created} />
      </div>)}
    </section>
    {creating && <ArkmeLongArticleDialog sourceRef={creating.sourceRef} overlayZIndex={10060} onClose={() => {
      setCreating(undefined); requestAnimationFrame(() => root.current?.querySelector<HTMLButtonElement>('.arkme-article-library-header button')?.focus())
    }} onCreated={item => {
      setCreated({ recordUid: item.itemUid, ...(auth.auth?.userId !== undefined ? { recordOwnerUserId: auth.auth.userId } : {}), sourceKind: 1, routeTargetKind: 'record_detail',
        sendAtMillis: item.sendAtMillis, title: item.title ?? '', textContent: item.textContent, snippet: '', templateKind: 8, displayKind: 1,
        ...(item.textFormat ? { textFormat: item.textFormat } : {}), sourceTitle: creating.displayName, targetSource: creating, media: [], files: [] })
      choose('recent'); arkmeUi.recordChanged()
    }} onUpdated={detail => { setCreated(previous => previous?.recordUid === detail.itemUid ? { ...previous, title: detail.title, textContent: detail.textContent } : previous); arkmeUi.recordChanged() }} />}
  </div>
  return typeof document === 'undefined' ? body : createPortal(body, document.body)
}
