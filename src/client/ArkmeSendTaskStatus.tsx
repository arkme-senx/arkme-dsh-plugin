import type { ReactNode } from 'react'
import { arkmeTheme } from './arkme-theme.js'
export function ArkmeSendTaskStatus({ state, own, label, children }: { state: string; own: boolean; label: string; children: ReactNode }) {
  return <div role="status" aria-label={label} data-arkme-file-send-status={state}
    style={{ fontSize: 12, lineHeight: 1.5, color: arkmeTheme.secondary, maxWidth: '100%', overflowWrap: 'anywhere', textAlign: own ? 'right' : 'left' }}>{children}</div>
}
