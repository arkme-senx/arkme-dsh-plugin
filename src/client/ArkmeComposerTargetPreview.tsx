import { useState, type CSSProperties, type ReactNode } from 'react'
import { ArkmeRichText } from './ArkmeRichText.js'
import { arkmeTheme } from './arkme-theme.js'

const styles = {
  composerExtensionTarget: {
    margin: 0, padding: 8, display: 'flex', alignItems: 'flex-start', gap: 10,
    borderRadius: '12px 12px 0 0', border: `1px solid ${arkmeTheme.border}`, borderBottom: 0,
    background: arkmeTheme.extensionSource,
    boxShadow: `inset 0 -1px 0 ${arkmeTheme.border}`,
  },
  composerExtensionTargetBody: { flex: 1, minWidth: 0 },
  composerReeditLabel: { color: arkmeTheme.warning, fontSize: 12, lineHeight: '18px' },
  composerExtensionTargetText: { overflow: 'hidden', color: arkmeTheme.tertiary, fontSize: 12, lineHeight: '18px', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  composerExtensionTargetCancel: { flex: 'none', width: 24, height: 24, padding: 0, border: 0, borderRadius: 6, background: 'transparent', color: arkmeTheme.tertiary, cursor: 'pointer', fontSize: 18, lineHeight: '22px' },
} satisfies Record<string, CSSProperties>

/** Shared composer target presentation; draft ownership remains with the caller. */
export function ArkmeComposerTargetPreview({ label, text, children, closeLabel, disabled, onClose, mode, quote = false }: {
  label?: string; text: string; children?: ReactNode; closeLabel: string; disabled?: boolean
  onClose(): void; mode: 'extension' | 'reedit'; quote?: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  return <div style={styles.composerExtensionTarget}
    {...(mode === 'reedit' ? { 'data-arkme-composer-reedit-target': 'true' } : { 'data-arkme-composer-extension-target': 'true' })}>
    <div style={styles.composerExtensionTargetBody}>
      {label && <div style={{ ...styles.composerReeditLabel, ...(quote ? { color: arkmeTheme.text } : {}) }}>{label}</div>}
      {text && <div style={{ ...styles.composerExtensionTargetText, ...(quote ? { whiteSpace: 'pre-wrap', display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: expanded ? undefined : 2 } : {}) }}>{quote ? text : <ArkmeRichText text={text} presentation="preview" />}</div>}
      {quote && (text.length > 90 || text.includes('\n')) && <button type="button" onClick={() => setExpanded(value => !value)} style={{ border: 0, padding: 0, background: 'transparent', color: arkmeTheme.tertiary, fontSize: 12, cursor: 'pointer' }}>{expanded ? '收起引用' : '展开引用'}</button>}
      {children}
    </div>
    <button data-arkme-feedback="neutral" type="button" style={styles.composerExtensionTargetCancel}
      aria-label={closeLabel} disabled={disabled} onClick={onClose}>×</button>
  </div>
}
