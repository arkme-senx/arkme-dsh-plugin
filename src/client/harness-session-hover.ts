import { watchConversationMenuHover } from './conversation-menu-layer.js'
import { HARNESS_MENU_OPEN, HARNESS_MENU_CLOSE, HARNESS_MENU_POSITION, harnessMenuLayers, type HarnessSessionMenuRequest } from './harness-session-menu-bridge.js'

/** Reveal the existing native list. Never resize or translate the conversation on hover. */
export function watchHarnessSessionHover(anchor: HTMLElement, scope: string, activate: () => void): () => void {
  const doc = anchor.ownerDocument, win = doc.defaultView
  if (!win) return () => {}
  let native: Document | undefined
  let frameElement: HTMLIFrameElement | undefined
  let stopWatching: (() => void) | undefined
  const release = () => { stopWatching?.(); stopWatching = undefined; native = undefined; frameElement = undefined }
  return watchConversationMenuHover(anchor, {
    open: hover => {
      const surface = doc.querySelector<HTMLElement>('[data-arkme-owned="deepseek-harness-surface"][data-arkme-account-id]')
      if (surface?.getAttribute('data-arkme-account-scope') !== scope) return false
      const frame = surface.querySelector('iframe')
      let next: Document | null | undefined
      try { next = frame?.contentDocument } catch { return false }
      if (!frame || !next?.querySelector('[data-arkme-session-column]')) return false
      native = next
      frameElement = frame
      const nw = next.defaultView!
      const visible = surface.getAttribute('data-arkme-visible')
      const close = () => next.dispatchEvent(new nw.Event(HARNESS_MENU_CLOSE))
      const point = (event: PointerEvent) => {
        const viewport = frame.getBoundingClientRect()
        return { x: event.clientX + viewport.left, y: event.clientY + viewport.top }
      }
      const move = (event: PointerEvent) => hover.checkPointer(event.target, point(event))
      const leave = (event: PointerEvent) => { if (!event.relatedTarget) hover.checkPointer(null, point(event)) }
      const observer = new win.MutationObserver(() => {
        if (!surface.isConnected || surface.getAttribute('data-arkme-account-scope') !== scope
          || surface.getAttribute('data-arkme-visible') !== visible) close()
      })
      observer.observe(surface, { attributes: true, attributeFilter: ['data-arkme-account-id', 'data-arkme-account-scope', 'data-arkme-visible'] })
      next.addEventListener('pointermove', move, true)
      next.addEventListener('pointerover', move, true)
      next.addEventListener('pointerout', leave, true)
      frame.addEventListener('load', close)
      stopWatching = () => {
        observer.disconnect()
        next.removeEventListener('pointermove', move, true)
        next.removeEventListener('pointerover', move, true)
        next.removeEventListener('pointerout', leave, true)
        frame.removeEventListener('load', close)
      }
      const request: HarnessSessionMenuRequest = {
        accepted: false,
        anchor: () => {
          const card = hover.anchor(), viewport = frame.getBoundingClientRect()
          return { left: card.left - viewport.left, right: card.right - viewport.left, top: card.top - viewport.top, bottom: card.bottom - viewport.top }
        },
        onLayout: () => {},
        onClose: focus => { release(); hover.onClose(focus) },
        onSelect: activate,
      }
      next.dispatchEvent(new nw.CustomEvent(HARNESS_MENU_OPEN, { detail: request }))
      if (!request.accepted) { release(); return false }
      if (hover.focusMenu) next.querySelector('[data-arkme-session-trigger]')?.dispatchEvent(new nw.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
      return true
    },
    close: () => { native?.dispatchEvent(new native.defaultView!.Event(HARNESS_MENU_CLOSE)); release() },
    position: () => native?.dispatchEvent(new native.defaultView!.Event(HARNESS_MENU_POSITION)),
    contains: target => !!native && harnessMenuLayers(native).some(node => node.contains(target as Node | null)),
    bounds: () => {
      if (!native || !frameElement) return []
      const viewport = frameElement.getBoundingClientRect()
      return harnessMenuLayers(native).map(node => {
        const rect = node.getBoundingClientRect()
        return { left: rect.left + viewport.left, right: rect.right + viewport.left,
          top: rect.top + viewport.top, bottom: rect.bottom + viewport.top }
      })
    },
  })
}
