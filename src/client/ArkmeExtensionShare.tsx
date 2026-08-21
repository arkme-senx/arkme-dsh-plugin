import type { CSSProperties } from 'react'
import type { ArkmeExtensionSource } from '../extensions/types.js'

export function ArkmeExtensionShareDialog({ url, notice, onClose, onCopy }: {
  url: string
  notice?: string
  onClose(): void
  onCopy(): void
}) {
  return <div style={styles.backdrop} onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section style={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="arkme-extension-share-title">
      <header style={styles.header}>
        <h3 id="arkme-extension-share-title" style={styles.title}>分享扩展</h3>
        <button type="button" style={styles.close} aria-label="关闭分享弹窗" onClick={onClose}>×</button>
      </header>
      <div style={styles.label}>网页链接</div>
      <div style={styles.linkRow}>
        <input
          readOnly
          aria-label="分享网页链接"
          style={styles.input}
          value={url}
          onFocus={event => { event.currentTarget.select() }}
        />
        <button type="button" style={styles.copy} onClick={onCopy}>复制</button>
      </div>
      {notice !== undefined && notice !== '' && <div role="status" style={styles.notice}>{notice}</div>}
    </section>
  </div>
}

export function ArkmeExtensionSourceLink({ source }: { source: ArkmeExtensionSource }) {
  return <a href={source.url} target="_blank" rel="noopener noreferrer nofollow" style={styles.sourceLink}>
    {source.label}
  </a>
}

const styles: Record<string, CSSProperties> = {
  backdrop: {
    position: 'absolute', zIndex: 6, inset: 0, display: 'grid', placeItems: 'center', padding: 24,
    boxSizing: 'border-box', background: 'var(--dsw-alias-bg-mask-1, rgba(17, 24, 39, .24))',
  },
  dialog: {
    width: 'min(440px, 100%)', padding: 20, boxSizing: 'border-box', borderRadius: 14,
    border: '1px solid var(--dsw-alias-border-l1, #e7e9ec)',
    background: 'var(--dsw-specific-sidebar-fill, #fff)',
    color: 'var(--dsw-alias-label-primary, #17191c)', boxShadow: '0 18px 50px rgba(20,24,31,.20)',
  },
  header: { display: 'flex', alignItems: 'center', gap: 12 },
  title: { flex: 1, margin: 0, fontSize: 16, lineHeight: '24px', fontWeight: 600 },
  close: {
    width: 30, height: 30, display: 'grid', placeItems: 'center', padding: 0, border: 0,
    borderRadius: 8, background: 'transparent', color: 'inherit', fontSize: 21, lineHeight: '21px', cursor: 'pointer',
  },
  label: { marginTop: 16, color: 'var(--dsw-alias-label-secondary, #717780)', fontSize: 12, lineHeight: '18px' },
  linkRow: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 8, marginTop: 7 },
  input: {
    minWidth: 0, height: 36, padding: '0 10px', boxSizing: 'border-box',
    border: '1px solid var(--dsw-alias-border-l1, #e7e9ec)', borderRadius: 8,
    background: 'transparent', color: 'inherit', font: 'inherit', fontSize: 12,
  },
  copy: {
    height: 36, padding: '0 16px', border: 0, borderRadius: 8,
    background: 'var(--dsw-alias-label-primary, #292929)', color: '#fff', font: 'inherit', fontSize: 12,
    fontWeight: 600, cursor: 'pointer',
  },
  notice: { marginTop: 10, color: 'var(--dsw-alias-state-business-primary, #8295e8)', fontSize: 11, lineHeight: '17px' },
  sourceLink: {
    color: 'var(--dsw-alias-state-business-primary, #8295e8)', fontSize: 12, lineHeight: '18px',
    fontWeight: 600, textDecoration: 'none', wordBreak: 'break-word',
  },
}
