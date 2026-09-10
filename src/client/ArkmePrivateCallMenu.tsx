import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { outgoingCallUi } from './outgoing-call-ui-controller.js'
import { arkmeTheme } from './arkme-theme.js'

export interface ArkmePrivateCallMenuProps {
  sourceRef: string
  displayName: string
  assetBasePath?: string
}

const MENU_WIDTH = 148
const MENU_HEIGHT = 74
const MENU_GAP = 8
const VIEWPORT_MARGIN = 8
const MENU_TRANSFORM_ORIGIN_INSET = 14

export const arkmePrivateCallMenuMotionCss = `
/* Flutter popup_menu.dart: 300ms, unit = 1 / (2 + 1.5). */
@keyframes arkme-private-call-menu-width {
  from { width: 0; }
  to { width: 148px; }
}
@keyframes arkme-private-call-menu-height {
  from { height: 0; }
  to { height: 74px; }
}
@keyframes arkme-private-call-menu-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}
.arkme-private-call-menu::before {
  content: '';
  position: absolute;
  top: 0;
  right: 0;
  box-sizing: border-box;
  border: 1px solid var(--dsw-alias-border-l1, #e2e5e9);
  border-radius: 12px;
  background: var(--dsw-alias-bg-base, #fff);
  box-shadow: 0 8px 24px rgba(20,25,32,.14);
  pointer-events: none;
  animation: arkme-private-call-menu-width 85.714286ms linear both,
    arkme-private-call-menu-height 171.428571ms linear both,
    arkme-private-call-menu-fade 100ms linear both;
}
.arkme-private-call-menu > li {
  position: relative;
  animation: arkme-private-call-menu-fade 128.571429ms linear both;
}
.arkme-private-call-menu > li:nth-child(1) {
  animation-delay: 85.714286ms;
}
.arkme-private-call-menu > li:nth-child(2) {
  animation-delay: 171.428571ms;
}
@media (prefers-reduced-motion: reduce) {
  .arkme-private-call-menu::before,
  .arkme-private-call-menu > li {
    animation: none;
    opacity: 1;
  }
  .arkme-private-call-menu::before {
    width: 148px;
    height: 74px;
  }
}
`

export interface ArkmePrivateCallMenuViewport {
  width: number
  height: number
}

export interface ArkmePrivateCallMenuAnchorRect {
  left: number
  right: number
  top: number
  bottom: number
}

export function arkmePrivateCallMenuPlacement(
  anchor: ArkmePrivateCallMenuAnchorRect,
  viewport: ArkmePrivateCallMenuViewport,
): CSSProperties {
  const maxLeft = Math.max(VIEWPORT_MARGIN, viewport.width - MENU_WIDTH - VIEWPORT_MARGIN)
  const left = Math.max(VIEWPORT_MARGIN, Math.min(anchor.left, maxLeft))
  const anchorCenterX = (anchor.left + anchor.right) / 2
  const preferredTop = anchor.bottom + MENU_GAP
  const maxTop = Math.max(VIEWPORT_MARGIN, viewport.height - MENU_HEIGHT - VIEWPORT_MARGIN)
  const unclampedTop = preferredTop + MENU_HEIGHT <= viewport.height - VIEWPORT_MARGIN || anchor.top - MENU_GAP - MENU_HEIGHT < VIEWPORT_MARGIN
    ? preferredTop
    : anchor.top - MENU_GAP - MENU_HEIGHT
  const top = Math.max(VIEWPORT_MARGIN, Math.min(unclampedTop, maxTop))
  const originX = Math.max(
    MENU_TRANSFORM_ORIGIN_INSET,
    Math.min(anchorCenterX - left, MENU_WIDTH - MENU_TRANSFORM_ORIGIN_INSET),
  )
  const originY = top + MENU_HEIGHT <= anchor.top ? 'bottom' : 'top'
  return { position: 'fixed', left, top, width: MENU_WIDTH, transformOrigin: `${originX}px ${originY}` }
}

