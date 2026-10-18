import { useEffect, useId, useMemo, useReducer, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { openMarkedMessageSelection, registeredMessageTargets, type MessageSelectionTarget } from './ArkmeMessageTextSelection.js'
import { quoteDigest, quoteHighlightRange } from './message-quote-selection.js'
import { quoteSourceContent, type ArkmeMessageQuote } from '../message-quote.js'
import type { MessageUnderline } from '../message-annotations.js'
import { MessageUnderlineSession, underlineTargetKey } from './message-underline-session.js'
import { arkmeTheme } from './arkme-theme.js'

export type MarkPosition = { key: string; target: MessageSelectionTarget; ids: string[]; left: number; top: number; width: number; height: number; element?: HTMLElement; stale: boolean; changed?: boolean; pending: boolean }
const surfaceIds = new WeakMap<HTMLElement, number>()
let nextSurfaceId = 0
function surfaceId(element?: HTMLElement) {
  if (!element) return 0
  if (!surfaceIds.has(element)) surfaceIds.set(element, ++nextSurfaceId)
  return surfaceIds.get(element)
}
/** Split overlapping highlights into disjoint spans so each span reports every actual marker. */
export function mergeUnderlinePositions(positions: MarkPosition[]): MarkPosition[] {
  const result = positions.filter(position => position.stale)
  const lines = new Map<string, MarkPosition[]>()
  for (const position of positions.filter(position => !position.stale)) {
    const key = `${surfaceId(position.element)}:${underlineTargetKey(position.target)}:${position.top.toFixed(1)}`
    lines.set(key, [...(lines.get(key) ?? []), position])
  }
  for (const [key, line] of lines) {
    const edges = [...new Set(line.flatMap(position => [position.left, position.left + position.width]))].sort((a, b) => a - b)
    for (let i = 1; i < edges.length; i++) {
      const left = edges[i - 1]!, right = edges[i]!
      const covering = line.filter(position => position.left < right && position.left + position.width > left)
      if (covering.length && right - left > 0.1) result.push({ ...covering[0]!, key: `${key}:${left}`, left, width: right - left,
        ids: [...new Set(covering.flatMap(position => position.ids))], pending: covering.some(position => position.pending) })
    }
  }
  return result
}
function visibleBox(element: HTMLElement) {
  let left = 0, top = 0, right = innerWidth, bottom = innerHeight
  for (let parent: HTMLElement | null = element; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent)
    if (style.display === 'none' || style.visibility === 'hidden') return undefined
    const box = parent.getBoundingClientRect()
    if (/(auto|scroll|hidden|clip)/u.test(style.overflowX)) { left = Math.max(left, box.left); right = Math.min(right, box.right) }
    if (/(auto|scroll|hidden|clip)/u.test(style.overflowY)) { top = Math.max(top, box.top); bottom = Math.min(bottom, box.bottom) }
  }
  const box = element.getBoundingClientRect()
  return box.bottom > top && box.top < bottom && box.right > left && box.left < right ? { left, top, right, bottom } : undefined
}

export function useMessageUnderlines(scope: string, sourceRef: string | undefined, viewerId: number | undefined) {
  const [revision, update] = useReducer((value: number) => value + 1, 0)
  const session = useMemo(() => sourceRef && viewerId ? new MessageUnderlineSession(sourceRef, viewerId, update, 'local') : undefined, [scope, !!sourceRef, viewerId])
  if (session && sourceRef) session.sourceRef = sourceRef
  useEffect(() => { if (session) void session.prepare(); return () => session?.dispose() }, [session])
  return {
    mark: session ? async (target: MessageSelectionTarget, anchor: ArkmeMessageQuote) => {
      if (!session.capability?.supported) {
        await session.prepare()
        if (!session.capability?.supported) return session.notice || '正在确认标记支持情况，请稍后重试'
      }
      if (session.pending.has(underlineTargetKey(target))) return '这条消息的标记正在同步'
      if (anchor.text.length > session.capability.maxLength) return `标记最多 ${session.capability.maxLength} 个字符`
      // Clear selection now so the optimistic highlight is immediately visible.
      void session.change(target, { kind: 'add', anchor, operationId: crypto.randomUUID() }).catch(error => {
        if (!session.controller.signal.aborted) { session.notice = error instanceof Error ? error.message : '标记失败，请重试'; update() }
      })
      return undefined
    } : undefined,
    getMarks: session ? (target: MessageSelectionTarget) => session.snapshots.get(underlineTargetKey(target))?.items ?? [] : undefined,
    remove: session ? async (target: MessageSelectionTarget, mark: MessageUnderline) => {
      if (!mark.mine) return '只能取消自己的标记'
      if (session.pending.has(underlineTargetKey(target))) return '这条消息的标记正在同步'
      void session.change(target, { kind: 'remove', annotationId: mark.id, operationId: crypto.randomUUID() }).catch(error => session.report(error))
      return undefined
    } : undefined,
    layer: session ? <UnderlineLayer key={scope} session={session} revision={revision} /> : null,
  }
}

