import type { CSSProperties } from 'react'
import { arkmeTheme } from './arkme-theme.js'

export const ARKME_READ_RECEIPT_ICON_SIZE = 12

// Keep inline @ badges and message-side receipts visually identical in both themes.
export function ArkmeReadReceiptIcon({ checked, style }: { checked?: boolean; style?: CSSProperties | undefined }) {
  return <svg width={ARKME_READ_RECEIPT_ICON_SIZE} height={ARKME_READ_RECEIPT_ICON_SIZE}
    viewBox="0 0 12 12" fill="none" aria-hidden
    style={{ display: 'block', width: ARKME_READ_RECEIPT_ICON_SIZE, height: ARKME_READ_RECEIPT_ICON_SIZE,
      color: arkmeTheme.text, opacity: 0.16, flex: 'none', ...style }}>
    <circle cx="6" cy="6" r="5.4" stroke="currentColor" strokeWidth="1.2" />
    {checked === true && <path
      d="M5.17 7.15 8.37 4.1a.37.37 0 0 1 .52.5L5.43 7.9a.37.37 0 0 1-.52 0L3.1 6.18a.35.35 0 0 1 .52-.5l1.54 1.47Z"
      fill="currentColor"
    />}
  </svg>
}
