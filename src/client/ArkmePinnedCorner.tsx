import { tr } from './locale.js'
import type { CSSProperties } from 'react'

const clipStyle: CSSProperties = {
  // Independent of the card's larger background radius, so the small pin stays
  // visible at its original top-left position instead of being clipped away.
  position: 'absolute', inset: 0, borderRadius: 4, overflow: 'hidden', pointerEvents: 'none',
}
const cornerStyle: CSSProperties = {
  position: 'absolute', top: 0, left: 0, display: 'block',
  width: 10, height: 9, fill: 'var(--arkme-directory-accent)',
}

export function ArkmePinnedCorner() {
  return <span role="img" aria-label={tr("已置顶")} style={clipStyle}>
    {/* A concave circular edge echoes the 38px avatar. Ending at 9px keeps
        the corner above the centered 33px selection marker in a 58px row. */}
    <svg aria-hidden focusable="false" viewBox="0 0 10 9" style={cornerStyle}>
      <path d="M0 0H10A19 19 0 0 0 0 9Z" />
    </svg>
  </span>
}
