import { useLayoutEffect, useRef, type CSSProperties, type RefObject } from 'react'
import { attachRegionMarquee, type RegionMarqueeHandle, type RegionMarqueePort } from './region-marquee.js'

/** Render as a sibling of the viewport inside its positioned wrapper. */
export function RegionMarquee({ viewportRef, scopeKey, enabled, getItems, getStartArea, onCommit, style }: {
  viewportRef: RefObject<HTMLElement>
  scopeKey: string
  enabled: boolean
  getItems: RegionMarqueePort['getItems']
  getStartArea?: RegionMarqueePort['getStartArea']
  onCommit: RegionMarqueePort['onCommit']
  style: CSSProperties
}) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const selectionRef = useRef<HTMLDivElement>(null)
  const controller = useRef<RegionMarqueeHandle>()
  const port = useRef({ enabled, getItems, getStartArea, onCommit })
  useLayoutEffect(() => { port.current = { enabled, getItems, getStartArea, onCommit } })
  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!viewport || !overlayRef.current || !selectionRef.current) return
    const binding = attachRegionMarquee(viewport, {
      getStartArea: () => port.current.getStartArea?.(),
      canStart: () => port.current.enabled,
      getItems: () => port.current.getItems(),
      onCommit: keys => port.current.onCommit(keys),
      onRect: rect => {
        const overlay = overlayRef.current
        const selection = selectionRef.current
        if (!overlay || !selection) return
        selection.hidden = !rect
        if (!rect) return
        const origin = overlay.getBoundingClientRect()
        Object.assign(selection.style, {
          left: `${rect.left - origin.left}px`, top: `${rect.top - origin.top}px`,
          width: `${rect.width}px`, height: `${rect.height}px`,
        })
      },
    })
    controller.current = binding
    return () => { binding.dispose(); controller.current = undefined }
  }, [viewportRef])
  useLayoutEffect(() => { controller.current?.cancel() }, [enabled, scopeKey])
  return <div ref={overlayRef} aria-hidden style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 2 }}>
    <div ref={selectionRef} data-region-marquee hidden style={{ ...style, position: 'absolute', pointerEvents: 'none', boxSizing: 'border-box' }} />
  </div>
}
