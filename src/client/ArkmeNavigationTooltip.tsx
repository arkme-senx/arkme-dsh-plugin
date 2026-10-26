import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { arkmeTheme as theme } from './arkme-theme.js'

type NavigationHint = { anchor: HTMLElement; target: string; text: string }
type HintRequest = NavigationHint & { keyboard: boolean }

/** One delayed hint for the rail, outside its scrolling/clipping container. */
export function useArkmeNavigationTooltip(enabled: boolean) {
  const id = useId()
  const [hint, setHint] = useState<NavigationHint>()
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const request = useRef<HintRequest>()
  const keyboardIntent = useRef(0)
  const pointerMoved = useRef(false)
  const hide = useCallback(() => {
    clearTimeout(timer.current)
    timer.current = undefined
    request.current = undefined
    setHint(undefined)
  }, [])
  const ready = (anchor: HTMLElement) => anchor.isConnected && anchor.ownerDocument.visibilityState === 'visible' && anchor.ownerDocument.hasFocus()
  const canHover = (anchor: HTMLElement) => pointerMoved.current && ready(anchor) && anchor.matches(':hover')
  const isKeyboardFocus = (anchor: HTMLElement) => keyboardIntent.current > Date.now() && ready(anchor)
    && anchor.ownerDocument.activeElement === anchor && anchor.matches(':focus-visible')
  const takeKeyboardFocus = (anchor: HTMLElement) => {
    const allowed = isKeyboardFocus(anchor)
    keyboardIntent.current = 0
    return allowed
  }
  const show = (anchor: HTMLElement, target: string, text: string, immediate = false) => {
    const previous = request.current
    if (previous?.anchor === anchor && previous.text === text && previous.keyboard === immediate) return
    hide()
    if (!enabled || !(immediate ? isKeyboardFocus(anchor) : canHover(anchor))) return
    const next = { anchor, target, text, keyboard: immediate }
    request.current = next
    const open = () => {
      if (request.current !== next) return
      if (!(next.keyboard ? isKeyboardFocus(anchor) : canHover(anchor))) { hide(); return }
      timer.current = undefined
      if (next.keyboard) keyboardIntent.current = 0
      setHint(next)
    }
    if (immediate) open()
    else timer.current = setTimeout(open, 500)
  }
  useEffect(() => {
    hide()
    // The compact rail suppresses ordinary labels but its live-recording hint
    // still needs the same pointer/keyboard intent and activation boundaries.
    if (typeof document === 'undefined') return
    const suspend = () => { keyboardIntent.current = 0; pointerMoved.current = false; hide() }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { suspend(); return }
      if (event.metaKey || event.altKey || event.ctrlKey) { suspend(); return }
      keyboardIntent.current = ['Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) ? Date.now() + 1000 : 0
    }
    const onPointerDown = () => { keyboardIntent.current = 0; hide() }
    const onPointerMove = (event: PointerEvent) => {
      if (!document.hasFocus() || document.visibilityState !== 'visible') { suspend(); return }
      pointerMoved.current = true
      keyboardIntent.current = 0
      const current = request.current
      if (current && (current.keyboard || !(event.target instanceof Node) || !current.anchor.contains(event.target))) hide()
    }
    document.addEventListener('scroll', hide, true)
    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('pointermove', onPointerMove, { capture: true, passive: true })
    document.addEventListener('pointercancel', suspend, true)
    document.addEventListener('pointerleave', suspend)
    document.addEventListener('visibilitychange', suspend)
    window.addEventListener('resize', hide)
    window.addEventListener('blur', suspend)
    window.addEventListener('focus', suspend)
    return () => {
      clearTimeout(timer.current)
      request.current = undefined
      keyboardIntent.current = 0
      pointerMoved.current = false
      document.removeEventListener('scroll', hide, true)
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('pointermove', onPointerMove, true)
      document.removeEventListener('pointercancel', suspend, true)
      document.removeEventListener('pointerleave', suspend)
      document.removeEventListener('visibilitychange', suspend)
      window.removeEventListener('resize', hide)
      window.removeEventListener('blur', suspend)
      window.removeEventListener('focus', suspend)
    }
  }, [enabled, hide])
  return {
    show, hide, canHover, takeKeyboardFocus,
    describedBy: (target: string) => enabled && hint?.target === target ? id : undefined,
    tooltip: enabled && hint ? <NavigationTooltip key={hint.target} hint={hint} id={id} /> : null,
  }
}

function NavigationTooltip({ hint: { anchor, text }, id }: { hint: NavigationHint; id: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: 0, top: 0 })
  const owner = anchor.ownerDocument
  useLayoutEffect(() => {
    const view = owner.defaultView
    if (!view || !ref.current) return
    const bounds = anchor.getBoundingClientRect()
    const size = ref.current.getBoundingClientRect()
    setPosition({
      left: Math.max(8, Math.min(bounds.right + 8, view.innerWidth - size.width - 8)),
      top: Math.max(8, Math.min(bounds.top + (bounds.height - size.height) / 2, view.innerHeight - size.height - 8)),
    })
  }, [anchor, owner, text])
  return createPortal(<div ref={ref} id={id} role="tooltip" data-arkme-navigation-tooltip style={{
    position: 'fixed', ...position, zIndex: 10000, pointerEvents: 'none',
    maxWidth: 'min(280px, calc(100vw - 16px))', boxSizing: 'border-box', padding: '7px 10px',
    border: `1px solid ${theme.border}`, borderRadius: 8,
    background: theme.menu, color: theme.text, boxShadow: theme.shadow,
    fontSize: 12, lineHeight: '18px', whiteSpace: 'pre-line', overflowWrap: 'anywhere',
  }}>{text}</div>, owner.body)
}
