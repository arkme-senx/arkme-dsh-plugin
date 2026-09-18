import type { CSSProperties, ReactNode, Ref } from 'react'
import { ArrowLeft } from '@phosphor-icons/react/dist/icons/ArrowLeft'
import { X } from '@phosphor-icons/react/dist/icons/X'
import { arkmeTheme } from './arkme-theme.js'

const styles: Record<string, CSSProperties> = {
  header: { flex: 'none', display: 'flex', alignItems: 'flex-start', gap: 10, padding: '22px 20px 0 22px' },
  heading: { flex: 1, minWidth: 0 },
  title: { margin: 0, color: arkmeTheme.text, textAlign: 'left', fontSize: 16, lineHeight: '24px', fontWeight: 600, overflowWrap: 'anywhere' },
  subtitle: { marginTop: 8, color: arkmeTheme.tertiary, fontSize: 12, lineHeight: '18px' },
  actions: { flex: 'none', display: 'flex', alignItems: 'flex-start', gap: 6 },
  button: { width: 30, height: 30, marginTop: -3, flex: 'none', display: 'grid', placeItems: 'center', padding: 0,
    border: 0, borderRadius: 8, background: 'transparent', color: arkmeTheme.tertiary, cursor: 'pointer' },
}

/** Shared geometry for right-side drawers; each panel retains its own navigation and body. */
export function ArkmeRightPanelHeader({ title, titleId, subtitle, actions, onClose, closeLabel = '关闭详情', closeRef,
  closeDisabled = false, onBack, backLabel = '返回', backRef, backDisabled = false }: {
  title: ReactNode
  titleId?: string | undefined
  subtitle?: ReactNode
  actions?: ReactNode
  onClose: () => void
  closeLabel?: string
  closeRef?: Ref<HTMLButtonElement> | undefined
  closeDisabled?: boolean
  onBack?: (() => void) | undefined
  backLabel?: string | undefined
  backRef?: Ref<HTMLButtonElement> | undefined
  backDisabled?: boolean
}) {
  return <header style={styles.header} data-arkme-right-panel-header>
    <style>{`.arkme-right-panel-header-button:not(:disabled):hover { background: ${arkmeTheme.hover} !important; }
      .arkme-right-panel-header-button:focus-visible { outline: 2px solid ${arkmeTheme.accent}; outline-offset: 2px; }
      .arkme-right-panel-header-button:disabled { opacity: .45; cursor: default !important; }`}</style>
    {onBack !== undefined && <button ref={backRef} type="button" className="arkme-right-panel-header-button" style={styles.button}
      aria-label={backLabel} disabled={backDisabled} onClick={onBack}><ArrowLeft size={18} aria-hidden /></button>}
    <div style={styles.heading}>
      <h3 id={titleId} style={styles.title}>{title}</h3>
      {subtitle !== undefined && subtitle !== null && subtitle !== '' && <div style={styles.subtitle}>{subtitle}</div>}
    </div>
    {actions !== undefined && <div style={styles.actions}>{actions}</div>}
    <button ref={closeRef} type="button" className="arkme-right-panel-header-button" style={styles.button}
      aria-label={closeLabel} title="关闭" disabled={closeDisabled} onClick={onClose}><X size={18} aria-hidden /></button>
  </header>
}
