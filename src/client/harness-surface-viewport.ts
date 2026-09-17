import { HARNESS_MENU_POSITION, harnessMenuLayers } from './harness-session-menu-bridge.js'
import { conversationMenuLayer } from './conversation-menu-layer.js'
import { CONVERSATION_MENU_SURFACE } from './conversation-selector-style.js'

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
  let scheduled = 0
  let disposed = false
  const shadow = surface.ownerDocument.createElement('div')
  shadow.setAttribute('data-arkme-harness-menu-shadow', '')
  shadow.setAttribute('aria-hidden', 'true')
  Object.assign(shadow.style, { position: 'fixed', pointerEvents: 'none', zIndex: '10021',
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
    const ready = contentFrame !== undefined
    const layers = ready ? harnessMenuLayers(native) : []
    let menuVisible = false
    const paths = visible && ready ? [rectPath(rect.left, rect.top, rect.right, rect.bottom)] : []
    for (const layer of layers) {
      const r = layer.getBoundingClientRect()
      const isMenu = layer.hasAttribute('data-arkme-session-column')
      if (isMenu) {
        menuVisible = true
        for (const [key, value] of Object.entries({ left: r.left, top: r.top, width: r.width, height: r.height })) set(shadow, key, `${value}px`)
        if (!shadow.isConnected) conversationMenuLayer(surface.ownerDocument).append(shadow)
      }
      // Paint the card's shadow outside the iframe so transparent shadow pixels
      // never intercept clicks on the conversation cards behind them.
      const inset = isMenu ? 0 : 40
      paths.push(rectPath(Math.max(0, r.left - inset), Math.max(0, r.top - inset), Math.min(win.innerWidth, r.right + inset), Math.min(win.innerHeight, r.bottom + inset)))
    }
    if (!menuVisible) shadow.remove()
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
    `
    native.head.append(viewportStyle)
    nativeObserver = new win.MutationObserver(schedule)
    nativeObserver.observe(native.documentElement, { childList: true, subtree: true, attributes: true,
      attributeFilter: ['style', 'class', 'hidden', 'data-arkme-session-open', 'data-arkme-session-frame'] })
    sync()
  }
  const position = () => { sync(); native?.dispatchEvent(new native.defaultView!.Event(HARNESS_MENU_POSITION)) }
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
  }
}
