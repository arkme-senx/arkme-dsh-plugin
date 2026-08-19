/** A compact app-grid mark for the extension catalog and installed capabilities. */
export function ArkmeExtensionIcon({ size = 20 }: { size?: number }) {
  return <svg aria-hidden width={size} height={size} viewBox="0 0 24 24" fill="none">
    <rect x="3.5" y="3.5" width="6.5" height="6.5" rx="2" stroke="currentColor" strokeWidth="1.5" />
    <rect x="14" y="3.5" width="6.5" height="6.5" rx="2" stroke="currentColor" strokeWidth="1.5" />
    <rect x="3.5" y="14" width="6.5" height="6.5" rx="2" stroke="currentColor" strokeWidth="1.5" />
    <path d="M17.25 14v6.5M14 17.25h6.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
}
