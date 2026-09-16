import { HARNESS_MENU_OPEN, HARNESS_MENU_CLOSE, HARNESS_MENU_POSITION, harnessMenuLayers, type HarnessSessionMenuRequest } from './harness-session-menu-bridge.js'

/** Reveal the mounted native sidebar only; never change the current Arkme conversation on hover. */
export function watchHarnessSessionHover(anchor: HTMLElement, scope: string, activate: () => void): () => void {
  const doc = anchor.ownerDocument
  const win = doc.defaultView
  if (!win) return () => {}
  let openTimer = 0
  let closeTimer = 0
  let native: Document | undefined
  let surface: HTMLElement | undefined
  let frame: HTMLIFrameElement | undefined
  let open = false
  let stopWatching: (() => void) | undefined
  const style = doc.createElement('style')
  style.textContent = `
    [data-arkme-harness-menu-preview] {
      visibility: visible !important; pointer-events: auto !important; z-index: 50 !important;
      background: transparent !important; clip-path: var(--arkme-harness-menu-clip, inset(100%)) !important;
    }
    [data-arkme-harness-menu-preview] > iframe { background: transparent !important; }
  `
  const clearTimers = () => {
    win.clearTimeout(openTimer); win.clearTimeout(closeTimer)
    openTimer = 0; closeTimer = 0
  }
  function release(focus = false) {
    clearTimers()
    open = false
    stopWatching?.(); stopWatching = undefined
    surface?.removeAttribute('data-arkme-harness-menu-preview')
    surface?.style.removeProperty('--arkme-harness-menu-clip')
    if (surface?.getAttribute('data-arkme-visible') === 'true') surface.removeAttribute('aria-hidden')
    else if (surface) surface.setAttribute('aria-hidden', 'true')
    native?.documentElement.removeAttribute('data-arkme-session-preview')
    style.remove()
    anchor.setAttribute('aria-expanded', 'false')
    native = undefined; surface = undefined; frame = undefined
    if (focus && anchor.isConnected) anchor.focus({ preventScroll: true })
  }
  function close() {
    clearTimers()
    native?.dispatchEvent(new native.defaultView!.Event(HARNESS_MENU_CLOSE))
    release()
  }
  function later() {
    win!.clearTimeout(openTimer); openTimer = 0
    if (open && !closeTimer) closeTimer = win!.setTimeout(close, 300)
  }
  function keep() { win!.clearTimeout(closeTimer); closeTimer = 0 }
  function layout() {
    if (!open || !native || !surface || !frame || !surface.hasAttribute('data-arkme-harness-menu-preview')) return
    const boxes = harnessMenuLayers(native).map(node => node.getBoundingClientRect())
    if (!boxes.length) return
    const width = frame.clientWidth, height = frame.clientHeight
    const left = Math.max(0, Math.min(...boxes.map(box => box.left)) - 16)
    const top = Math.max(0, Math.min(...boxes.map(box => box.top)) - 16)
    const right = Math.max(0, width - Math.max(...boxes.map(box => box.right)) - 16)
    const bottom = Math.max(0, height - Math.max(...boxes.map(box => box.bottom)) - 16)
    const clip = `inset(${top}px ${right}px ${bottom}px ${left}px)`
    if (surface.style.getPropertyValue('--arkme-harness-menu-clip') !== clip) surface.style.setProperty('--arkme-harness-menu-clip', clip)
  }
  function openMenu(focus = false) {
    clearTimers()
    if (open) return
    const nextSurface = doc.querySelector<HTMLElement>('[data-arkme-owned="deepseek-harness-surface"][data-arkme-account-id]')
    if (!anchor.isConnected || !anchor.getClientRects().length || nextSurface?.getAttribute('data-arkme-account-scope') !== scope) return
    const nextFrame = nextSurface.querySelector('iframe')
    let nextNative: Document | null | undefined
    try { nextNative = nextFrame?.contentDocument } catch { return }
    if (!nextNative?.querySelector('[data-arkme-session-column]') || !nextFrame) return
    surface = nextSurface; native = nextNative; frame = nextFrame; open = true
    const wasVisible = surface.getAttribute('data-arkme-visible')
    if (wasVisible !== 'true') {
      doc.head.append(style)
      native.documentElement.setAttribute('data-arkme-session-preview', '')
      surface.setAttribute('data-arkme-harness-menu-preview', '')
      surface.removeAttribute('aria-hidden')
    }
    const request: HarnessSessionMenuRequest = {
      accepted: false,
      anchor: () => {
        const card = anchor.getBoundingClientRect(), viewport = nextFrame.getBoundingClientRect()
        return { left: card.right + 8 - viewport.left, top: card.top - viewport.top }
      },
      onClose: release,
      onLayout: layout,
      onSelect: activate,
    }
    native.dispatchEvent(new native.defaultView!.CustomEvent(HARNESS_MENU_OPEN, { detail: request }))
    if (!request.accepted || !open) { release(); return }
    anchor.setAttribute('aria-expanded', 'true')
    const menuHit = (target: EventTarget | null) => native && harnessMenuLayers(native).some(node => node.contains(target as Node | null))
    const nativeMove = (event: Event) => { if (menuHit(event.target)) keep(); else later() }
    const nativeLeave = (event: PointerEvent) => { if (!event.relatedTarget) later() }
    const parentDown = (event: Event) => { if (!anchor.contains(event.target as Node | null)) close() }
    const parentKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault(); close(); anchor.focus({ preventScroll: true })
    }
    const updatePosition = () => {
      if (!anchor.isConnected || !anchor.getClientRects().length) { close(); return }
      native?.dispatchEvent(new native.defaultView!.Event(HARNESS_MENU_POSITION))
    }
    const observer = new win!.MutationObserver(() => {
      if (!surface?.isConnected || surface.getAttribute('data-arkme-account-scope') !== scope
        || surface.getAttribute('data-arkme-visible') !== wasVisible) close()
    })
    observer.observe(surface, { attributes: true, attributeFilter: ['data-arkme-account-id', 'data-arkme-account-scope', 'data-arkme-visible'] })
    const resize = new win!.ResizeObserver(updatePosition)
    resize.observe(anchor); resize.observe(frame)
    native.addEventListener('pointermove', nativeMove, true)
    native.addEventListener('pointerover', nativeMove, true)
    native.addEventListener('pointerout', nativeLeave, true)
    doc.addEventListener('pointerdown', parentDown, true)
    doc.addEventListener('keydown', parentKey)
    doc.addEventListener('scroll', updatePosition, true)
    win!.addEventListener('resize', updatePosition)
    frame.addEventListener('load', close)
    const watchedNative = native, watchedFrame = frame
    stopWatching = () => {
      observer.disconnect(); resize.disconnect()
      watchedNative.removeEventListener('pointermove', nativeMove, true)
      watchedNative.removeEventListener('pointerover', nativeMove, true)
      watchedNative.removeEventListener('pointerout', nativeLeave, true)
      doc.removeEventListener('pointerdown', parentDown, true)
      doc.removeEventListener('keydown', parentKey)
      doc.removeEventListener('scroll', updatePosition, true)
      win!.removeEventListener('resize', updatePosition)
      watchedFrame.removeEventListener('load', close)
    }
    layout()
    if (focus) native.querySelector('[data-arkme-session-trigger]')?.dispatchEvent(new native.defaultView!.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
  }
  const enter = (event: PointerEvent) => {
    if (event.pointerType === 'touch') return
    keep()
    if (!open && !openTimer) openTimer = win.setTimeout(() => openMenu(), 200)
  }
  const key = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowRight') return
    event.preventDefault(); openMenu(true)
  }
  anchor.setAttribute('aria-haspopup', 'dialog')
  anchor.setAttribute('aria-expanded', 'false')
  anchor.addEventListener('pointerenter', enter)
  anchor.addEventListener('pointerleave', later)
  anchor.addEventListener('pointerdown', close)
  anchor.addEventListener('keydown', key)
  return () => {
    close()
    anchor.removeEventListener('pointerenter', enter)
    anchor.removeEventListener('pointerleave', later)
    anchor.removeEventListener('pointerdown', close)
    anchor.removeEventListener('keydown', key)
    anchor.removeAttribute('aria-haspopup'); anchor.removeAttribute('aria-expanded')
  }
}
