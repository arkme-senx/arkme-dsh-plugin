import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { captureMessageTextSelection } from './message-text-selection.js'
import { copyText } from './clipboard-text.js'
import { arkmeTheme } from './arkme-theme.js'
import { tr } from './locale.js'
import type { ArkmeTimelineItem } from '../types.js'
import { quoteSourceContent, type ArkmeMessageQuote } from '../message-quote.js'
import type { MessageUnderline } from '../message-annotations.js'
import { captureQuoteAnchor, quoteDigest } from './message-quote-selection.js'
import { findSelectedMessageText } from './message-selection-search.js'
import { ArkmeSelectedTextReplace, type PrepareSelectedTextReplace } from './ArkmeSelectedTextReplace.js'

export interface MessageSelectionTarget {
  item: ArkmeTimelineItem; sourceRef: string
  /** Owner-local authority is never passed to ordinary Chat actions. */
  localMarkRef?: string
  cloudMarkRef?:string
}
export function messageSelectionReference(target: MessageSelectionTarget, storage?:'local'|'cloud'): string | undefined {
  if(storage==='cloud'&&target.cloudMarkRef)return target.cloudMarkRef
  return target.localMarkRef ?? target.item.messageActionRef
}
const targets = new WeakMap<HTMLElement, { copyText: string; reply?: MessageSelectionTarget | undefined }>()
export function registeredMessageTargets(sourceRef: string) {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-arkme-text-selection]')).flatMap(element => {
    const target = targets.get(element)?.reply
    return target?.sourceRef === sourceRef && target.item.status === 1 ? [{ element, target }] : []
  })
}
const targetSelector = '[data-arkme-text-selection]'
const scopeSelector = '[data-arkme-note-detail], [data-arkme-message-selection-scope]'
const excludedSelector = 'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],button,[data-arkme-mention-read]'

/** Ref registration adds no layout wrapper and no per-message document listener. */
export function useMessageTextSelectionTarget(text: string, reply?: MessageSelectionTarget) {
  const replyRef = useRef(reply)
  replyRef.current = reply
  const previous = useRef<HTMLElement | null>(null)
  return useCallback((element: HTMLElement | null) => {
    if (previous.current) {
      targets.delete(previous.current)
      previous.current.removeAttribute('data-arkme-text-selection')
    }
    previous.current = element
    if (element) {
      targets.set(element, { copyText: text, get reply() { return replyRef.current } })
      element.setAttribute('data-arkme-text-selection', '')
    }
  }, [text, reply?.sourceRef, reply?.item.itemUid, reply?.item.recordVersion, reply?.item.status, reply?.item.messageActionRef, reply?.localMarkRef])
}

export function ArkmeSelectableMessageText({ text, children, style, target }: { text: string; children: ReactNode; style?: CSSProperties; target?: MessageSelectionTarget | undefined }) {
  const ref = useMessageTextSelectionTarget(text, target)
  return <div ref={ref} data-arkme-message-content="message" style={style}>{children}</div>
}

function elementFor(node: Node | null): Element | null { return node?.nodeType === 1 ? node as Element : node?.parentElement ?? null }
function targetFor(node: Node | null): HTMLElement | undefined {
  const element = elementFor(node)
  if (element?.closest(excludedSelector)) return undefined
  const target = element?.closest<HTMLElement>(targetSelector)
  return target && targets.has(target) ? target : undefined
}

const openMarkEvent = 'arkme:open-message-mark'
/** Use the same native selection and toolbar for an existing, precisely verified mark. */
export function openMarkedMessageSelection(element: HTMLElement, range: Range, quote: ArkmeMessageQuote): boolean {
  const entry = targets.get(element)
  if (!entry?.reply || !element.isConnected) return false
  const event = new CustomEvent(openMarkEvent, { cancelable: true, detail: { element, range, quote, entry } })
  return !document.dispatchEvent(event)
}
type Snapshot = NonNullable<ReturnType<typeof captureSelection>>
function captureSelection(doc: Document) {
  const selection = doc.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return undefined
  const start = targetFor(selection.anchorNode), end = targetFor(selection.focusNode)
  if (!start || !end) return undefined
  const sameMessage = start === end
  const scope = start.closest<HTMLElement>(scopeSelector)
  if (!sameMessage && (!scope || scope !== end.closest(scopeSelector))) return undefined
  const text = captureMessageTextSelection(sameMessage ? start : scope!)
  if (!text) return undefined
  const range = selection.getRangeAt(0).cloneRange()
  const rects = Array.from(range.getClientRects()).filter(rect => rect.width > 0 && rect.height > 0)
  // Anchor at the end the user just dragged, including backwards selections.
  const backwards = selection.focusNode === range.startContainer && selection.focusOffset === range.startOffset
  const rect = (backwards ? rects[0] : rects.at(-1)) ?? range.getBoundingClientRect()
  if (!rect || rect.height === 0) return undefined
  return { text, whole: sameMessage ? targets.get(start)!.copyText : undefined, start, end,
    startEntry: targets.get(start), endEntry: targets.get(end), range, rect }
}

