import type { CSSProperties } from 'react'

const clipStyle: CSSProperties = {
  position: 'absolute', inset: 0, borderRadius: 'inherit', overflow: 'hidden', pointerEvents: 'none',
}
const cornerStyle: CSSProperties = {
  position: 'absolute', top: 0, right: 0, width: 16, height: 16,
  background: '#65ce8b', clipPath: 'polygon(0 0, 100% 0, 100% 100%)',
}

export function ArkmePinnedCorner() {
  return <span role="img" aria-label="已置顶" style={clipStyle}>
    <span aria-hidden style={cornerStyle} />
  </span>
}
