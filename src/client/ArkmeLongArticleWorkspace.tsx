import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { SidebarSimple } from '@phosphor-icons/react/dist/icons/SidebarSimple'
import { ListBullets } from '@phosphor-icons/react/dist/icons/ListBullets'
import { X } from '@phosphor-icons/react/dist/icons/X'
import type { ArkmeLongArticleDetail, ArkmeSearchRecordItem } from '../types.js'
import type { ArkmeLongArticleDialogProps } from './ArkmeLongArticleDialog.js'
import { ArkmeLongArticleQuickView } from './ArkmeLongArticleQuickView.js'
import { arkmeAuthStore } from './auth-store.js'
import { useArticleOutline } from './use-article-outline.js'
import { tr } from './locale.js'
import css from './long-article-workspace.css?inline'

export interface ArticleWorkspaceFrame {
  bodyRef(node: HTMLDivElement | null): void
  leading: ReactNode; trailing: ReactNode
  registerClose(handler: () => void): () => void
  onLeaveFailed(): void
  closeTransient(): boolean
}
export type ArticleWorkspaceSelection = Pick<ArkmeLongArticleDialogProps, 'sourceRef' | 'item'> & { displayName?: string }
export function ArkmeLongArticleWorkspace({ initial, props, renderArticle, standalone = false }: {
  initial: ArticleWorkspaceSelection; props: ArkmeLongArticleDialogProps
  standalone?: boolean
  renderArticle(selection: ArticleWorkspaceSelection, frame: ArticleWorkspaceFrame, onClose: () => void,
    onUpdated: (detail: ArkmeLongArticleDetail) => Promise<void>, windowMode: ArkmeLongArticleDialogProps['windowMode']): ReactNode
}) {
  const root = useRef<HTMLElement>(null), directory = useRef<HTMLDivElement>(null), closer = useRef<() => void>()
  const [selection, setSelection] = useState(initial), pending = useRef<() => void>()
  const key = `${selection.sourceRef}:${selection.item?.itemUid ?? 'new'}`
  const phase = useMemo(() => ({ finished: false }), [key])
  const [bodyState, setBodyState] = useState<{ key: string; node: HTMLDivElement | null }>()
  const body = bodyState?.key === key ? bodyState.node : null
  const bodyRef = useCallback((node: HTMLDivElement | null) => setBodyState({ key, node }), [key])
  const [hydrated, setHydrated] = useState(false)
  const positions = useRef(new Map<string, number>()).current
  const { entries, active, navigate } = useArticleOutline(body, key, positions)
  const [left, setLeft] = useState(true), [right, setRight] = useState(true)
  const [compact, setCompact] = useState(() => typeof window !== 'undefined' && typeof window.innerWidth === 'number' && window.innerWidth < 1000)
  const [mobile, setMobile] = useState<'directory' | 'outline'>()
  const mobileRef = useRef(mobile); mobileRef.current = mobile
  useEffect(() => { if (!compact) setMobile(undefined) }, [compact])
  const [updatedArticle, setUpdatedArticle] = useState<{ sourceRef: string; detail: ArkmeLongArticleDetail }>()
  const auth = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot, arkmeAuthStore.getSnapshot)
  const account = `${auth.auth?.environment}:${auth.auth?.userId}`, initialAccount = useRef(account)
  const sameAccount = account === initialAccount.current
  const showLeft = compact ? mobile === 'directory' : left
  const showRight = entries.length > 0 && (compact ? mobile === 'outline' : right)
  const initialKey = `${initial.sourceRef}:${initial.item?.itemUid ?? 'new'}`, previousInitial = useRef(initialKey)
  useEffect(() => { if (previousInitial.current !== initialKey) { previousInitial.current = initialKey; pending.current = undefined; setSelection(initial) } }, [initialKey])
  useLayoutEffect(() => {
    const element = root.current
    if (!element) return
    setHydrated(true)
    const update = () => setCompact(element.getBoundingClientRect().width < 1000)
    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update); observer.observe(element)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    const previous = typeof document === 'undefined' ? null : document.activeElement
    root.current?.focus()
    return () => { if (typeof HTMLElement !== 'undefined' && previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true }) }
  }, [])
  const registerClose = useCallback((handler: () => void) => { closer.current = handler; return () => { if (closer.current === handler) closer.current = undefined } }, [])
  const onLeaveFailed = useCallback(() => { pending.current = undefined }, [])
  const closeTransient = useCallback(() => { if (!mobileRef.current) return false; setMobile(undefined); return true }, [])
  const finish = useCallback(() => {
    if (phase.finished) return
    phase.finished = true
    const action = pending.current; pending.current = undefined
    if (action) action(); else props.onClose()
  }, [phase, props.onClose])
  const requestExit = () => { pending.current = undefined; if (closer.current) closer.current(); else props.onClose() }
  const choose = (item: ArkmeSearchRecordItem) => {
    if (!sameAccount || !item.targetSource || !closer.current) return
    const next = { sourceRef: item.targetSource.sourceRef, displayName: item.targetSource.displayName,
      item: { itemUid: item.recordUid, title: item.title, textContent: item.textContent, sendAtMillis: item.sendAtMillis,
        ...(item.recordOwnerUserId !== undefined ? { recordOwnerUserId: item.recordOwnerUserId } : {}),
        ...(item.textFormat ? { textFormat: item.textFormat } : {}) } }
    if (selection.sourceRef === next.sourceRef && selection.item?.itemUid === next.item.itemUid) { setMobile(undefined); return }
    if (body) positions.set(key, body.scrollTop)
    pending.current = () => { setSelection(next); setMobile(undefined) }
    closer.current()
  }
  const onUpdated = async (detail: ArkmeLongArticleDetail) => {
    setUpdatedArticle({ sourceRef: selection.sourceRef, detail })
    // Existing callbacks refer to their opening message/window. Never apply a
    // navigated document's edit receipt to that different original message.
    if (selection.sourceRef === initial.sourceRef && detail.itemUid === initial.item?.itemUid) await props.onUpdated?.(detail)
  }
  const mode = useMemo(() => props.windowMode ? { ...props.windowMode,
    displayName: selection.displayName ?? props.windowMode.displayName,
    cancelClose: () => { pending.current = undefined; props.windowMode?.cancelClose() },
    subscribeClose: (listener: () => void) => props.windowMode!.subscribeClose(() => { pending.current = undefined; listener() }),
  } : undefined, [props.windowMode, selection.displayName])
  const frame: ArticleWorkspaceFrame = {
    bodyRef, registerClose, onLeaveFailed, closeTransient,
    leading: <button type="button" className="arkme-article-workspace-control" aria-label={tr(showLeft ? '收起长文列表' : '展开长文列表')} title={tr(showLeft ? '收起长文列表' : '展开长文列表')}
      aria-expanded={showLeft} onClick={() => compact ? setMobile(showLeft ? undefined : 'directory') : setLeft(value => !value)}><SidebarSimple size={20} /></button>,
    trailing: <div className="arkme-article-workspace-controls">
      {entries.length > 0 && <button type="button" className="arkme-article-workspace-control" aria-label={tr(showRight ? '收起大纲' : '展开大纲')} title={tr(showRight ? '收起大纲' : '展开大纲')}
        aria-expanded={showRight} onClick={() => compact ? setMobile(showRight ? undefined : 'outline') : setRight(value => !value)}><ListBullets size={20} /></button>}
      {!props.windowMode && <button type="button" className="arkme-article-workspace-control" aria-label={tr('关闭长文')} title={tr('关闭长文')} onClick={requestExit}><X size={20} /></button>}
    </div>,
  }
  const minLevel = Math.min(...entries.map(entry => entry.level))
  return <div className="arkme-article-workspace-backdrop" data-standalone={standalone || !!props.windowMode} style={{ zIndex: props.overlayZIndex ?? 1200 }}
    onMouseDown={event => { if (event.target === event.currentTarget) requestExit() }}>
    <style>{css}</style>
    <section ref={root} role="dialog" aria-modal={props.windowMode ? undefined : true} aria-label={tr('长文工作区')} tabIndex={-1} className="arkme-article-workspace"
      data-left={showLeft} data-right={showRight} data-compact={compact} onKeyDown={event => {
        if (event.defaultPrevented || event.key !== 'Tab' || (event.target as HTMLElement).closest('[role=alertdialog]')) return
        const controls = [...(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]') ?? [])].filter(node => node.getClientRects().length > 0 && !node.closest('[hidden],[inert]'))
        const first = controls[0], last = controls.at(-1)
        if (event.shiftKey && (document.activeElement === first || document.activeElement === root.current)) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }}>
      <aside className="arkme-article-workspace-side arkme-article-workspace-directory" aria-label={tr('所有长文')} hidden={!showLeft}>
        <header><h3>{tr('长文')}</h3><button type="button" aria-label={tr('收起长文列表')} onClick={() => compact ? setMobile(undefined) : setLeft(false)}><SidebarSimple size={18} /></button></header>
        <div className="arkme-article-workspace-scroll" ref={directory}>
          {sameAccount ? <ArkmeLongArticleQuickView titleOnly active={hydrated && showLeft} initialPage={props.initialDirectoryPage} scrollRoot={directory}
            currentArticle={selection.item ? { sourceRef: selection.sourceRef, itemUid: selection.item.itemUid,
              ...(selection.sourceRef !== 'snapshot' && selection.item.recordOwnerUserId !== undefined ? { recordOwnerUserId: selection.item.recordOwnerUserId } : {}),
              title: updatedArticle?.sourceRef === selection.sourceRef && updatedArticle.detail.itemUid === selection.item.itemUid ? updatedArticle.detail.title : selection.item.title ?? '' } : undefined}
            onChooseArticle={choose} updatedArticle={updatedArticle} /> : <p role="status">{tr('账号已切换')}</p>}
        </div>
      </aside>
      <div className="arkme-article-workspace-main">{renderArticle(selection, frame, finish, onUpdated, mode)}</div>
      <aside className="arkme-article-workspace-side arkme-article-workspace-outline" aria-label={tr('文章大纲')} hidden={!showRight}>
        <header><h3>{tr('大纲')}</h3><button type="button" aria-label={tr('收起大纲')} onClick={() => compact ? setMobile(undefined) : setRight(false)}><X size={16} /></button></header>
        <nav className="arkme-article-workspace-scroll" aria-label={tr('标题导航')}>
          {entries.map(entry => <button key={entry.key} type="button" className="arkme-article-outline-item" title={entry.title}
            aria-current={active === entry.key ? 'location' : undefined} style={{ paddingLeft: 8 + (entry.level - minLevel) * 12 }} onClick={() => { navigate(entry); if (compact) setMobile(undefined) }}>{entry.title}</button>)}
        </nav>
      </aside>
      {compact && mobile && <button type="button" className="arkme-article-workspace-scrim" aria-label={tr('关闭侧栏')} onClick={() => setMobile(undefined)} />}
    </section>
  </div>
}
