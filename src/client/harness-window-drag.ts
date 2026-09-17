export type HarnessDragMessage = { kind: 'begin' | 'move'; id: string; x: number; y: number }
  | { kind: 'end'; id: string }
export interface HarnessDragBridge { send(message: HarnessDragMessage): void }

const SESSION_HEADER = '[data-slot="conversation.session.header"] > header'
const OPEN_PANEL = '[data-sidebar-right-panel][data-sidebar-right-open]'
const INTERACTIVE = 'button,a,input,textarea,select,label,summary,[tabindex],[aria-haspopup],'
  + '[contenteditable]:not([contenteditable="false"]),[draggable="true"],'
  + '[role="button"],[role="tab"],[role="menu"],[role="menuitem"],[role="dialog"],'
  + '[role="slider"],[role="separator"],[role="treeitem"],[role="textbox"],[role="combobox"],'
  + '[data-dockkit-tab],[data-dockkit-divider],[data-dockkit-float-grip],[data-dockkit-float-resize]'

function containsPoint(element: Element, x: number, y: number): boolean {
  const rect = element.getBoundingClientRect()
  const style = element.ownerDocument.defaultView?.getComputedStyle(element)
  return rect.width > 0 && rect.height > 0 && style?.visibility !== 'hidden' && style?.display !== 'none'
    && x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom
}

/** Read upstream semantic DOM only; no patches, node moves or injected CSS. */
export function isHarnessWindowDragPoint(doc: Document, target: Element, x: number, y: number): boolean {
  if (target.ownerDocument !== doc || target.closest(INTERACTIVE) || target.closest('[hidden],[aria-hidden="true"]')) return false
  // Keep text selectable even when a text container stretches across its row.
  for (const child of target.childNodes) {
    if (child.nodeType !== 3 || !child.textContent?.trim()) continue
    const range = doc.createRange(); range.selectNodeContents(child)
    if (typeof range.getClientRects === 'function' && Array.from(range.getClientRects()).some(rect =>
      x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom)) return false
  }
  const header = target.closest(SESSION_HEADER)
  if (header && containsPoint(header, x, y)) return true
  const panel = target.closest(OPEN_PANEL)
  if (panel) {
    const strip = target.closest('[data-dockkit-strip]')
    if (strip && containsPoint(strip, x, y)) return true
    const files = target.closest('[data-files-root]')
    const pathRow = files?.querySelector('[data-files-path]')?.parentElement
    if (pathRow?.parentElement === files && pathRow.contains(target)
      && pathRow.querySelector('[data-files-reload]') && containsPoint(pathRow, x, y)) return true
    return false
  }
  const hero = target.closest('[data-phase="hero"]')
  const composer = hero?.querySelector('[data-composer-seat]')
  // The composer seat contains the brand, workspace controls and editor too.
  // Its top edge is the safe boundary of the blank area, not a fixed pixel band.
  return !!hero && !!composer && !composer.contains(target) && containsPoint(hero, x, y)
    && y < composer.getBoundingClientRect().top
}

export function watchHarnessWindowDrag(surface: HTMLElement, frame: HTMLIFrameElement,
  bridge: HarnessDragBridge | undefined = (surface.ownerDocument.defaultView as
    (Window & { arkmeDesktop?: { windowDrag?: HarnessDragBridge } }) | null)?.arkmeDesktop?.windowDrag): () => void {
  if (!bridge) return () => {}
  const host = surface.ownerDocument.defaultView!
  let detach = () => {}
  let stop = () => {}
  let sequence = 0
  const owner = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  function attach() {
    detach()
    let doc: Document | null
    try { doc = frame.contentDocument } catch { return }
    if (!doc?.defaultView) return
    const native = doc
    const view = doc.defaultView
    let gesture: { pointerId: number; id: string; x: number; y: number; moving: boolean } | undefined
    let pending = 0
    let latest: { x: number; y: number } | undefined
    const visible = () => surface.isConnected && surface.getAttribute('data-arkme-visible') === 'true'
    const flush = () => {
      view.cancelAnimationFrame(pending)
      pending = 0
      if (gesture && latest && visible()) bridge!.send({ kind: 'move', id: gesture.id, ...latest })
      latest = undefined
    }
    const end = () => {
      const previous = gesture; gesture = undefined
      view.cancelAnimationFrame(pending); pending = 0; latest = undefined
      if (!previous) return
      if (native.documentElement.hasPointerCapture?.(previous.pointerId)) native.documentElement.releasePointerCapture(previous.pointerId)
      bridge!.send({ kind: 'end', id: previous.id })
    }
    stop = end
    const down = (event: PointerEvent) => {
      if (gesture || !visible() || event.button !== 0 || !event.isPrimary) return
      const target = event.target as Element | null
      if (target?.nodeType !== 1 || !isHarnessWindowDragPoint(native, target, event.clientX, event.clientY)) return
      // A first click outside an open popup must still dismiss it normally.
      if (Array.from(native.querySelectorAll('[role="menu"],[role="dialog"],[aria-modal="true"]')).some(node => {
        const rect = node.getBoundingClientRect()
        return containsPoint(node, rect.left, rect.top)
      })) return
      try { native.documentElement.setPointerCapture(event.pointerId) } catch { return }
      gesture = { pointerId: event.pointerId, id: `${owner}-${++sequence}`, x: event.screenX, y: event.screenY, moving: false }
      bridge!.send({ kind: 'begin', id: gesture.id, x: event.screenX, y: event.screenY })
      event.preventDefault(); event.stopPropagation()
    }
    const move = (event: PointerEvent) => {
      if (!gesture || gesture.pointerId !== event.pointerId) return
      if (!visible()) { end(); return }
      if (!gesture.moving && Math.hypot(event.screenX - gesture.x, event.screenY - gesture.y) < 4) return
      gesture.moving = true; latest = { x: event.screenX, y: event.screenY }
      if (!pending) pending = view.requestAnimationFrame(flush)
      event.preventDefault(); event.stopPropagation()
    }
    const up = (event: PointerEvent) => {
      if (gesture?.pointerId !== event.pointerId) return
      if (gesture.moving) { latest = { x: event.screenX, y: event.screenY }; flush() }
      end()
    }
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') end() }
    native.addEventListener('pointerdown', down, true)
    native.addEventListener('pointermove', move, true)
    native.addEventListener('pointerup', up, true)
    native.addEventListener('pointercancel', end, true)
    native.addEventListener('lostpointercapture', end, true)
    native.addEventListener('keydown', key, true)
    view.addEventListener('pagehide', end)
    detach = () => {
      end()
      native.removeEventListener('pointerdown', down, true); native.removeEventListener('pointermove', move, true)
      native.removeEventListener('pointerup', up, true); native.removeEventListener('pointercancel', end, true)
      native.removeEventListener('lostpointercapture', end, true); native.removeEventListener('keydown', key, true)
      view.removeEventListener('pagehide', end)
    }
  }
  const cancel = () => stop()
  const visibility = new host.MutationObserver(() => { if (surface.getAttribute('data-arkme-visible') !== 'true') stop() })
  visibility.observe(surface, { attributes: true, attributeFilter: ['data-arkme-visible'] })
  frame.addEventListener('load', attach); host.addEventListener('blur', cancel); host.addEventListener('resize', cancel)
  attach()
  return () => { detach(); visibility.disconnect(); frame.removeEventListener('load', attach); host.removeEventListener('blur', cancel); host.removeEventListener('resize', cancel) }
}
