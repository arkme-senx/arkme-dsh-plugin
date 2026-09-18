import { forwardRef, useId, useImperativeHandle, useLayoutEffect, useRef, type HTMLAttributes } from 'react'

export function overlayScrollbarGeometry(viewport: number, content: number, scrollTop: number) {
  const range = Math.max(0, content - viewport)
  const track = Math.max(0, viewport - 4)
  const height = Math.min(track, Math.max(24, track * viewport / Math.max(1, content)))
  const travel = track - height
  const position = Math.min(range, Math.max(0, scrollTop))
  return { range, height, travel, top: 2 + (range > 0 ? position / range * travel : 0) }
}

/** Native scrolling and existing viewport refs, with a non-layout, draggable scrollbar. */
export const ArkmeOverlayScrollArea = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function ArkmeOverlayScrollArea({ children, id, ...props }, forwardedRef) {
    const generatedId = useId()
    const viewportId = id ?? `arkme-scroll-${generatedId}`
    const areaRef = useRef<HTMLDivElement>(null)
    const viewportRef = useRef<HTMLDivElement>(null)
    const contentRef = useRef<HTMLDivElement>(null)
    const thumbRef = useRef<HTMLDivElement>(null)
    useImperativeHandle(forwardedRef, () => viewportRef.current!, [])

    useLayoutEffect(() => {
      const area = areaRef.current, viewport = viewportRef.current, content = contentRef.current, thumb = thumbRef.current
      if (area === null || viewport === null || content === null || thumb === null) return
      const win = viewport.ownerDocument.defaultView!
      let timer: number | undefined, frame: number | undefined
      let hovering = false
      let drag: { id: number; y: number; scrollTop: number } | undefined
      const geometry = () => overlayScrollbarGeometry(viewport.clientHeight, viewport.scrollHeight, viewport.scrollTop)
      const update = () => {
        frame = undefined
        const g = geometry()
        thumb.hidden = g.range <= 0 || viewport.clientHeight <= 0
        thumb.style.height = `${g.height}px`
        thumb.style.transform = `translateY(${g.top}px)`
        thumb.setAttribute('aria-valuemax', String(Math.round(g.range)))
        thumb.setAttribute('aria-valuenow', String(Math.round(Math.min(g.range, Math.max(0, viewport.scrollTop)))))
      }
      const schedule = () => { if (frame === undefined) frame = win.requestAnimationFrame(update) }
      const clearTimer = () => { if (timer !== undefined) win.clearTimeout(timer); timer = undefined }
      const reveal = () => { clearTimer(); area.dataset.arkmeScrollVisible = 'true' }
      const hideLater = () => {
        clearTimer()
        if (hovering || drag !== undefined || viewport.ownerDocument.activeElement === thumb) return
        timer = win.setTimeout(() => { timer = undefined; area.dataset.arkmeScrollVisible = 'false' }, 1000)
      }
      const scroll = () => { schedule(); reveal(); hideLater() }
      const enter = () => { hovering = true; reveal() }
      const leave = () => { hovering = false; hideLater() }
      const down = (event: PointerEvent) => {
        if (event.button !== 0 || geometry().range <= 0) return
        event.preventDefault()
        event.stopPropagation()
        drag = { id: event.pointerId, y: event.clientY, scrollTop: viewport.scrollTop }
        thumb.setPointerCapture(event.pointerId)
        area.dataset.arkmeScrollDragging = 'true'
        reveal()
      }
      const move = (event: PointerEvent) => {
        if (drag === undefined || drag.id !== event.pointerId) return
        const g = geometry()
        if (g.travel <= 0) return
        viewport.scrollTop = Math.min(g.range, Math.max(0, drag.scrollTop + (event.clientY - drag.y) * g.range / g.travel))
        schedule()
      }
      const end = (event: PointerEvent) => {
        if (drag?.id !== event.pointerId) return
        drag = undefined
        delete area.dataset.arkmeScrollDragging
        if (thumb.hasPointerCapture(event.pointerId)) thumb.releasePointerCapture(event.pointerId)
        hideLater()
      }
      const key = (event: KeyboardEvent) => {
        const g = geometry()
        let target: number
        switch (event.key) {
          case 'ArrowDown': target = viewport.scrollTop + 40; break
          case 'ArrowUp': target = viewport.scrollTop - 40; break
          case 'PageDown': target = viewport.scrollTop + viewport.clientHeight; break
          case 'PageUp': target = viewport.scrollTop - viewport.clientHeight; break
          case 'End': target = g.range; break
          case 'Home': target = 0; break
          default: return
        }
        event.preventDefault()
        event.stopPropagation()
        viewport.scrollTop = Math.min(g.range, Math.max(0, target))
        scroll()
      }
      const wheel = (event: WheelEvent) => {
        if (event.deltaY === 0) return
        event.preventDefault()
        const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1
        viewport.scrollTop = Math.min(geometry().range, Math.max(0, viewport.scrollTop + event.deltaY * scale))
        scroll()
      }
      const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(schedule)
      observer?.observe(viewport)
      observer?.observe(content)
      viewport.addEventListener('scroll', scroll, { passive: true })
      area.addEventListener('pointerenter', enter)
      area.addEventListener('pointerleave', leave)
      thumb.addEventListener('pointerdown', down)
      thumb.addEventListener('pointermove', move)
      thumb.addEventListener('pointerup', end)
      thumb.addEventListener('pointercancel', end)
      thumb.addEventListener('lostpointercapture', end)
      thumb.addEventListener('keydown', key)
      thumb.addEventListener('wheel', wheel, { passive: false })
      thumb.addEventListener('focus', reveal)
      thumb.addEventListener('blur', hideLater)
      win.addEventListener('resize', schedule)
      update()
      return () => {
        observer?.disconnect()
        clearTimer()
        if (frame !== undefined) win.cancelAnimationFrame(frame)
        viewport.removeEventListener('scroll', scroll)
        area.removeEventListener('pointerenter', enter)
        area.removeEventListener('pointerleave', leave)
        thumb.removeEventListener('pointerdown', down)
        thumb.removeEventListener('pointermove', move)
        thumb.removeEventListener('pointerup', end)
        thumb.removeEventListener('pointercancel', end)
        thumb.removeEventListener('lostpointercapture', end)
        thumb.removeEventListener('keydown', key)
        thumb.removeEventListener('wheel', wheel)
        thumb.removeEventListener('focus', reveal)
        thumb.removeEventListener('blur', hideLater)
        win.removeEventListener('resize', schedule)
      }
    }, [])

    return <div ref={areaRef} data-arkme-overlay-scroll-area data-arkme-scroll-visible="false"
      style={{ position: 'relative', flex: 1, minHeight: 0, minWidth: 0, overflow: 'hidden' }}>
      <div {...props} id={viewportId} ref={viewportRef} data-arkme-overlay-scroll-viewport
        style={{ ...props.style, width: '100%', height: '100%', boxSizing: 'border-box', overflowY: 'auto', overflowX: 'hidden', scrollbarWidth: 'none' }}>
        <div ref={contentRef} role="none" style={{ display: 'flow-root', minWidth: 0 }}>{children}</div>
      </div>
      <div ref={thumbRef} hidden data-arkme-overlay-scroll-thumb role="scrollbar" tabIndex={0}
        aria-label={`${props['aria-label'] ?? '列表'}滚动条`} aria-controls={viewportId}
        aria-orientation="vertical" aria-valuemin={0} aria-valuemax={0} aria-valuenow={0} />
    </div>
  },
)