function stillValid(snapshot: Snapshot) {
  return snapshot.start.isConnected && snapshot.end.isConnected
    && targets.get(snapshot.start) === snapshot.startEntry && targets.get(snapshot.end) === snapshot.endEntry
}

/** Keep selection within this message's prose, excluding trailing attachment controls. */
function wholeMessageRange(element: HTMLElement): Range | undefined {
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node instanceof Element) {
        if (node.matches(`${excludedSelector},style,script,[aria-hidden="true"]`)) return NodeFilter.FILTER_REJECT
        return node.matches('br,img[data-arkme-rich-emoji]') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP
      }
      return node.textContent?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP
    },
  })
  const first = walker.nextNode()
  if (!first) return undefined
  let last = first, next: Node | null
  while ((next = walker.nextNode())) last = next
  const range = element.ownerDocument.createRange()
  range.setStartBefore(first)
  range.setEndAfter(last)
  return range
}

/** One host per product surface; only explicitly registered message bodies participate. */
export function ArkmeMessageTextSelectionToolbar({ replySourceRef, onReply, replyLabel = '回复', onUnderline, getMarks, onRemoveMark, markStorage, markScopeControl, canReplace, prepareReplace }: {
  replySourceRef?: string | undefined
  markStorage?: 'local' | 'cloud' | undefined
  markScopeControl?: ReactNode
  replyLabel?: string | undefined
  onReply?: ((target: MessageSelectionTarget, quote: ArkmeMessageQuote) => void) | undefined
  onUnderline?: ((target: MessageSelectionTarget, quote: ArkmeMessageQuote) => Promise<string | undefined>) | undefined
  getMarks?: ((target: MessageSelectionTarget) => MessageUnderline[]) | undefined
  onRemoveMark?: ((target: MessageSelectionTarget, mark: MessageUnderline) => Promise<string | undefined>) | undefined
  canReplace?: ((target: MessageSelectionTarget) => boolean) | undefined
  prepareReplace?: PrepareSelectedTextReplace | undefined
} = {}) {
  const [replacing, setReplacing] = useState<{ target: MessageSelectionTarget; quote: ArkmeMessageQuote; rect: DOMRect }>()
  const [verified, setVerified] = useState<{ snapshot: Snapshot; quote: ArkmeMessageQuote }>()
  const [snapshot, setSnapshot] = useState<Snapshot>()
  const [notice, setNotice] = useState('')
  const [position, setPosition] = useState({ left: 8, top: 8 })
  const toolbar = useRef<HTMLDivElement>(null)
  const anchors = useRef(new WeakMap<Snapshot, { source: string; quote: ArkmeMessageQuote }>())
  const current = useRef(snapshot)
  current.current = snapshot
  useEffect(() => {
    let dragging = false
    const insideToolbar = (target: EventTarget | null) => target instanceof Node && toolbar.current?.contains(target)
    const dismiss = () => { setSnapshot(undefined) }
    const show = () => { setNotice(''); setSnapshot(captureSelection(document)) }
    const down = (event: MouseEvent) => {
      if (insideToolbar(event.target)) return
      dragging = event.button === 0
      dismiss()
    }
    const up = (event: MouseEvent) => {
      if (insideToolbar(event.target)) return
      dragging = false
      if (event.button === 0 && !elementFor(event.target as Node)?.closest(excludedSelector)) show()
    }
    const context = (event: MouseEvent) => {
      const clicked = targetFor(event.target as Node)
      if (!clicked) return
      const next = captureSelection(document)
      if (!next || !next.range.intersectsNode(clicked)) return
      event.preventDefault()
      event.stopPropagation()
      setNotice(''); setSnapshot(next)
    }
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && current.current) {
        event.preventDefault(); event.stopPropagation(); dismiss()
      }
    }
    const keyup = (event: KeyboardEvent) => {
      if (event.shiftKey && /^(Arrow|Home|End)/u.test(event.key)) show()
    }
    const selectionChanged = () => {
      if (dragging || insideToolbar(document.activeElement)) return
      const value = document.getSelection()
      if (!value || value.isCollapsed) dismiss()
      else if (current.current) {
        const range = value.rangeCount === 1 ? value.getRangeAt(0) : undefined
        const previous = current.current.range
        if (!range || range.startContainer !== previous.startContainer || range.startOffset !== previous.startOffset
          || range.endContainer !== previous.endContainer || range.endOffset !== previous.endOffset) dismiss()
      }
    }
    document.addEventListener('mousedown', down, true)
    document.addEventListener('mouseup', up)
    document.addEventListener('contextmenu', context, true)
    document.addEventListener('keydown', keydown, true)
    document.addEventListener('keyup', keyup)
    document.addEventListener('selectionchange', selectionChanged)
    document.addEventListener('scroll', dismiss, true)
    window.addEventListener('blur', dismiss)
    window.addEventListener('resize', dismiss)
    return () => {
      document.removeEventListener('mousedown', down, true)
      document.removeEventListener('mouseup', up)
      document.removeEventListener('contextmenu', context, true)
      document.removeEventListener('keydown', keydown, true)
      document.removeEventListener('keyup', keyup)
      document.removeEventListener('selectionchange', selectionChanged)
      document.removeEventListener('scroll', dismiss, true)
      window.removeEventListener('blur', dismiss)
      window.removeEventListener('resize', dismiss)
    }
  }, [])
  useEffect(() => {
    const open = (event: Event) => {
      const { element, range, quote, entry } = (event as CustomEvent<{ element: HTMLElement; range: Range; quote: ArkmeMessageQuote; entry: ReturnType<typeof targets.get> }>).detail
      if (!entry?.reply || entry.reply.sourceRef !== replySourceRef || targets.get(element) !== entry || !element.isConnected) return
      const selection = document.getSelection()
      if (!selection) return
      selection.removeAllRanges(); selection.addRange(range)
      const next = captureSelection(document)
      if (!next || next.start !== element || next.end !== element) return
      event.preventDefault()
      anchors.current.set(next, { source: JSON.stringify([quoteSourceContent(entry.reply.item), entry.reply.item.recordVersion]), quote })
      current.current = next
      setNotice(''); setSnapshot(next); setVerified({ snapshot: next, quote })
    }
    document.addEventListener(openMarkEvent, open)
    return () => document.removeEventListener(openMarkEvent, open)
  }, [replySourceRef])
  useEffect(() => {
    if (!snapshot || !getMarks || snapshot.start !== snapshot.end) return
    const target = snapshot.startEntry?.reply
    if (!target || target.sourceRef !== replySourceRef) return
    let disposed = false
    void (async () => {
      try {
        const source = JSON.stringify([quoteSourceContent(target.item), target.item.recordVersion])
        const cached = anchors.current.get(snapshot)
        const quote = cached?.source === source ? cached.quote : {
          ...captureQuoteAnchor(snapshot.start, snapshot.range, snapshot.text, target.item), sourceDigest: await quoteDigest(target.item),
        }
        if (disposed || current.current !== snapshot || !stillValid(snapshot)) return
        anchors.current.set(snapshot, { source, quote }); setVerified({ snapshot, quote })
      } catch { /* Copy remains available when the source cannot be precisely anchored. */ }
    })()
    return () => { disposed = true }
  }, [snapshot, replySourceRef, !!getMarks])
  useEffect(() => {
    if (!snapshot) return
    const observer = new MutationObserver(() => { if (!stillValid(snapshot)) setSnapshot(undefined) })
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-arkme-text-selection'] })
    return () => observer.disconnect()
  }, [snapshot])
  useLayoutEffect(() => {
    if (!snapshot || !toolbar.current) return
    const box = toolbar.current.getBoundingClientRect(), rect = snapshot.rect
    const left = Math.max(8, Math.min(window.innerWidth - box.width - 8, rect.right - box.width))
    const top = rect.top - box.height - 8 >= 8 ? rect.top - box.height - 8 : rect.bottom + 8
    setPosition({ left, top: Math.max(8, Math.min(window.innerHeight - box.height - 8, top)) })
  }, [snapshot, notice, verified])
  if (typeof document === 'undefined') return null
  if (replacing && prepareReplace) return <ArkmeSelectedTextReplace key={`${replacing.target.sourceRef}:${replacing.target.item.itemUid}`}
    {...replacing} prepare={prepareReplace} onClose={() => setReplacing(undefined)} />
  if (!snapshot) return null
  const replyTarget = snapshot.start === snapshot.end ? snapshot.startEntry?.reply : undefined
  const quote = verified?.snapshot === snapshot ? verified.quote : undefined
  const marks = quote && replyTarget ? (getMarks?.(replyTarget) ?? []).filter(mark => mark.state === 'available'
    && mark.anchor?.sourceDigest === quote.sourceDigest && mark.anchor!.start < quote.end && mark.anchor!.end > quote.start) : []
  // A partial overlap is not permission to delete a larger mark. Cancel only an exact selection.
  const ownMark = marks.find(mark => mark.mine && mark.anchor!.start === quote?.start && mark.anchor!.end === quote?.end)
  const authors = [...new Set(marks.map(mark => mark.mine ? '你' : mark.actorName))]
  const removeMark = async () => {
    if (!ownMark || !onRemoveMark || !replyTarget || !stillValid(snapshot)) return
    try {
      const message = await onRemoveMark(replyTarget, ownMark)
      if (current.current !== snapshot) return
      if (message) { setNotice(message); return }
      document.getSelection()?.removeAllRanges(); setSnapshot(undefined)
    } catch (error) { if (current.current === snapshot) setNotice(error instanceof Error ? error.message : '取消标记失败，请重试') }
  }
  const canReply = !!onReply && !!replyTarget && replyTarget.sourceRef === replySourceRef
    && replyTarget.item.status === 1 && !!replyTarget.item.messageActionRef
  const find = () => {
    if (!stillValid(snapshot) || !replySourceRef) return
    if (!findSelectedMessageText(replySourceRef, snapshot.text)) { setNotice('当前对话暂不支持查找'); return }
    document.getSelection()?.removeAllRanges(); setSnapshot(undefined)
  }
  const replace = async () => {
    if (!replyTarget || replyTarget.sourceRef !== replySourceRef || !canReplace?.(replyTarget) || !prepareReplace || !stillValid(snapshot)) return
    try {
      const item = { ...replyTarget.item }, source = quoteSourceContent(item)
      const anchor = { ...captureQuoteAnchor(snapshot.start, snapshot.range, snapshot.text, item), sourceDigest: await quoteDigest(item) }
      if (!stillValid(snapshot) || current.current !== snapshot || quoteSourceContent(snapshot.startEntry!.reply!.item) !== source) return
      setReplacing({ target: { ...replyTarget, item }, quote: anchor, rect: snapshot.rect })
      document.getSelection()?.removeAllRanges(); setSnapshot(undefined)
    } catch (error) { setNotice(error instanceof Error ? error.message : '无法读取选区，请重新选择') }
  }
  const reply = async (underline = false) => {
    if ((!canReply && !underline) || !replyTarget || replyTarget.sourceRef !== replySourceRef || !stillValid(snapshot)) return
    try {
      const sourceItem = replyTarget.item
      const source = JSON.stringify([quoteSourceContent(sourceItem), sourceItem.recordVersion])
      const cached = anchors.current.get(snapshot)
      // A background presentation refresh can replace text nodes while the same menu is open.
      // Reuse only an already verified anchor for the exact same source content/version.
      const quote = cached?.source === source ? cached.quote : {
        ...captureQuoteAnchor(snapshot.start, snapshot.range, snapshot.text, sourceItem),
        sourceDigest: await quoteDigest(sourceItem),
      }
      const freshTarget = snapshot.startEntry?.reply
      // Presentation objects can be replaced by receipt/annotation refreshes.
      // Validate identity, authority and content instead of object allocation.
      if (!stillValid(snapshot) || current.current !== snapshot || !freshTarget
        || freshTarget.sourceRef !== replyTarget.sourceRef || messageSelectionReference(freshTarget) !== messageSelectionReference(replyTarget)
        || freshTarget.item.itemUid !== sourceItem.itemUid || freshTarget.item.status !== 1
        || JSON.stringify([quoteSourceContent(freshTarget.item), freshTarget.item.recordVersion]) !== source) return
      anchors.current.set(snapshot, { source, quote })
      if (underline) {
        const message = await onUnderline?.(freshTarget, quote)
        if (current.current !== snapshot) return
        if (message) { setNotice(message); return }
      } else onReply!(freshTarget, quote)
      document.getSelection()?.removeAllRanges()
      setSnapshot(undefined)
    } catch (error) { setNotice(error instanceof Error ? error.message : '引用失败，请重新选择') }
  }
  const copy = async (value: string) => {
    if (!stillValid(snapshot)) { setSnapshot(undefined); return }
    try {
      await copyText(value)
      setSnapshot(current => current === snapshot ? undefined : current)
    } catch {
      if (current.current === snapshot) setNotice(tr('复制失败，请重试'))
    }
  }
  const selectAll = () => {
    if (!stillValid(snapshot)) { setSnapshot(undefined); return }
    const range = wholeMessageRange(snapshot.start)
    const selection = snapshot.start.ownerDocument.getSelection()
    if (!range || !selection) return
    selection.removeAllRanges()
    selection.addRange(range)
    const next = captureSelection(snapshot.start.ownerDocument)
    // Keep the menu beside the user's initial selection, even for a long message.
    current.current = next ? { ...next, rect: snapshot.rect } : undefined
    setNotice('')
    setSnapshot(current.current)
  }
  return createPortal(<div ref={toolbar} role="toolbar" aria-label={tr('选中文字操作')}
    data-arkme-text-selection-toolbar
    onPointerDown={event => { event.preventDefault(); event.stopPropagation() }}
    onMouseDown={event => { event.preventDefault(); event.stopPropagation() }}
    onClick={event => event.stopPropagation()}
    style={{ position: 'fixed', ...position, zIndex: 12000, display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 2,
      maxWidth: 'calc(100vw - 16px)', padding: 4, borderRadius: 9, border: `1px solid ${arkmeTheme.border}`,
      background: arkmeTheme.menu, color: arkmeTheme.text, boxShadow: arkmeTheme.shadow, userSelect: 'none' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
    <button type="button" style={buttonStyle} onClick={() => { void copy(snapshot.text) }}>{tr('复制')}</button>
    {snapshot.whole !== undefined && snapshot.whole !== '' && <>
      <span aria-hidden style={{ width: 1, height: 14, background: arkmeTheme.border }} />
      <button type="button" style={buttonStyle} onClick={selectAll}>{tr('全选')}</button>
    </>}
    {onUnderline && replyTarget?.sourceRef === replySourceRef && replyTarget?.item.status === 1 && <button type="button" aria-pressed={!!ownMark} disabled={!!ownMark?.pending}
      title={ownMark ? `取消你对“${ownMark.anchor!.text}”的标记` : undefined}
      style={{ ...buttonStyle, ...(ownMark ? { color: arkmeTheme.info, background: arkmeTheme.active } : {}) }}
      onClick={() => { void (ownMark && onRemoveMark ? removeMark() : reply(true)) }}>{ownMark && <span aria-hidden>✓ </span>}{tr(ownMark ? '取消标记' : '标记')}</button>}
    {replySourceRef && snapshot.startEntry?.reply?.sourceRef === replySourceRef && snapshot.endEntry?.reply?.sourceRef === replySourceRef
      && <button type="button" style={buttonStyle} onClick={find}>{tr('查找')}</button>}
    {prepareReplace && replyTarget && replyTarget.sourceRef === replySourceRef && canReplace?.(replyTarget)
      && <button type="button" style={buttonStyle} onClick={() => { void replace() }}>{tr('替换')}</button>}
    {canReply && <button type="button" style={buttonStyle} onClick={() => { void reply() }}>{tr(replyLabel)}</button>}
    </div>
    {onUnderline && replyTarget?.sourceRef === replySourceRef && markScopeControl}
    {(authors.length > 0 || (markStorage === 'local' && onUnderline && replyTarget?.sourceRef === replySourceRef)) && <div data-arkme-mark-authors style={{ padding: '2px 9px 4px', fontSize: 11, color: arkmeTheme.secondary }}>{authors.length > 0 ? `${authors.join('、')}标记了选区中的内容` : ''}{markStorage === 'local' ? `${authors.length > 0 ? ' · ' : ''}仅本机` : ''}</div>}
    {notice && <span role="alert" style={{ fontSize: 12, color: arkmeTheme.danger }}>{notice}</span>}
  </div>, document.body)
}

const buttonStyle: CSSProperties = { border: 0, borderRadius: 5, padding: '6px 9px', background: 'transparent', color: 'inherit',
  font: 'inherit', fontSize: 12, lineHeight: '18px', whiteSpace: 'nowrap', cursor: 'pointer' }
