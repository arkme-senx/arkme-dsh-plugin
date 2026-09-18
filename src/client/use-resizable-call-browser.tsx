import { useEffect, useRef, useState, type RefObject } from 'react'
import { arkmeTheme } from './arkme-theme.js'

export const CALL_BROWSER_WIDTH_KEY = 'arkme:call-browser-width:v1'
export const DEFAULT_CALL_BROWSER_WIDTH = 326
export function callBrowserWidthBounds(available: number) {
  const space = Math.max(0, (Number.isFinite(available) ? available : 1000) - 3)
  const max = Math.min(520, space - Math.min(360, space / 2))
  return { min: Math.min(240, max), max }
}

/** Local layout preference; temporarily narrow with the window without losing the saved width. */
export function useResizableCallBrowser(surface: RefObject<HTMLElement>) {
  const [preferred, setPreferred] = useState(() => {
    try {
      const value = Number(window.localStorage.getItem(CALL_BROWSER_WIDTH_KEY))
      return Number.isFinite(value) && value > 0 ? value : DEFAULT_CALL_BROWSER_WIDTH
    } catch { return DEFAULT_CALL_BROWSER_WIDTH }
  })
  const [available, setAvailable] = useState(1000)
  const [dragging, setDragging] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const drag = useRef<{ id: number; x: number; width: number }>()
  const latest = useRef(preferred)
  const bounds = callBrowserWidthBounds(available)
  const clamp = (value: number) => Math.round(Math.max(bounds.min, Math.min(value, bounds.max)))
  const width = clamp(preferred)
  const save = () => {
    try { window.localStorage.setItem(CALL_BROWSER_WIDTH_KEY, String(latest.current)) } catch { /* optional storage */ }
  }
  const update = (value: number) => { latest.current = clamp(value); setPreferred(latest.current) }
  useEffect(() => {
    if (typeof window === 'undefined') return
    const element = surface.current
    const measure = () => setAvailable(element?.clientWidth || window.innerWidth || 1000)
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure)
    if (element) observer?.observe(element)
    window.addEventListener('resize', measure)
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure) }
  }, [surface])
  useEffect(() => {
    if (!dragging || typeof document === 'undefined') return
    const { cursor, userSelect } = document.body.style
    document.body.style.cursor = 'ew-resize'
    document.body.style.userSelect = 'none'
    return () => { document.body.style.cursor = cursor; document.body.style.userSelect = userSelect }
  }, [dragging])
  const finish = (id: number) => {
    if (drag.current?.id !== id) return
    drag.current = undefined
    setDragging(false)
    save()
  }
  return {
    width,
    handle: <div role="separator" aria-label="调整通话记录宽度" aria-orientation="vertical"
      aria-valuemin={Math.round(bounds.min)} aria-valuemax={Math.round(bounds.max)} aria-valuenow={width}
      tabIndex={0} title="左右拖动调整通话记录宽度，双击恢复默认宽度"
      style={{ position: 'relative', width: 3, zIndex: 3, cursor: 'ew-resize', touchAction: 'none', outline: 'none' }}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      onPointerDown={event => {
        if (event.button !== 0 || drag.current) return
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        latest.current = width
        drag.current = { id: event.pointerId, x: event.clientX, width }
        setDragging(true)
      }}
      onPointerMove={event => {
        if (drag.current?.id === event.pointerId) update(drag.current.width + event.clientX - drag.current.x)
      }}
      onPointerUp={event => finish(event.pointerId)} onPointerCancel={event => finish(event.pointerId)}
      onLostPointerCapture={event => finish(event.pointerId)}
      onDoubleClick={() => { update(DEFAULT_CALL_BROWSER_WIDTH); save() }}
      onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter'].includes(event.key)) return
        event.preventDefault()
        update(event.key === 'Enter' ? DEFAULT_CALL_BROWSER_WIDTH : event.key === 'Home' ? bounds.min
          : event.key === 'End' ? bounds.max : width + (event.key === 'ArrowLeft' ? -16 : 16))
        save()
      }}>
      <span aria-hidden style={{ position: 'absolute', inset: '0 -3px' }} />
      <span aria-hidden style={{ position: 'absolute', top: 0, bottom: 0,
        left: dragging || hovered || focused ? 0 : 1, width: dragging || hovered || focused ? 3 : 1,
        background: dragging || hovered || focused ? '#09B83E' : arkmeTheme.borderSoft, pointerEvents: 'none' }} />
    </div>,
  }
}