/** Paint outside the text tree: selection, Markdown, copy and message layout stay intact. */
export function UnderlineLayer({ session, revision }: { session: MessageUnderlineSession; revision: number }) {
  const highlightName = `arkme-message-mark-${useId().replace(/[^a-z0-9-]/giu, '')}`
  const highlightApi = globalThis.CSS?.highlights
  const nativeHighlight = !!highlightApi && typeof Highlight !== 'undefined'
  const [positions, setPositions] = useState<MarkPosition[]>([])
  const [popup, setPopup] = useState<MarkPosition>()
  const currentPositions = useRef(positions)
  currentPositions.current = positions
  const forceRead = useRef<() => void>()
  const digestCache = useRef(new Map<string, Promise<string>>())
  const signature = useRef('')
  useEffect(() => {
    if (!session.capability?.supported) {
      highlightApi?.delete(highlightName)
      setPositions(previous => previous.length ? [] : previous)
      return
    }
    let disposed = false, frame = 0, generation = 0
    const scan = async (force = false) => {
      const currentGeneration = ++generation
      if (document.hidden) return
      const targets = registeredMessageTargets(session.sourceRef).filter(({ element }) => visibleBox(element))
      const nextSignature = targets.map(({ target }) => target.item.messageActionRef).join('|')
      if (force || nextSignature !== signature.current) {
        signature.current = nextSignature
        void session.read(targets.map(({ target }) => target))
      }
      const painted: MarkPosition[] = []
      const ranges: Range[] = []
      for (const { element, target } of targets) {
        const marks = session.snapshots.get(underlineTargetKey(target))?.items ?? []
        if (!marks.length) continue
        const content = quoteSourceContent(target.item)
        if (!digestCache.current.has(content)) {
          if (digestCache.current.size > 150) digestCache.current.clear()
          digestCache.current.set(content, quoteDigest(target.item))
        }
        const digest = await digestCache.current.get(content)
        if (disposed || currentGeneration !== generation || !element.isConnected) return
        const clip = visibleBox(element)
        if (!clip) continue
        const stale: MessageUnderline[] = []
        const merged = new Map<string, MarkPosition>()
        for (const mark of marks) {
          const range = mark.state === 'available' && mark.anchor.sourceDigest === digest ? quoteHighlightRange(element, mark.anchor) : undefined
          if (!range) { stale.push(mark); continue }
          ranges.push(range)
          for (const rect of Array.from(range.getClientRects())) {
            const left = Math.max(rect.left, clip.left), right = Math.min(rect.right, clip.right), top = Math.max(rect.top, clip.top)
            const bottom = Math.min(rect.bottom, clip.bottom)
            if (right <= left || bottom <= top) continue
            const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2)
            if (hit && !element.contains(hit) && !hit.closest('[data-arkme-underline-layer]')) continue
            const geometryKey = `${left.toFixed(1)}:${top.toFixed(1)}:${right.toFixed(1)}`
            const existing = merged.get(geometryKey)
            if (existing) { existing.ids.push(mark.id); existing.pending ||= !!mark.pending; continue }
            merged.set(geometryKey, { key: `${painted.length}:${geometryKey}`, target, ids: [mark.id], left, top, width: right - left, height: bottom - top, element, stale: false, pending: !!mark.pending })
          }
        }
        painted.push(...merged.values())
        if (stale.length) {
          const box = element.getBoundingClientRect()
          if (box.bottom <= clip.bottom) painted.push({ key: `stale:${painted.length}`, target, ids: stale.map(mark => mark.id), left: Math.max(clip.left, box.right - 145), top: box.bottom - 4, width: 145, height: 20, element, stale: true, changed: stale.some(mark => mark.state === 'stale' || mark.anchor.sourceDigest !== digest), pending: false })
        }
      }
      if (disposed || currentGeneration !== generation) return
      if (nativeHighlight) {
        highlightApi.set(highlightName, new Highlight(...ranges))
      }
      const merged = mergeUnderlinePositions(painted)
      const geometry = (values: MarkPosition[]) => JSON.stringify(values.map(({ target, element: _element, ...position }) => ({ ...position, target: target.item.messageActionRef, content: quoteSourceContent(target.item), version: target.item.recordVersion })))
      setPositions(previous => previous.length === merged.length && previous.every((position, index) => position.element === merged[index]?.element)
        && geometry(previous) === geometry(merged) ? previous : merged)
    }
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => { void scan() }) }
    const sync = () => { void scan(true) }
    forceRead.current = sync
    const observer = new MutationObserver(records => {
      if (records.some(record => !(record.target instanceof Element ? record.target : record.target.parentElement)?.closest('[data-arkme-underline-layer]'))) schedule()
    })
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })
    const resize = new ResizeObserver(schedule); resize.observe(document.body)
    document.addEventListener('scroll', schedule, true); window.addEventListener('resize', schedule)
    window.addEventListener('focus', sync); document.addEventListener('visibilitychange', sync)
    // Lightweight, visible-message reconciliation until a backend annotation event is available.
    const interval = setInterval(sync, 15_000)
    void scan()
    return () => {
      disposed = true; ++generation; cancelAnimationFrame(frame); clearInterval(interval); observer.disconnect(); resize.disconnect()
      document.removeEventListener('scroll', schedule, true); window.removeEventListener('resize', schedule)
      window.removeEventListener('focus', sync); document.removeEventListener('visibilitychange', sync)
    }
  }, [session, revision, highlightName, nativeHighlight])
  useEffect(() => () => {
    highlightApi?.delete(highlightName)
  }, [session, highlightName])
  useEffect(() => {
    let down: { x: number; y: number } | undefined
    const dismiss = (event: Event) => { if (!(event.target instanceof Element) || !event.target.closest('[data-arkme-underline-layer]')) setPopup(undefined) }
    const pointer = (event: MouseEvent) => { down = { x: event.clientX, y: event.clientY }; dismiss(event) }
    const click = (event: MouseEvent) => {
      if (event.button !== 0 || event.defaultPrevented || !down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 4) return
      down = undefined
      if (!document.getSelection()?.isCollapsed) return // Never steal a drag selection.
      const hit = event.target instanceof Element ? event.target : (event.target as Node)?.parentElement
      if (!hit || hit.closest('a,button,input,textarea,[contenteditable="true"],[data-arkme-text-selection-toolbar]')) return
      const position = currentPositions.current.find(p => !p.stale && p.element?.contains(hit)
        && event.clientX >= p.left && event.clientX <= p.left + p.width && event.clientY >= p.top && event.clientY <= p.top + p.height)
      if (!position?.element) return
      const fresh = registeredMessageTargets(session.sourceRef).find(row => row.element === position.element)
      if (!fresh || quoteSourceContent(fresh.target.item) !== quoteSourceContent(position.target.item)
        || fresh.target.item.recordVersion !== position.target.item.recordVersion) return
      const items = (session.snapshots.get(underlineTargetKey(position.target))?.items ?? []).filter(item => position.ids.includes(item.id) && item.state === 'available')
      // Select the full original range so cancellation scope is visible. Prefer my smallest mark.
      const selected = items.sort((a, b) => Number(b.mine) - Number(a.mine) || (a.anchor.end - a.anchor.start) - (b.anchor.end - b.anchor.start))[0]
      const range = selected && quoteHighlightRange(position.element, selected.anchor)
      if (!range || !selected) return
      if (openMarkedMessageSelection(position.element, range, selected.anchor)) { event.preventDefault(); event.stopPropagation() }
    }
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') setPopup(undefined) }
    document.addEventListener('mousedown', pointer, true); document.addEventListener('click', click, true)
    document.addEventListener('keydown', key); document.addEventListener('scroll', dismiss, true)
    return () => {
      document.removeEventListener('mousedown', pointer, true); document.removeEventListener('click', click, true)
      document.removeEventListener('keydown', key); document.removeEventListener('scroll', dismiss, true)
    }
  }, [session])
  const popupItems = popup ? (session.snapshots.get(underlineTargetKey(popup.target))?.items ?? []).filter(item => popup.ids.includes(item.id)) : []
  const cancel = async (mark: MessageUnderline) => {
    if (!popup) return
    try { await session.change(popup.target, { kind: 'remove', annotationId: mark.id, operationId: crypto.randomUUID() }); forceRead.current?.() }
    catch (error) { session.notice = error instanceof Error ? error.message : '取消失败'; setPopup(undefined) }
  }
  return createPortal(<div data-arkme-underline-layer onClick={event => event.stopPropagation()}>
    <style>{`
      ::highlight(${highlightName}) { background-color: rgba(233, 180, 47, .28); }
      body[data-ds-dark-theme] ::highlight(${highlightName}) { background-color: rgba(244, 194, 67, .32); }
      [data-arkme-mark-paint] { background-color: rgba(233, 180, 47, .24); }
      body[data-ds-dark-theme] [data-arkme-mark-paint] { background-color: rgba(244, 194, 67, .26); }
    `}</style>
    {positions.map((position, index) => position.stale ? <button key={`${position.key}:${index}`} type="button"
      aria-label="查看未定位标记" onClick={event => { event.preventDefault(); setPopup(position) }}
      style={{ position: 'fixed', left: position.left, top: position.top, width: position.width, height: 20, zIndex: 900,
        border: 0, padding: 0, borderRadius: 2, background: arkmeTheme.menu, color: arkmeTheme.secondary, fontSize: 11, cursor: 'pointer' }}>
      {position.changed ? '原文已修改 · 查看标记' : '查看未定位标记'}
    </button> : !nativeHighlight && <span key={`${position.key}:${index}`} data-arkme-mark-paint aria-hidden
      style={{ position: 'fixed', left: position.left, top: position.top, width: position.width, height: position.height, zIndex: 900,
        pointerEvents: 'none', borderRadius: 2 }} />)}
    {popup && popupItems.length > 0 && <div role="dialog" aria-label="标记详情"
      style={{ position: 'fixed', zIndex: 12001, left: Math.max(8, Math.min(popup.left, innerWidth - 300)), top: Math.max(8, Math.min(popup.top + 8, innerHeight - 180)),
        maxWidth: 280, maxHeight: 160, overflowY: 'auto', padding: 10, borderRadius: 8, border: `1px solid ${arkmeTheme.border}`, background: arkmeTheme.menu, boxShadow: arkmeTheme.shadow, color: arkmeTheme.text, fontSize: 12 }}>
      <div>{[...new Set(popupItems.map(item => item.mine ? '你' : item.actorName))].join('、')}标记了这段</div>
      <div style={{ color: arkmeTheme.secondary, marginTop: 4 }}>{popup.stale ? popup.changed ? '原文已修改，未在新文字中猜测位置' : '当前内容折叠或展示不同，可在消息详情查看原文' : '标记不修改原消息'}</div>
      {popup.stale && popupItems.map(item => <div key={item.id} style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>“{item.anchor.text}”</div>)}
      {popupItems.filter(item => item.mine).map(item => <button key={item.id} type="button" disabled={session.pending.has(underlineTargetKey(popup.target))} onClick={() => { void cancel(item) }} style={actionStyle}>取消我的标记</button>)}
    </div>}
    {session.notice && session.capability?.supported && <div role="status" style={{ position: 'fixed', right: 24, bottom: 24, zIndex: 12002, maxWidth: 360, padding: 10, borderRadius: 8, background: arkmeTheme.menu, color: arkmeTheme.secondary, border: `1px solid ${arkmeTheme.border}`, fontSize: 12 }}>
      {session.notice}{session.retry && <button type="button" style={actionStyle} onClick={() => { void session.retry?.().catch(error => session.report(error)) }}>重试</button>}
    </div>}
  </div>, document.body)
}
const actionStyle = { border: 0, background: 'transparent', color: arkmeTheme.info, cursor: 'pointer', font: 'inherit', padding: '6px 4px' }
