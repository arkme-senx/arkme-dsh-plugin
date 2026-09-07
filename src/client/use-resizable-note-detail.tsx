import { useEffect, useRef, useState, type RefObject } from 'react'

export const NOTE_DETAIL_WIDTH_KEY = 'arkme:note-detail-width:v1'
export const DEFAULT_NOTE_DETAIL_WIDTH = 405
export function noteDetailWidthBounds(available: number) {
  const safeAvailable = Number.isFinite(available) ? Math.max(0, available) : DEFAULT_NOTE_DETAIL_WIDTH
  const min = Math.min(DEFAULT_NOTE_DETAIL_WIDTH, safeAvailable)
  return { min, max: Math.min(safeAvailable, Math.max(DEFAULT_NOTE_DETAIL_WIDTH, safeAvailable * 0.6)) }
}
export function clampNoteDetailWidth(width: number, available: number) {
  const { min, max } = noteDetailWidthBounds(available)
  return Math.max(min, Math.min(Number.isFinite(width) ? width : DEFAULT_NOTE_DETAIL_WIDTH, max))
}

/** Shared local-only layout preference for right-hand quick-note drawers. */
export function useResizableNoteDetail(panel: RefObject<HTMLElement>) {
  const [preferred, setPreferred] = useState(() => {
    try {
      const stored = window.localStorage.getItem(NOTE_DETAIL_WIDTH_KEY)
      const width = Number(stored)
      return stored !== null && Number.isFinite(width) && width > 0 ? width : DEFAULT_NOTE_DETAIL_WIDTH
    } catch { return DEFAULT_NOTE_DETAIL_WIDTH }
  })
  const [available, setAvailable] = useState(1000)
  const [dragging, setDragging] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const drag = useRef<{ id: number; x: number; width: number }>()
  const latest = useRef(preferred)
  const bounds = noteDetailWidthBounds(available)
  const width = clampNoteDetailWidth(preferred, available)
  const save = () => {
    try { window.localStorage.setItem(NOTE_DETAIL_WIDTH_KEY, String(latest.current)) } catch { /* optional storage */ }
  }
  const update = (next: number) => {
    latest.current = clampNoteDetailWidth(next, available)
    setPreferred(latest.current)
  }
  useEffect(() => {
    if (typeof window === 'undefined') return
    const parent = panel.current?.parentElement
    const measure = () => setAvailable(parent?.clientWidth || window.innerWidth)
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure)
    if (parent) observer?.observe(parent)
    window.addEventListener('resize', measure)
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure) }
  }, [panel])
  useEffect(() => {
    if (!dragging) return
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
  const highlighted = dragging || hovered || focused
  return {
    style: { width, maxWidth: '100%' },
    handle: <div role="separator" aria-label="调整快记详情宽度" aria-orientation="vertical"
      aria-valuemin={Math.round(bounds.min)} aria-valuemax={Math.round(bounds.max)} aria-valuenow={Math.round(width)}
      tabIndex={0} title="左右拖动调整详情宽度，双击恢复默认宽度"
      style={{ position: 'absolute', left: -5, top: 0, bottom: 0, width: 10, zIndex: 20, cursor: 'ew-resize', touchAction: 'none' }}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      onPointerDown={event => {
        if (event.button !== 0 || drag.current) return
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        drag.current = { id: event.pointerId, x: event.clientX, width: panel.current?.getBoundingClientRect().width ?? width }
        setDragging(true)
      }}
      onPointerMove={event => {
        if (drag.current?.id === event.pointerId) update(drag.current.width + drag.current.x - event.clientX)
      }}
      onPointerUp={event => finish(event.pointerId)} onPointerCancel={event => finish(event.pointerId)}
      onLostPointerCapture={event => finish(event.pointerId)}
      onDoubleClick={() => { update(DEFAULT_NOTE_DETAIL_WIDTH); save() }}
      onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter'].includes(event.key)) return
        event.preventDefault()
        update(event.key === 'Enter' ? DEFAULT_NOTE_DETAIL_WIDTH : event.key === 'Home' ? bounds.min : event.key === 'End' ? bounds.max : width + (event.key === 'ArrowLeft' ? 20 : -20))
        save()
      }}>
      <span aria-hidden style={{ position: 'absolute', top: 0, bottom: 0, left: 4, width: 3, background: highlighted ? '#09B83E' : 'transparent', pointerEvents: 'none' }} />
    </div>,
  }
}
