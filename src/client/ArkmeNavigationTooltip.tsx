import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { arkmeTheme as theme } from './arkme-theme.js'

type NavigationHint = { anchor: HTMLElement; target: string; text: string }

/** One delayed hint for the rail, outside its scrolling/clipping container. */
export function useArkmeNavigationTooltip(enabled: boolean) {
  const id = useId()
  const [hint, setHint] = useState<NavigationHint>()
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const hide = useCallback(() => {
    clearTimeout(timer.current)
    setHint(undefined)
  }, [])
  const show = (anchor: HTMLElement, target: string, text: string, immediate = false) => {
    hide()
    if (!enabled) return
    const open = () => { if (anchor.isConnected) setHint({ anchor, target, text }) }
    if (immediate) open()
    else timer.current = setTimeout(open, 200)
  }
  useEffect(() => {
    hide()
    if (!enabled || typeof document === 'undefined') return
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') hide() }
    document.addEventListener('scroll', hide, true)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', hide)
    window.addEventListener('blur', hide)
    return () => {
      clearTimeout(timer.current)
      document.removeEventListener('scroll', hide, true)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', hide)
      window.removeEventListener('blur', hide)
    }
  }, [enabled, hide])
  return {
    show, hide,
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
