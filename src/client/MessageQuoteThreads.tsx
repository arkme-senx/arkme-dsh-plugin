import { callArkme } from './api.js'
import { startMessageProjectionRefresh } from './message-projection-refresh.js'
import type { ArkmeMessageExtensionSummaryItem } from '../message-extension-summary.js'
import { WorldPublicationBadge } from './WorldPublicationControls.js'
import { createContext, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from 'react'
import { ChatCircleText } from '@phosphor-icons/react/dist/icons/ChatCircleText'
import type { ArkmeSourceItem, ArkmeTimelineItem } from '../types.js'
import { registeredMessageTargets } from './ArkmeMessageTextSelection.js'
import { quoteDigest, quoteHighlightRange } from './message-quote-selection.js'
import { MessageQuoteThreadStore } from './message-quote-threads.js'
import { invalidateMessageQuoteSources, subscribeMessageQuoteInvalidations } from './message-quote-invalidations.js'
import { arkmeTheme } from './arkme-theme.js'
import { tr } from './locale.js'
import { ArkmeMessageTimestamp } from './ArkmeMessageTimestamp.js'

const context = createContext<{ store: MessageQuoteThreadStore; open(item: ArkmeTimelineItem): void } | undefined>(undefined)
const subscribeEmpty = () => () => {}, emptyRevision = () => 0
export function useMessageQuoteThreads() {
  const value = useContext(context)
  const revision = useSyncExternalStore(value?.store.subscribe ?? subscribeEmpty, value?.store.getSnapshot ?? emptyRevision, emptyRevision)
  return { ...value, revision }
}
export function MessageQuoteThreadsProvider({ scope, sourceRef, accessKind, chat, items, onOpenComments, children }: {
  scope: string; sourceRef?: string | undefined; accessKind?: ArkmeSourceItem['accessKind']; chat: boolean; items: readonly ArkmeTimelineItem[]; onOpenComments(item: ArkmeTimelineItem): void; children: ReactNode
}) {
  const store = useMemo(() => new MessageQuoteThreadStore(chat), [scope, chat, accessKind])
  useSyncExternalStore(store.subscribe, store.getSnapshot, emptyRevision)
  const open = useRef(onOpenComments); open.current = onOpenComments
  const value = useMemo(() => ({ store, open: (item: ArkmeTimelineItem) => { store.requestComments(item); open.current(item) } }), [store])
  useEffect(() => { store.ingest(items) }, [store, items])
  useEffect(() => {
    // The summary owner requires human membership; delegation grants no such role.
    if (accessKind === 'team_delegation') return
    if (!chat || !sourceRef) return subscribeMessageQuoteInvalidations(() => store.invalidate())
    if (typeof document === 'undefined' || typeof window === 'undefined') return
    const controller = new AbortController()
    const refresh = startMessageProjectionRefresh({
      visible: () => !document.hidden,
      read: () => store.readSummaries(sourceRef, registeredMessageTargets(sourceRef).filter(({ element }) => {
        const box = element.getBoundingClientRect()
        return box.width > 0 && box.height > 0 && box.bottom > 0 && box.top < innerHeight
      }).map(({ target }) => target.item), controller.signal,
        (sourceRef, actionRefs, signal) => callArkme<ArkmeMessageExtensionSummaryItem[]>('source.message-extension.summaries', { sourceRef, actionRefs }, signal)),
      subscribe: invalidate => subscribeMessageQuoteInvalidations(() => { store.invalidate(); invalidate() }),
      onError: () => {}, // The store clears unconfirmed data and supplies the existing inline retry notice.
    })
    const recover = () => { store.invalidate(); refresh.request(0) }
    const visible = () => { if (!document.hidden) recover() }
    const scroll = () => refresh.request()
    window.addEventListener('focus', recover); document.addEventListener('visibilitychange', visible)
    document.addEventListener('scroll', scroll, true)
    return () => { controller.abort(); refresh.dispose(); window.removeEventListener('focus', recover); document.removeEventListener('visibilitychange', visible); document.removeEventListener('scroll', scroll, true) }
  }, [store, sourceRef, accessKind, chat, items])
  return <context.Provider value={value}><MessageQuoteUnderlines store={store} sourceRef={sourceRef}/>{children}{store.notice && <button type="button" aria-live="polite" onClick={() => invalidateMessageQuoteSources()} style={{ border: 0, background: 'transparent', color: arkmeTheme.secondary, font: 'inherit', cursor: 'pointer', padding: 6 }}>{store.notice}</button>}</context.Provider>
}
export function MessageQuoteThreadBadge({ item }: { item: ArkmeTimelineItem }) {
  const value = useMessageQuoteThreads(), thread = value.store?.thread(item)
  if (!thread?.count || !value.open) return null
  return <button type="button" data-arkme-quote-comments aria-label={tr('查看 {count} 条评论', { count: String(thread.count) })}
    title={tr('查看评论')} onClick={event => { event.preventDefault(); event.stopPropagation(); value.open?.(item) }}
    onDoubleClick={event => event.stopPropagation()}
    style={{ display: 'inline-flex', alignItems: 'center', gap: 3, flex: 'none', verticalAlign: 'middle', padding: '1px 2px', marginLeft: 6,
      border: 0, borderRadius: 4, background: 'transparent', color: arkmeTheme.secondary, font: 'inherit', fontSize: 11, cursor: 'pointer' }}>
    <ChatCircleText size={14} aria-hidden/><span>{thread.count}</span>
  </button>
}

export function MessageWorldPublicationBadge({ item, sourceRef }: { item: ArkmeTimelineItem; sourceRef?: string | undefined }) {
  const target = item.isMe && item.quickNoteDetailsSupported !== false && sourceRef && item.messageActionRef ? {source:{sourceRef,messageActionRef:item.messageActionRef,itemUid:item.itemUid}} : undefined
  return <WorldPublicationBadge target={target} corner />
}

export function MessageQuoteThreadTimestamp({ item }: { item: ArkmeTimelineItem }) {
  const value = useMessageQuoteThreads(), count = value.store?.thread(item).count ?? 0
  const groupRef = useRef<HTMLSpanElement>(null)
  // Only messages with a comment count need measurement. Keep the reservation
  // local to this bubble, including after late count updates or unmount.
  useLayoutEffect(() => {
    const group = groupRef.current, bubble = group?.closest<HTMLElement>('.arkme-timed-bubble')
    if (!count || !group || !bubble) return
    const measure = () => bubble.style.setProperty('--arkme-message-time-space', `${Math.max(42, Math.ceil(group.getBoundingClientRect().width) + 8)}px`)
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure)
    observer?.observe(group)
    return () => { observer?.disconnect(); bubble.style.removeProperty('--arkme-message-time-space') }
  }, [count])
  if (!count) return <ArkmeMessageTimestamp at={item.sendAtMillis}/>
  return <span ref={groupRef} data-arkme-message-time-group><ArkmeMessageTimestamp at={item.sendAtMillis}/><MessageQuoteThreadBadge item={item}/></span>
}

