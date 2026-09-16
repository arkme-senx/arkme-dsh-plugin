import { CONVERSATION_MENU_LAYOUT } from './conversation-selector-style.js'

export type ConversationMenuAnchor = Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>

/** One document-level host, outside workspace clipping and without its own stacking context. */
export function conversationMenuLayer(doc: Document): HTMLElement {
  let layer = doc.querySelector<HTMLElement>('[data-arkme-conversation-menu-layer]')
  if (!layer) {
    layer = doc.createElement('div')
    layer.setAttribute('data-arkme-conversation-menu-layer', '')
    layer.style.display = 'contents'
    doc.body.append(layer)
  }
  return layer
}

export function conversationMenuPosition(anchor: ConversationMenuAnchor, width: number, height: number, viewport: { width: number; height: number }) {
  const { hoverGap, viewportInset } = CONVERSATION_MENU_LAYOUT
  const right = anchor.right + hoverGap
  const left = right + width <= viewport.width - viewportInset ? right : anchor.left - width - hoverGap
  return {
    left: Math.max(viewportInset, Math.min(left, viewport.width - width - viewportInset)),
    top: Math.max(viewportInset, Math.min(anchor.top, viewport.height - height - viewportInset)),
  }
}

export interface ConversationMenuHoverRequest {
  focusMenu: boolean
  anchor(): ConversationMenuAnchor
  keepOpen(): void
  scheduleClose(): void
  onClose(focus?: boolean): void
}

interface ConversationMenuHoverAdapter {
  open(request: ConversationMenuHoverRequest): boolean
  close(): void
  position(): void
  contains(target: EventTarget | null): boolean
}

const activeHovers = new WeakMap<Document, () => void>()

/** Timing, dismissal, keyboard entry and mutual exclusion are identical for both lists. */
export function watchConversationMenuHover(anchor: HTMLElement, adapter: ConversationMenuHoverAdapter): () => void {
  const doc = anchor.ownerDocument, win = doc.defaultView
  if (!win) return () => {}
  let open = false, openTimer = 0, closeTimer = 0
  const clearTimers = () => {
    win.clearTimeout(openTimer); win.clearTimeout(closeTimer)
    openTimer = 0; closeTimer = 0
  }
  const release = (focus = false) => {
    clearTimers(); open = false
    if (activeHovers.get(doc) === close) activeHovers.delete(doc)
    anchor.setAttribute('aria-expanded', 'false')
    if (focus && anchor.isConnected) anchor.focus({ preventScroll: true })
  }
  const close = () => { clearTimers(); if (open) adapter.close(); release() }
  const keepOpen = () => { win.clearTimeout(closeTimer); closeTimer = 0 }
  const scheduleClose = () => {
    win.clearTimeout(openTimer); openTimer = 0
    if (open && !closeTimer) closeTimer = win.setTimeout(close, 300)
  }
  const openMenu = (focusMenu = false) => {
    clearTimers()
    if (open || !anchor.isConnected || !anchor.getClientRects().length) return
    activeHovers.get(doc)?.()
    open = adapter.open({ focusMenu, anchor: () => anchor.getBoundingClientRect(), keepOpen, scheduleClose, onClose: release })
    if (!open) return
    activeHovers.set(doc, close)
    anchor.setAttribute('aria-expanded', 'true')
  }
  const enter = (event: PointerEvent) => {
    if (event.pointerType === 'touch') return
    keepOpen()
    if (!open && !openTimer) openTimer = win.setTimeout(() => openMenu(), 200)
  }
  const key = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowRight') return
    event.preventDefault(); openMenu(true)
  }
  const inside = (target: EventTarget | null) => anchor.contains(target as Node | null) || adapter.contains(target)
  const move = (event: Event) => { if (open) { if (inside(event.target)) keepOpen(); else scheduleClose() } }
  const down = (event: Event) => { if (open && !inside(event.target)) close() }
  const escape = (event: KeyboardEvent) => {
    if (!open || event.key !== 'Escape') return
    // Nested menus/dialogs own Escape before the parent hover card.
    if (doc.querySelector('[role="menu"], [role="dialog"], [role="alertdialog"]')) return
    event.preventDefault(); close(); anchor.focus({ preventScroll: true })
  }
  const position = () => { if (!anchor.isConnected || !anchor.getClientRects().length) close(); else if (open) adapter.position() }
  anchor.setAttribute('aria-haspopup', 'dialog')
  anchor.setAttribute('aria-expanded', 'false')
  anchor.addEventListener('pointerenter', enter)
  anchor.addEventListener('pointerleave', scheduleClose)
  anchor.addEventListener('pointerdown', close)
  anchor.addEventListener('keydown', key)
  doc.addEventListener('pointermove', move, true)
  doc.addEventListener('pointerover', move, true)
  doc.addEventListener('pointerdown', down, true)
  doc.addEventListener('keydown', escape)
  doc.addEventListener('scroll', position, true)
  win.addEventListener('resize', position)
  const resize = typeof win.ResizeObserver === 'function' ? new win.ResizeObserver(position) : undefined
  resize?.observe(anchor)
  return () => {
    close(); resize?.disconnect()
    anchor.removeEventListener('pointerenter', enter)
    anchor.removeEventListener('pointerleave', scheduleClose)
    anchor.removeEventListener('pointerdown', close)
    anchor.removeEventListener('keydown', key)
    doc.removeEventListener('pointermove', move, true)
    doc.removeEventListener('pointerover', move, true)
    doc.removeEventListener('pointerdown', down, true)
    doc.removeEventListener('keydown', escape)
    doc.removeEventListener('scroll', position, true)
    win.removeEventListener('resize', position)
    anchor.removeAttribute('aria-haspopup'); anchor.removeAttribute('aria-expanded')
  }
}
