import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { captureMessageTextSelection } from './message-text-selection.js'
import { copyText } from './clipboard-text.js'
import { arkmeTheme } from './arkme-theme.js'
import { tr } from './locale.js'

const targets = new WeakMap<HTMLElement, { copyText: string }>()
const targetSelector = '[data-arkme-text-selection]'
const scopeSelector = '[data-arkme-note-detail], [data-arkme-message-selection-scope]'
const excludedSelector = 'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],button,[data-arkme-mention-read]'

/** Ref registration adds no layout wrapper and no per-message document listener. */
export function useMessageTextSelectionTarget(text: string) {
  const previous = useRef<HTMLElement | null>(null)
  return useCallback((element: HTMLElement | null) => {
    if (previous.current) {
      targets.delete(previous.current)
      previous.current.removeAttribute('data-arkme-text-selection')
    }
    previous.current = element
    if (element) {
      targets.set(element, { copyText: text })
      element.setAttribute('data-arkme-text-selection', '')
    }
  }, [text])
}

export function ArkmeSelectableMessageText({ text, children, style }: { text: string; children: ReactNode; style?: CSSProperties }) {
  const ref = useMessageTextSelectionTarget(text)
  return <div ref={ref} data-arkme-message-content="message" style={style}>{children}</div>
}

function elementFor(node: Node | null): Element | null { return node?.nodeType === 1 ? node as Element : node?.parentElement ?? null }
function targetFor(node: Node | null): HTMLElement | undefined {
  const element = elementFor(node)
  if (element?.closest(excludedSelector)) return undefined
  const target = element?.closest<HTMLElement>(targetSelector)
  return target && targets.has(target) ? target : undefined
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
export function ArkmeMessageTextSelectionToolbar() {
  const [snapshot, setSnapshot] = useState<Snapshot>()
  const [notice, setNotice] = useState('')
  const [position, setPosition] = useState({ left: 8, top: 8 })
  const toolbar = useRef<HTMLDivElement>(null)
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
  }, [snapshot, notice])
  if (!snapshot || typeof document === 'undefined') return null
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
    style={{ position: 'fixed', ...position, zIndex: 12000, display: 'flex', alignItems: 'center', gap: 2,
      maxWidth: 'calc(100vw - 16px)', padding: 4, borderRadius: 9, border: `1px solid ${arkmeTheme.border}`,
      background: arkmeTheme.menu, color: arkmeTheme.text, boxShadow: arkmeTheme.shadow, userSelect: 'none' }}>
    <button type="button" style={buttonStyle} onClick={() => { void copy(snapshot.text) }}>{tr('复制')}</button>
    {snapshot.whole !== undefined && snapshot.whole !== '' && <>
      <span aria-hidden style={{ width: 1, height: 14, background: arkmeTheme.border }} />
      <button type="button" style={buttonStyle} onClick={selectAll}>{tr('全选')}</button>
    </>}
    {notice && <span role="alert" style={{ fontSize: 12, color: arkmeTheme.danger }}>{notice}</span>}
  </div>, document.body)
}

const buttonStyle: CSSProperties = { border: 0, borderRadius: 5, padding: '6px 9px', background: 'transparent', color: 'inherit',
  font: 'inherit', fontSize: 12, lineHeight: '18px', whiteSpace: 'nowrap', cursor: 'pointer' }
