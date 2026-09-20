import { HARNESS_MENU_POSITION, harnessMenuLayers } from './harness-session-menu-bridge.js'
import { conversationMenuLayer } from './conversation-menu-layer.js'
import { CONVERSATION_MENU_SURFACE } from './conversation-selector-style.js'

type PaintRect = Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom'>

/** Subtract the iframe's painted areas, including overlapping native portals. */
function uncoveredRects(bounds: PaintRect, painted: PaintRect[]): PaintRect[] {
  return painted.reduce<PaintRect[]>((remaining, cover) => remaining.flatMap(area => {
    const left = Math.max(area.left, cover.left), right = Math.min(area.right, cover.right)
    const top = Math.max(area.top, cover.top), bottom = Math.min(area.bottom, cover.bottom)
    if (left >= right || top >= bottom) return [area]
    return [
      { left: area.left, top: area.top, right: area.right, bottom: top },
      { left: area.left, top: bottom, right: area.right, bottom: area.bottom },
      { left: area.left, top, right: left, bottom },
      { left: right, top, right: area.right, bottom },
    ].filter(rect => rect.left < rect.right && rect.top < rect.bottom)
  }), [bounds])
}

/**
 * The one native iframe stays in the page-level layer for its entire lifetime.
 * Only its visible region changes when a menu opens; the conversation seat and
 * the iframe viewport never move or resize in response to hover.
 */
