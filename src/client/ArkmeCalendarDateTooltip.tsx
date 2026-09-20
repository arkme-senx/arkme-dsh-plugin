import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { arkmeTheme } from './arkme-theme.js'

/** Native title hints have a browser-controlled delay; date details must appear immediately. */
export function ArkmeCalendarDateTooltip({ anchor, id, text, onClose }: {
  anchor: HTMLButtonElement
  id: string
  text: string
  onClose(): void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: 0, top: 0 })
  const owner = anchor.ownerDocument
  useLayoutEffect(() => {
    const view = owner.defaultView
    const tip = ref.current
    if (!view || !tip || !anchor.isConnected) return
    const bounds = anchor.getBoundingClientRect()
    const size = tip.getBoundingClientRect()
    const padding = 8, gap = 6
    const left = Math.max(padding, Math.min(bounds.left + (bounds.width - size.width) / 2,
      view.innerWidth - size.width - padding))
    const below = bounds.bottom + gap
    const top = Math.max(padding, below + size.height <= view.innerHeight - padding
      ? below : bounds.top - size.height - gap)
    setPosition({ left, top })
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    // Capture nested calendar scrolling as well as page scrolling, without a lingering hint.
    owner.addEventListener('scroll', onClose, true)
    owner.addEventListener('keydown', onKeyDown)
    view.addEventListener('resize', onClose)
    view.addEventListener('blur', onClose)
    return () => {
      owner.removeEventListener('scroll', onClose, true)
      owner.removeEventListener('keydown', onKeyDown)
      view.removeEventListener('resize', onClose)
      view.removeEventListener('blur', onClose)
    }
  }, [anchor, owner, text, onClose])

  return createPortal(<div ref={ref} id={id} role="tooltip" data-arkme-calendar-tooltip="true" style={{
    position: 'fixed', ...position, zIndex: 10000, pointerEvents: 'none',
    boxSizing: 'border-box', maxWidth: 'calc(100vw - 16px)', padding: '6px 10px',
    border: `1px solid ${arkmeTheme.border}`, borderRadius: 8,
    background: arkmeTheme.menu, color: arkmeTheme.text, boxShadow: arkmeTheme.shadow,
    fontSize: 12, lineHeight: '18px', fontWeight: 400, overflowWrap: 'anywhere',
  }}>{text}</div>, owner.body)
}
