import { useRef, useSyncExternalStore, type CSSProperties } from 'react'
import { JotmoFooterAction, type JotmoFooterActionProps } from './JotmoFooterAction.js'
import { JotmoNavigation } from './JotmoVirtualWorkspace.js'
import { jotmoUi } from './ui-controller.js'

const styles: Record<string, CSSProperties> = {
  root: { width: '100%', minWidth: 0, display: 'flex', flexDirection: 'column' },
  panel: {
    width: '100%', height: 'min(44vh, 420px)', minHeight: 220, margin: '2px 0 6px',
    boxSizing: 'border-box', overflow: 'hidden', border: '1px solid var(--dsw-alias-border-l1, #e2e5e9)',
    borderRadius: 12, background: 'var(--dsw-specific-sidebar-fill, #f7f8fa)',
  },
}

/** Footer action plus an inline Jiwo directory that participates in sidebar layout. */
export function JotmoFooterDropdown(props: JotmoFooterActionProps) {
  const ui = useSyncExternalStore(jotmoUi.subscribe, jotmoUi.getSnapshot)
  const hasOpened = useRef(false)
  if (ui.open) hasOpened.current = true
  return <div style={{ ...styles.root, width: props.wide ? '100%' : 36 }}>
    <JotmoFooterAction {...props} expanded={ui.open} />
    {hasOpened.current && <div
      id="jotmo-footer-directory" role="region" aria-label="即我下拉列表"
      hidden={!props.wide || !ui.open}
      style={{ ...styles.panel, display: props.wide && ui.open ? 'block' : 'none' }}
    >
      <JotmoNavigation />
    </div>}
  </div>
}