export function watchHarnessSurfaceViewport(surface: HTMLElement, frame: HTMLIFrameElement, seat: HTMLElement): () => void {
  const win = surface.ownerDocument.defaultView!
  let native: Document | undefined
  let nativeObserver: MutationObserver | undefined
  let viewportStyle: HTMLStyleElement | undefined
  let contentFrame: HTMLElement | undefined
  let sessionHeader: HTMLElement | undefined
  let scheduled = 0
  let disposed = false
  const shadow = surface.ownerDocument.createElement('div')
  shadow.setAttribute('data-arkme-harness-menu-shadow', '')
  shadow.setAttribute('aria-hidden', 'true')
  Object.assign(shadow.style, { position: 'fixed', pointerEvents: 'none', zIndex: '10019',
    borderRadius: `${CONVERSATION_MENU_SURFACE.borderRadius}px`, boxShadow: CONVERSATION_MENU_SURFACE.boxShadow })
  const set = (node: HTMLElement, key: string, value: string) => {
    if (node.style.getPropertyValue(key) !== value) node.style.setProperty(key, value)
  }
  const rectPath = (left: number, top: number, right: number, bottom: number) =>
    `M ${left} ${top} H ${right} V ${bottom} H ${left} Z`
  function sync() {
    scheduled = 0
    if (disposed || !native) return
    const rect = seat.getBoundingClientRect()
    const viewport = native.documentElement
    for (const [key, value] of Object.entries({ left: rect.left, top: rect.top, width: rect.width, height: rect.height })) {
      set(viewport, `--arkme-harness-content-${key}`, `${value}px`)
    }
    const visible = surface.getAttribute('data-arkme-visible') === 'true'
    if (visible) viewport.removeAttribute('data-arkme-session-preview')
    else if (!viewport.hasAttribute('data-arkme-session-preview')) viewport.setAttribute('data-arkme-session-preview', '')
    const nextContent = native.querySelector<HTMLElement>('[data-arkme-session-frame]')
      ?? native.querySelector<HTMLElement>('[data-rightbar-col]')?.parentElement ?? undefined
    if (nextContent !== contentFrame) {
      contentFrame?.removeAttribute('data-arkme-harness-content-frame')
      contentFrame = nextContent
      contentFrame?.setAttribute('data-arkme-harness-content-frame', '')
    }
    const nextHeader = contentFrame?.querySelector<HTMLElement>('[data-slot="conversation.session.header"] > header') ?? undefined
    if (nextHeader !== sessionHeader) {
      if (sessionHeader) resize?.unobserve(sessionHeader)
      sessionHeader = nextHeader
      if (sessionHeader) resize?.observe(sessionHeader)
    }
    // Native fullscreen panels are fixed to the iframe viewport, which is
    // intentionally wider than the visible conversation seat (for menus).
    // Keep their entire contents inside that seat, below the live task header.
    const headerBottom = sessionHeader?.getAttribute('aria-hidden') !== 'true'
      ? sessionHeader?.getBoundingClientRect().bottom ?? rect.top : rect.top
    const panelTop = Math.min(rect.bottom, Math.max(rect.top, headerBottom))
    set(viewport, '--arkme-harness-panel-top', `${panelTop}px`)
    set(viewport, '--arkme-harness-panel-height', `${Math.max(0, rect.bottom - panelTop)}px`)
    const ready = contentFrame !== undefined
    const layers = ready ? harnessMenuLayers(native) : []
    let menuRect: PaintRect | undefined
    const painted: PaintRect[] = visible && ready ? [rect] : []
    for (const layer of layers) {
      const r = layer.getBoundingClientRect()
      const isMenu = layer.hasAttribute('data-arkme-session-column')
      if (isMenu) {
        menuRect = r
        for (const [key, value] of Object.entries({ left: r.left, top: r.top, width: r.width, height: r.height })) set(shadow, key, `${value}px`)
        if (!shadow.isConnected) conversationMenuLayer(surface.ownerDocument).append(shadow)
      }
      // Native menus and their shadows stay inside the iframe. Only the list's
      // clipped-off shadow is painted outside, without intercepting clicks.
      const inset = isMenu ? 0 : 40
      painted.push({ left: Math.max(0, r.left - inset), top: Math.max(0, r.top - inset),
        right: Math.min(win.innerWidth, r.right + inset), bottom: Math.min(win.innerHeight, r.bottom + inset) })
    }
    if (!menuRect) shadow.remove()
    else {
      // Never put the list shadow over a native action menu. The native column
      // paints it inside the iframe; this underlay fills only the exposed gaps,
      // so translucent areas do not receive a second, darker copy of it.
      const origin = menuRect
      const outside = uncoveredRects({ left: 0, top: 0, right: win.innerWidth, bottom: win.innerHeight }, painted)
      set(shadow, 'clip-path', outside.length ? `path("${outside.map(r => rectPath(r.left - origin.left, r.top - origin.top, r.right - origin.left, r.bottom - origin.top)).join(' ')}")` : 'inset(100%)')
    }
    const paths = painted.map(r => rectPath(r.left, r.top, r.right, r.bottom))
    set(surface, 'clip-path', paths.length ? `path("${paths.join(' ')}")` : 'inset(100%)')
    set(surface, 'visibility', paths.length ? 'visible' : 'hidden')
    set(surface, 'pointer-events', paths.length ? 'auto' : 'none')
    set(surface, 'z-index', layers.length ? '10020' : '1')
    if (paths.length) surface.removeAttribute('aria-hidden')
    else surface.setAttribute('aria-hidden', 'true')
  }
  function schedule() { if (!disposed && !scheduled) scheduled = win.requestAnimationFrame(sync) }
  function attach() {
    nativeObserver?.disconnect()
    viewportStyle?.remove()
    contentFrame?.removeAttribute('data-arkme-harness-content-frame')
    contentFrame = undefined
    if (sessionHeader) resize?.unobserve(sessionHeader)
    sessionHeader = undefined
    native?.documentElement.removeAttribute('data-arkme-harness-viewport')
    try { native = frame.contentDocument ?? undefined } catch { native = undefined }
    if (!native) return
    native.documentElement.setAttribute('data-arkme-harness-viewport', '')
    viewportStyle = native.createElement('style')
    viewportStyle.textContent = `
      html[data-arkme-harness-viewport], html[data-arkme-harness-viewport] body { background: transparent !important; }
      [data-arkme-harness-content-frame] {
        position: absolute !important; left: var(--arkme-harness-content-left); top: var(--arkme-harness-content-top);
        width: var(--arkme-harness-content-width); height: var(--arkme-harness-content-height);
      }
      [data-arkme-harness-content-frame] [data-sidebar-right-panel="fullscreen"] {
        left: var(--arkme-harness-content-left) !important; right: auto !important;
        top: var(--arkme-harness-panel-top) !important; bottom: auto !important;
        width: var(--arkme-harness-content-width) !important;
        height: var(--arkme-harness-panel-height) !important;
      }
    `
    native.head.append(viewportStyle)
    nativeObserver = new win.MutationObserver(schedule)
    nativeObserver.observe(native.documentElement, { childList: true, subtree: true, attributes: true,
      attributeFilter: ['style', 'class', 'hidden', 'aria-hidden', 'data-arkme-session-open', 'data-arkme-session-frame'] })
    sync()
  }
  const position = () => {
    // A queued resize can outlive the iframe document or this observer.
    const nativeWindow = native?.defaultView
    if (disposed || !nativeWindow) return
    sync()
    native?.dispatchEvent(new nativeWindow.Event(HARNESS_MENU_POSITION))
  }
  const resize = typeof win.ResizeObserver === 'function' ? new win.ResizeObserver(position) : undefined
  resize?.observe(seat)
  const visibility = new win.MutationObserver(sync)
  visibility.observe(surface, { attributes: true, attributeFilter: ['data-arkme-visible'] })
  frame.addEventListener('load', attach)
  win.addEventListener('resize', position)
  win.addEventListener('scroll', position, true)
  attach()
  return () => {
    disposed = true
    win.cancelAnimationFrame(scheduled)
    nativeObserver?.disconnect(); visibility.disconnect(); resize?.disconnect()
    viewportStyle?.remove()
    contentFrame?.removeAttribute('data-arkme-harness-content-frame')
    shadow.remove()
    frame.removeEventListener('load', attach)
    win.removeEventListener('resize', position)
    win.removeEventListener('scroll', position, true)
    native?.documentElement.removeAttribute('data-arkme-harness-viewport')
    native?.documentElement.removeAttribute('data-arkme-session-preview')
    for (const key of ['left', 'top', 'width', 'height']) native?.documentElement.style.removeProperty(`--arkme-harness-content-${key}`)
    for (const key of ['top', 'height']) native?.documentElement.style.removeProperty(`--arkme-harness-panel-${key}`)
  }
}
