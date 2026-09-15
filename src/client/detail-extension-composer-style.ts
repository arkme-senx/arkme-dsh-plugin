import type { CSSProperties } from 'react'
import { arkmeTheme } from './arkme-theme.js'

export const arkmeDetailExtensionComposerStyles = {
  bar: { position: 'relative', padding: '12px 16px', borderTop: '0.5px solid #e6e6e6' },
  shell: {
    minHeight: 44, maxHeight: 100, display: 'flex', alignItems: 'flex-end', gap: 8,
    padding: '8px 8px 8px 12px', boxSizing: 'border-box', border: 0, borderRadius: 12, background: '#f6f6f6',
  },
  input: {
    flex: 1, minWidth: 0, minHeight: 28, maxHeight: 84, boxSizing: 'border-box', fieldSizing: 'content',
    overflowY: 'auto', resize: 'none', border: 0, outline: 0, padding: '4px 0', background: 'transparent',
    color: arkmeTheme.text, font: 'inherit', fontSize: 14, lineHeight: '20px',
  },
} satisfies Record<string, CSSProperties>
