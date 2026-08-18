import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import type { ArkmeAuthSnapshot } from '../types.js'
import { callArkme } from './api.js'
import { ArkmeFooterAction, type ArkmeFooterActionProps } from './ArkmeFooterAction.js'
import { ArkmeNavigation } from './ArkmeVirtualWorkspace.js'
import { arkmeUi } from './ui-controller.js'

const styles: Record<string, CSSProperties> = {
  root: { width: '100%', minWidth: 0, display: 'flex', flexDirection: 'column' },
  panel: {
    width: '100%', height: 'min(44vh, 420px)', minHeight: 0, maxHeight: 'calc(100vh - 220px)', margin: '6px 0 2px',
    boxSizing: 'border-box', overflow: 'hidden', border: '1px solid var(--dsw-alias-border-l1, #e2e5e9)',
    borderRadius: 12, background: 'var(--dsw-specific-sidebar-fill, #f7f8fa)',
  },
}

/** Footer action plus an inline Arkme directory that participates in sidebar layout. */
export function ArkmeFooterDropdown(props: ArkmeFooterActionProps) {
  const ui = useSyncExternalStore(arkmeUi.subscribe, arkmeUi.getSnapshot)
  const currentSession = props.useSessions(state => state.current)
  const [auth, setAuth] = useState<ArkmeAuthSnapshot>()
  const [authChecked, setAuthChecked] = useState(false)
  const hasOpened = useRef(false)
  const rootRef = useRef<HTMLDivElement>(null)
  if (ui.open) hasOpened.current = true
  useLayoutEffect(() => {
    const slot = rootRef.current?.parentElement
    if (slot?.getAttribute('data-slot') !== 'sidebar.footer.action') return
    const previous = {
      display: slot.style.display,
      flexDirection: slot.style.flexDirection,
      alignItems: slot.style.alignItems,
      width: slot.style.width,
      minWidth: slot.style.minWidth,
    }
    slot.style.display = 'flex'
    slot.style.flexDirection = 'column'
    slot.style.alignItems = 'stretch'
    slot.style.width = '100%'
    slot.style.minWidth = '0'
    return () => { Object.assign(slot.style, previous) }
  }, [])
  useEffect(() => {
    let cancelled = false
    setAuthChecked(false)
    void callArkme<ArkmeAuthSnapshot>('auth.status')
      .then(snapshot => { if (!cancelled) { setAuth(snapshot); setAuthChecked(true) } })
      .catch(() => { if (!cancelled) { setAuth(undefined); setAuthChecked(true) } })
    return () => { cancelled = true }
  }, [ui.authRevision])
  return <div ref={rootRef} style={{ ...styles.root, width: props.wide ? '100%' : 36 }}>
    {hasOpened.current && <div
      id="arkme-footer-directory" role="region" aria-label="Arkme 下拉列表"
      hidden={!props.wide || !ui.open}
      style={{ ...styles.panel, display: props.wide && ui.open ? 'block' : 'none' }}
    >
      <ArkmeNavigation onActivateSurface={() => { props.activate(currentSession) }} />
    </div>}
    <ArkmeFooterAction
      {...props}
      expanded={ui.open}
      loggedOut={authChecked && auth !== undefined && auth.status !== 'authenticated'}
      authenticated={auth?.status === 'authenticated'}
      authPending={!authChecked}
    />
  </div>
}
