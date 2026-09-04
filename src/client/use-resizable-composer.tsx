import { useEffect, useRef, useState, type RefObject } from 'react'

export const COMPOSER_HEIGHT_KEY = 'arkme:composer-editor-height:v1'
export function clampComposerHeight(height: number, maximum: number): number {
  return Math.max(38, Math.min(Number.isFinite(height) ? height : 38, Math.max(38, maximum)))
}

/** Client-only presentation preference; no message or account data is stored. */
export function useResizableComposer(container: RefObject<HTMLDivElement>, scope?: string, messageBody?: RefObject<HTMLDivElement>) {
  const [height, setHeight] = useState<number | undefined>(() => {
    try {
      const value = window.localStorage.getItem(COMPOSER_HEIGHT_KEY)
      const parsed = Number(value)
      return value !== null && Number.isFinite(parsed) && parsed >= 38 ? parsed : undefined
    } catch { return undefined }
  })
  const [maximum, setMaximum] = useState(336)
  const [active, setActive] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const drag = useRef<{ id: number; y: number; height: number }>()
  const current = useRef(height)
  const maxRef = useRef(maximum)
  maxRef.current = maximum
  const persist = () => {
    try {
      if (current.current === undefined) window.localStorage.removeItem(COMPOSER_HEIGHT_KEY)
      else window.localStorage.setItem(COMPOSER_HEIGHT_KEY, String(current.current))
    } catch { /* Storage may be disabled; resizing still works. */ }
  }
  const update = (value: number | undefined) => {
    current.current = value === undefined ? undefined : clampComposerHeight(value, maxRef.current)
    setHeight(current.current)
  }
  useEffect(() => {
    if (typeof window === 'undefined') return
    const measure = () => {
      const editor = container.current?.querySelector('[contenteditable]')
      const panel = container.current?.getBoundingClientRect()
      const overhead = panel && editor ? panel.height - editor.getBoundingClientRect().height : 80
      const available = panel && messageBody?.current
        ? panel.height + messageBody.current.clientHeight
        : window.innerHeight - 100
      setMaximum(Math.max(38, Math.min(600, available * 0.8 - overhead)))
    }
    measure()
    window.addEventListener('resize', measure)
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure)
    if (container.current) observer?.observe(container.current)
    if (messageBody?.current) observer?.observe(messageBody.current)
    return () => { window.removeEventListener('resize', measure); observer?.disconnect() }
  }, [container, scope, messageBody])
  useEffect(() => {
    drag.current = undefined
    setActive(false)
    setHovered(false)
    setFocused(false)
  }, [scope])
  useEffect(() => {
    if (!active) return
    const previousCursor = document.body.style.cursor
    const previousSelection = document.body.style.userSelect
    document.body.style.cursor = 'ns-resize'
    document.body.style.userSelect = 'none'
    return () => { document.body.style.cursor = previousCursor; document.body.style.userSelect = previousSelection }
  }, [active])
  const finish = () => { drag.current = undefined; setActive(false); persist() }
  const visibleHeight = height === undefined ? undefined : clampComposerHeight(height, maximum)
  return {
    editorStyle: visibleHeight === undefined ? {} : { height: visibleHeight, minHeight: 38, maxHeight: maximum },
    highlighted: active || hovered || focused,
    handle: <div role="separator" aria-label="调整输入框高度" aria-orientation="horizontal"
      aria-valuemin={38} aria-valuemax={Math.round(maximum)} aria-valuenow={Math.round(visibleHeight ?? 38)} tabIndex={0}
      title="上下拖动调整输入框高度，双击恢复自动高度"
      style={{ position: 'absolute', top: -3, left: 0, right: 0, height: 6, zIndex: 5, cursor: 'ns-resize', touchAction: 'none' }}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      onPointerDown={event => {
        if (event.button !== 0 || drag.current) return
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        drag.current = { id: event.pointerId, y: event.clientY, height: container.current?.querySelector('[contenteditable]')?.getBoundingClientRect().height ?? 38 }
        setActive(true)
      }}
      onPointerMove={event => {
        if (drag.current?.id === event.pointerId) update(drag.current.height + drag.current.y - event.clientY)
      }}
      onPointerUp={event => { if (drag.current?.id === event.pointerId) finish() }}
      onPointerCancel={finish} onLostPointerCapture={finish}
      onDoubleClick={() => { update(undefined); persist() }}
      onKeyDown={event => {
        if (!['ArrowUp', 'ArrowDown', 'Home', 'End', 'Enter'].includes(event.key)) return
        event.preventDefault()
        const measured = container.current?.querySelector('[contenteditable]')?.getBoundingClientRect().height ?? 38
        update(event.key === 'Enter' ? undefined : event.key === 'Home' ? 38 : event.key === 'End' ? maximum : measured + (event.key === 'ArrowUp' ? 20 : -20))
        persist()
      }} />,
  }
}
