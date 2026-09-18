import type { CSSProperties } from 'react'

/** Keep both persistent directory modes on the same search and action grid. */
export const directorySearchLayout = {
  toolbar: {
    position: 'relative', flex: 'none', minWidth: 0, height: 40,
    margin: '24px 16px 16px', display: 'flex', alignItems: 'center', gap: 8,
  },
  field: {
    display: 'flex', alignItems: 'center', flex: 1, minWidth: 0, height: 40,
    margin: 0, gap: 8, padding: '0 11px', boxSizing: 'border-box',
    border: '1px solid var(--dsw-alias-border-l2, #e2e3e6)', borderRadius: 11,
    background: 'var(--dsw-specific-input-major, #fff)',
    color: 'var(--dsw-alias-label-tertiary, #92959e)',
  },
  icon: { width: 16, height: 16, flex: '0 0 16px' },
  input: {
    flex: '1 1 0', minWidth: 0, width: '100%', height: 20,
    margin: 0, padding: 0, border: 0, outline: 0, boxSizing: 'border-box',
    background: 'transparent', color: 'var(--dsw-alias-label-primary, #202124)',
    fontFamily: 'inherit', fontSize: 12, fontWeight: 400, lineHeight: '20px',
  },
} satisfies Record<string, CSSProperties>