function MessageQuoteUnderlines({ store, sourceRef }: { store: MessageQuoteThreadStore; sourceRef?: string | undefined }) {
  const revision = useSyncExternalStore(store.subscribe, store.getSnapshot, emptyRevision)
  const name = `arkme-quote-thread-${useId().replace(/[^a-z0-9]/gi, '')}`
  useEffect(() => {
    const api = globalThis as unknown as { Highlight?: new (...ranges: Range[]) => unknown; CSS?: { highlights?: Map<string, unknown> } }
    if (!sourceRef || !api.Highlight || !api.CSS?.highlights || typeof MutationObserver === 'undefined') return
    const Highlight = api.Highlight, highlights = api.CSS.highlights
    let disposed = false, generation = 0, frame = 0
    const paint = async () => {
      const current = ++generation, ranges: Range[] = []
      for (const { element, target } of registeredMessageTargets(sourceRef)) {
        const box = element.getBoundingClientRect()
        if (box.width <= 0 || box.height <= 0 || box.bottom < 0 || box.top > innerHeight) continue
        const quotes = store.quotes(target.item)
        if (!quotes.length) continue
        const digest = await quoteDigest(target.item)
        for (const quote of quotes) if (quote.sourceDigest === digest) {
          const range = quoteHighlightRange(element, quote)
          if (range) ranges.push(range)
        }
      }
      if (!disposed && current === generation) highlights.set(name, new Highlight(...ranges))
    }
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => { void paint().catch(() => highlights.delete(name)) }) }
    const observer = new MutationObserver(schedule); observer.observe(document.body, { childList: true, subtree: true, characterData: true })
    const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(schedule); resize?.observe(document.body)
    document.addEventListener('scroll', schedule, true); window.addEventListener('resize', schedule)
    schedule()
    return () => { disposed = true; generation++; cancelAnimationFrame(frame); observer.disconnect(); resize?.disconnect(); document.removeEventListener('scroll', schedule, true); window.removeEventListener('resize', schedule); highlights.delete(name) }
  }, [store, sourceRef, revision, name])
  return <style>{`::highlight(${name}) { text-decoration-line: underline; text-decoration-color: ${arkmeTheme.info}; text-decoration-thickness: 1.5px; text-decoration-style: solid; }`}</style>
}
