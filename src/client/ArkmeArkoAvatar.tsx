import type { CSSProperties } from 'react'

export function ArkmeArkoAvatar({ size = 44 }: { size?: number }) {
  const iconSize = size * 0.68
  const surface: CSSProperties = {
    width: size,
    height: size,
    display: 'grid',
    placeItems: 'center',
    flex: 'none',
    borderRadius: 999,
    background: 'var(--dsw-alias-fill-secondary, #f3f4f5)',
  }
  return <span style={surface} aria-hidden>
    <svg width={iconSize} height={iconSize} viewBox="2 1.4 12 12" fill="none">
      <path d="M3.25 6.72C3.25 5.67 3.67 4.78 4.38 4.18L4.25 2.7C4.22 2.4 4.57 2.22 4.82 2.42L6.2 3.5C6.76 3.33 7.37 3.24 8 3.24C8.63 3.24 9.24 3.33 9.8 3.5L11.18 2.42C11.43 2.22 11.78 2.4 11.75 2.7L11.62 4.18C12.33 4.78 12.75 5.67 12.75 6.72V8.78C12.75 11.11 10.63 12.76 8 12.76C5.37 12.76 3.25 11.11 3.25 8.78V6.72Z" fill="#FFFDF4" stroke="#252525" strokeWidth="0.7" strokeLinejoin="round" />
      <path d="M4.38 4.18L4.25 2.7C4.22 2.4 4.57 2.22 4.82 2.42L6.2 3.5C6.55 3.4 6.93 3.32 7.32 3.28C7.26 4.12 7.28 4.79 7.16 5.42C7.04 6.1 6.84 6.65 6.68 7.18C6.5 7.78 6.13 8.19 5.57 8.35C4.75 8.58 3.9 8.23 3.26 7.67V6.72C3.26 5.67 3.67 4.78 4.38 4.18Z" fill="#252525" />
      <path d="M8.68 3.28C9.07 3.32 9.45 3.4 9.8 3.5L11.18 2.42C11.43 2.22 11.78 2.4 11.75 2.7L11.62 4.18C12.33 4.78 12.74 5.67 12.74 6.72V7.84C12.12 8.38 11.29 8.63 10.51 8.34C9.9 8.11 9.5 7.66 9.34 7.08C9.19 6.54 8.97 5.99 8.84 5.34C8.72 4.72 8.74 4.08 8.68 3.28Z" fill="#252525" />
      <ellipse cx="5.92" cy="6.76" rx="0.66" ry="0.72" fill="#FFFDF4" />
      <ellipse cx="10.08" cy="6.76" rx="0.66" ry="0.72" fill="#FFFDF4" />
      <ellipse cx="5.98" cy="6.7" rx="0.32" ry="0.43" fill="#252525" />
      <ellipse cx="10.14" cy="6.7" rx="0.32" ry="0.43" fill="#252525" />
      <circle cx="5.86" cy="6.46" r="0.14" fill="#FFFDF4" />
      <circle cx="10.02" cy="6.46" r="0.14" fill="#FFFDF4" />
      <path d="M7.58 8.24C7.8 8.09 8.2 8.09 8.42 8.24C8.54 8.32 8.51 8.49 8.38 8.56L8 8.75L7.62 8.56C7.49 8.49 7.46 8.32 7.58 8.24Z" fill="#EFA7A2" />
      <path d="M8 8.76V8.92M8 8.92C7.83 9.1 7.55 9.08 7.34 8.9M8 8.92C8.17 9.1 8.45 9.08 8.66 8.9" stroke="#252525" strokeWidth="0.44" strokeLinecap="round" />
    </svg>
  </span>
}
