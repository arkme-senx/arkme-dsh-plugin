import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { outgoingCallUi } from './outgoing-call-ui-controller.js'
import { arkmeTheme } from './arkme-theme.js'

export interface ArkmePrivateCallMenuProps {
  sourceRef: string
  displayName: string
  assetBasePath?: string
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
    position: 'absolute', zIndex: 20, top: 32, left: 0, width: 132, padding: 4, margin: 0,
    listStyle: 'none', border: '1px solid var(--dsw-alias-border-l1, #e2e5e9)', borderRadius: 12,
    background: 'var(--dsw-alias-bg-base, #fff)', boxShadow: '0 8px 24px rgba(20,25,32,.14)',
  },
  item: {
    width: '100%', height: 32, padding: '0 9px', display: 'flex', alignItems: 'center', gap: 8,
    border: 0, borderRadius: 8, background: 'transparent', color: 'var(--dsw-alias-label-primary, #17191c)',
    cursor: 'pointer', font: 'inherit', fontSize: 13, fontWeight: 500, textAlign: 'left',
  },
  rowIcon: { width: 18, height: 18, display: 'block', color: 'currentColor' },
}

function MicrophoneIcon() {
  return <svg aria-hidden viewBox="0 0 24 24" fill="none" style={styles.rowIcon}>
    <path d="M9 6a3 3 0 0 1 6 0v6a3 3 0 0 1-6 0V6Z" stroke="currentColor" strokeWidth="1.8" />
    <path d="M6.5 11.5a5.5 5.5 0 0 0 11 0M12 17v3M9 20h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
}

function VideoIcon() {
  return <svg aria-hidden viewBox="0 0 24 24" fill="none" style={styles.rowIcon}>
    <rect x="3.5" y="6" width="11.5" height="12" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
    <path d="m15 10 4.3-2.2a.8.8 0 0 1 1.2.7v7a.8.8 0 0 1-1.2.7L15 14" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
  </svg>
}

export function ArkmePrivateCallMenu({
  sourceRef,
  displayName,
  assetBasePath = '/arkme-self/api/call',
}: ArkmePrivateCallMenuProps) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => {
      if (event.target instanceof Node && root.current?.contains(event.target) !== true) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  const start = (mediaType: 'audio' | 'video') => {
    setOpen(false)
    outgoingCallUi.request({ sourceRef, displayName, mediaType })
  }
  const callIconUrl = `${assetBasePath}/call-linear-strong.svg`

  return <div ref={root} style={styles.root}>
    <button
      type="button"
      aria-label={`呼叫${displayName}`}
      aria-haspopup="menu"
      aria-expanded={open}
      title="发起通话"
      style={styles.trigger}
      onClick={() => { setOpen(value => !value) }}
    >
      <span aria-hidden style={{
        ...styles.triggerIcon,
        maskImage: `url("${callIconUrl}")`, WebkitMaskImage: `url("${callIconUrl}")`,
      }} />
    </button>
    {open && <ul role="menu" aria-label="选择通话方式" style={styles.menu}>
      <li role="none"><button type="button" role="menuitem" style={styles.item} onClick={() => { start('audio') }}>
        <MicrophoneIcon />语音通话
      </button></li>
      <li role="none"><button type="button" role="menuitem" style={styles.item} onClick={() => { start('video') }}>
        <VideoIcon />视频通话
      </button></li>
    </ul>}
  </div>
}
