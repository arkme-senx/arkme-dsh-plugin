import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import type { JotmoAuthSnapshot } from '../types.js'
import { callJotmo } from './api.js'
import { JotmoFooterAction, type JotmoFooterActionProps } from './JotmoFooterAction.js'
import { JotmoNavigation } from './JotmoVirtualWorkspace.js'
import { JotmoOutgoingCallHost } from './JotmoOutgoingCallHost.js'
import { jotmoUi } from './ui-controller.js'

const styles: Record<string, CSSProperties> = {
  root: { width: '100%', minWidth: 0, display: 'flex', flexDirection: 'column' },
  panel: {
    width: '100%', height: 'min(44vh, 420px)', minHeight: 0, maxHeight: 'calc(100vh - 220px)', margin: '6px 0 2px',
    boxSizing: 'border-box', overflow: 'hidden', border: '1px solid var(--dsw-alias-border-l1, #e2e5e9)',
    borderRadius: 12, background: 'var(--dsw-specific-sidebar-fill, #f7f8fa)',
  },
}

/** Footer action plus an inline Jiwo directory that participates in sidebar layout. */
export function JotmoFooterDropdown(props: JotmoFooterActionProps) {
  const ui = useSyncExternalStore(jotmoUi.subscribe, jotmoUi.getSnapshot)
  const currentSession = props.useSessions(state => state.current)
  const [auth, setAuth] = useState<JotmoAuthSnapshot>()
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
    void callJotmo<JotmoAuthSnapshot>('auth.status')
      .then(snapshot => { if (!cancelled) { setAuth(snapshot); setAuthChecked(true) } })
      .catch(() => { if (!cancelled) { setAuth(undefined); setAuthChecked(true) } })
    return () => { cancelled = true }
  }, [ui.authRevision])
  return <div ref={rootRef} style={{ ...styles.root, width: props.wide ? '100%' : 36 }}>
    <JotmoOutgoingCallHost />
    {hasOpened.current && <div
      id="jotmo-footer-directory" role="region" aria-label="即我下拉列表"
      hidden={!props.wide || !ui.open}
      style={{ ...styles.panel, display: props.wide && ui.open ? 'block' : 'none' }}
    >
      <JotmoNavigation onActivateSurface={() => { props.activate(currentSession) }} />
    </div>}
    <JotmoFooterAction
      {...props}
      expanded={ui.open}
      loggedOut={authChecked && auth !== undefined && auth.status !== 'authenticated'}
      authenticated={auth?.status === 'authenticated'}
      authPending={!authChecked}
    />
  </div>
}
