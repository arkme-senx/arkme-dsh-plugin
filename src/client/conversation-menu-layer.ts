import { CONVERSATION_MENU_LAYOUT } from './conversation-selector-style.js'

export type ConversationMenuAnchor = Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>
export interface ConversationMenuPoint { x: number; y: number }

/** Only the narrow shared edge is traversable, not the space below the card. */
export function conversationMenuHoverBridge(anchor: ConversationMenuAnchor, menu: ConversationMenuAnchor): ConversationMenuAnchor | undefined {
  const top = Math.max(anchor.top, menu.top), bottom = Math.min(anchor.bottom, menu.bottom)
  const left = menu.left >= anchor.right ? anchor.right : menu.right
  const right = menu.left >= anchor.right ? menu.left : anchor.left
  if (bottom <= top || right < left || right - left > CONVERSATION_MENU_LAYOUT.hoverGap + 1) return
  return { left, right, top, bottom }
}

function containsPoint(rect: ConversationMenuAnchor, point: ConversationMenuPoint): boolean {
  return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y < rect.bottom
}

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
  checkPointer(target: EventTarget | null, point?: ConversationMenuPoint): void
  onClose(focus?: boolean): void
}

interface ConversationMenuHoverAdapter {
  open(request: ConversationMenuHoverRequest): boolean
  close(): void
  position(): void
  contains(target: EventTarget | null): boolean
  /** Visible menu layers in the anchor document's viewport coordinates; main menu first. */
  bounds(): ConversationMenuAnchor[]
}

const activeHovers = new WeakMap<Document, () => void>()

/** Timing, dismissal, keyboard entry and mutual exclusion are identical for both lists. */
export function watchConversationMenuHover(anchor: HTMLElement, adapter: ConversationMenuHoverAdapter): () => void {
  const doc = anchor.ownerDocument, win = doc.defaultView
  if (!win) return () => {}
  let open = false, openTimer = 0
  const clearTimers = () => {
    win.clearTimeout(openTimer)
    openTimer = 0
  }
  const release = (focus = false) => {
    clearTimers(); open = false
    if (activeHovers.get(doc) === close) activeHovers.delete(doc)
    anchor.setAttribute('aria-expanded', 'false')
    if (focus && anchor.isConnected) anchor.focus({ preventScroll: true })
  }
  const close = () => { clearTimers(); if (open) adapter.close(); release() }
  const inside = (target: EventTarget | null) => target != null && typeof (target as Node).nodeType === 'number'
    && (anchor.contains(target as Node) || adapter.contains(target))
  const checkPointer = (target: EventTarget | null, point?: ConversationMenuPoint) => {
    if (!open || inside(target)) return
    if (point) {
      const card = anchor.getBoundingClientRect(), menus = adapter.bounds()
      const bridge = menus[0] && conversationMenuHoverBridge(card, menus[0])
      if (containsPoint(card, point) || menus.some(rect => containsPoint(rect, point))
        || bridge && containsPoint(bridge, point)) return
    }
    close()
  }
  const openMenu = (focusMenu = false) => {
    clearTimers()
    if (open || !anchor.isConnected || !anchor.getClientRects().length) return
    activeHovers.get(doc)?.()
    open = adapter.open({ focusMenu, anchor: () => anchor.getBoundingClientRect(), checkPointer, onClose: release })
    if (!open) return
    activeHovers.set(doc, close)
    anchor.setAttribute('aria-expanded', 'true')
  }
  const enter = (event: PointerEvent) => {
    if (event.pointerType === 'touch') return
    if (!open && !openTimer) openTimer = win.setTimeout(() => openMenu(), 200)
  }
  const key = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowRight') return
    event.preventDefault(); openMenu(true)
  }
  const move = (event: PointerEvent) => checkPointer(event.target, { x: event.clientX, y: event.clientY })
  const leave = (event: PointerEvent) => {
    clearTimers()
    checkPointer(event.relatedTarget, { x: event.clientX, y: event.clientY })
  }
  const leaveDocument = (event: PointerEvent) => { if (!event.relatedTarget) leave(event) }
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
  anchor.addEventListener('pointerleave', leave)
  anchor.addEventListener('pointerdown', close)
  anchor.addEventListener('keydown', key)
  doc.addEventListener('pointermove', move, true)
  doc.addEventListener('pointerover', move, true)
  doc.addEventListener('pointerout', leaveDocument, true)
  doc.addEventListener('pointerdown', down, true)
  doc.addEventListener('keydown', escape)
  doc.addEventListener('scroll', position, true)
  win.addEventListener('resize', position)
  const resize = typeof win.ResizeObserver === 'function' ? new win.ResizeObserver(position) : undefined
  resize?.observe(anchor)
  return () => {
    close(); resize?.disconnect()
    anchor.removeEventListener('pointerenter', enter)
    anchor.removeEventListener('pointerleave', leave)
    anchor.removeEventListener('pointerdown', close)
    anchor.removeEventListener('keydown', key)
    doc.removeEventListener('pointermove', move, true)
    doc.removeEventListener('pointerover', move, true)
    doc.removeEventListener('pointerout', leaveDocument, true)
    doc.removeEventListener('pointerdown', down, true)
    doc.removeEventListener('keydown', escape)
    doc.removeEventListener('scroll', position, true)
    win.removeEventListener('resize', position)
    anchor.removeAttribute('aria-haspopup'); anchor.removeAttribute('aria-expanded')
  }
}