const styles: Record<string, CSSProperties> = {
  root: { position: 'relative', flex: 'none' },
  trigger: {
    width: 24, height: 24, padding: 2, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    border: 0, borderRadius: 6, background: 'transparent', color: arkmeTheme.secondary,
    cursor: 'pointer', appearance: 'none',
  },
  triggerIcon: {
    width: 20, height: 20, display: 'block', backgroundColor: 'currentColor',
    maskRepeat: 'no-repeat', maskPosition: 'center', maskSize: 'contain',
    WebkitMaskRepeat: 'no-repeat', WebkitMaskPosition: 'center', WebkitMaskSize: 'contain',
  },
  menu: {
    position: 'fixed', zIndex: 1700, width: MENU_WIDTH, padding: 4, margin: 0, boxSizing: 'border-box',
    listStyle: 'none', border: '1px solid transparent', borderRadius: 12,
    transformOrigin: 'top left',
  },
  itemShell: { height: 32, padding: '0 6px', boxSizing: 'border-box' },
  item: {
    width: '100%', height: '100%', padding: '0 10px', display: 'flex', alignItems: 'center', gap: 8,
    border: 0, borderRadius: 10, background: 'transparent', color: '#292D32',
    cursor: 'pointer', font: 'inherit', fontSize: 13, fontWeight: 500, textAlign: 'left',
  },
  rowIcon: {
    width: 18, height: 18, display: 'block', flex: '0 0 18px', backgroundColor: 'currentColor',
    maskRepeat: 'no-repeat', maskPosition: 'center', maskSize: 'contain',
    WebkitMaskRepeat: 'no-repeat', WebkitMaskPosition: 'center', WebkitMaskSize: 'contain',
  },
}

function MenuAssetIcon({ assetBasePath, iconAsset }: { assetBasePath: string; iconAsset: string }) {
  const iconUrl = `${assetBasePath}/${iconAsset}`
  return <span
    aria-hidden
    data-arkme-private-call-menu-icon={iconAsset}
    style={{
      ...styles.rowIcon,
      maskImage: `url("${iconUrl}")`,
      WebkitMaskImage: `url("${iconUrl}")`,
    }}
  />
}

export function ArkmePrivateCallMenu({
  sourceRef,
  displayName,
  assetBasePath = '/arkme-self/api/call',
}: ArkmePrivateCallMenuProps) {
  const [open, setOpen] = useState(false)
  const [placement, setPlacement] = useState<CSSProperties>()
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLUListElement>(null)

  const placeMenu = (anchor: ArkmePrivateCallMenuAnchorRect) => {
    const viewport = typeof window === 'undefined'
      ? { width: 1024, height: 768 }
      : { width: window.innerWidth, height: window.innerHeight }
    setPlacement(arkmePrivateCallMenuPlacement(anchor, viewport))
  }

  useEffect(() => {
    if (!open || typeof document === 'undefined') return
    const close = (event: MouseEvent) => {
      if (!(event.target instanceof Node)) return
      if (root.current?.contains(event.target) === true || menu.current?.contains(event.target) === true) return
      setOpen(false)
    }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  useEffect(() => {
    if (!open || typeof window === 'undefined') return
    const update = () => {
      const rect = button.current?.getBoundingClientRect()
      if (rect !== undefined) placeMenu(rect)
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open])

  const start = (mediaType: 'audio' | 'video') => {
    setOpen(false)
    outgoingCallUi.request({ sourceRef, displayName, mediaType })
  }
  const callIconUrl = `${assetBasePath}/call-linear-strong.svg`
  const callMenu = open && <>
    <style>{arkmePrivateCallMenuMotionCss}</style>
    <ul
      ref={menu}
      role="menu"
      aria-label="选择通话方式"
      className="arkme-private-call-menu"
      data-arkme-private-call-menu-layer="fixed"
      style={{ ...styles.menu, ...placement }}
    >
      <li role="none" style={styles.itemShell}><button type="button" role="menuitem" style={styles.item} onClick={() => { start('audio') }}>
        <MenuAssetIcon assetBasePath={assetBasePath} iconAsset="call-linear.svg" />语音通话
      </button></li>
      <li role="none" style={styles.itemShell}><button type="button" role="menuitem" style={styles.item} onClick={() => { start('video') }}>
        <MenuAssetIcon assetBasePath={assetBasePath} iconAsset="video-linear.svg" />视频通话
      </button></li>
    </ul>
  </>

  return <div ref={root} style={styles.root}>
    <button
      ref={button}
      type="button"
      aria-label={`呼叫${displayName}`}
      aria-haspopup="menu"
      aria-expanded={open}
      title="发起通话"
      style={styles.trigger}
      onClick={event => {
        if (!open) placeMenu(event.currentTarget.getBoundingClientRect())
        setOpen(value => !value)
      }}
    >
      <span aria-hidden style={{
        ...styles.triggerIcon,
        maskImage: `url("${callIconUrl}")`, WebkitMaskImage: `url("${callIconUrl}")`,
      }} />
    </button>
    {callMenu !== false && callMenu !== null && typeof document !== 'undefined' && document.body !== null
      ? createPortal(callMenu, document.body)
      : callMenu}
  </div>
}
