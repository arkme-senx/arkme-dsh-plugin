import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { arkmeTheme } from './arkme-theme.js'

/** Keep compact text hints outside clipping containers and inside native modal layers. */
export function ArkmeTextTooltip({ anchor, id, text, onClose, kind }: {
  anchor: HTMLElement
  id: string
  text: string
  kind: 'attachment' | 'membership'
  onClose(): void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: 0, top: 0 })
  const owner = anchor.ownerDocument
  useLayoutEffect(() => {
    const view = owner.defaultView, tip = ref.current
    if (!view || !tip || !anchor.isConnected) return
    const box = anchor.getBoundingClientRect(), size = tip.getBoundingClientRect()
    const padding = 8, gap = 6
    setPosition({
      left: Math.max(padding, Math.min(box.left + (box.width - size.width) / 2, view.innerWidth - size.width - padding)),
      top: Math.max(padding, box.top - size.height - gap >= padding
        ? box.top - size.height - gap : Math.min(box.bottom + gap, view.innerHeight - size.height - padding)),
    })
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    owner.addEventListener('scroll', onClose, true)
    owner.addEventListener('dragstart', onClose, true)
    owner.addEventListener('keydown', onKeyDown)
    view.addEventListener('resize', onClose)
    view.addEventListener('blur', onClose)
    return () => {
      owner.removeEventListener('scroll', onClose, true)
      owner.removeEventListener('dragstart', onClose, true)
      owner.removeEventListener('keydown', onKeyDown)
      view.removeEventListener('resize', onClose)
      view.removeEventListener('blur', onClose)
    }
  }, [anchor, owner, text, onClose])
  // A modal's top layer must also contain its own tooltip.
  const portalRoot = anchor.closest('dialog') ?? owner.body
  return createPortal(<div ref={ref} id={id} role="tooltip" data-arkme-attachment-tooltip={kind === 'attachment' ? '' : undefined} data-arkme-membership-tooltip={kind === 'membership' ? '' : undefined} style={{
    position: 'fixed', ...position, zIndex: 10000, pointerEvents: 'none',
    boxSizing: 'border-box', maxWidth: 'min(360px, calc(100vw - 16px))', padding: '6px 10px',
    border: `1px solid ${arkmeTheme.border}`, borderRadius: 8,
    background: arkmeTheme.menu, color: arkmeTheme.text, boxShadow: arkmeTheme.shadow,
    fontSize: 12, lineHeight: '18px', fontWeight: 400, overflowWrap: 'anywhere', whiteSpace: 'normal',
  }}>{text}</div>, portalRoot)
}
