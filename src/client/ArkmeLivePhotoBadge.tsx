/** Flutter shared/ui/media/live_mode_badge.dart geometry, shared by Live preview surfaces. */
export function ArkmeLivePhotoBadge({ variant = 'preview' }: { variant?: 'preview' | 'thumbnail' | 'extension' }) {
  const compact = variant !== 'preview'
  const size = variant === 'extension' ? 12 : compact ? 16 : 22
  const target = variant === 'extension' ? 14 : compact ? 20 : 32
  const stroke = compact ? 1.24 : 1.32
  return <span data-arkme-live-photo-badge style={{ display: 'inline-grid', placeItems: 'center', width: target, height: target, borderRadius: '50%', background: compact ? 'rgba(0,0,0,.36)' : 'rgba(0,0,0,.34)', color: 'rgba(255,255,255,.98)' }}>
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true" focusable="false">
      <circle cx="10" cy="10" r="1.56" fill="currentColor" />
      <circle cx="10" cy="10" r="3.8" stroke="currentColor" strokeWidth={stroke * .76} />
      {Array.from({ length: 14 }, (_, index) => {
        const angle = -Math.PI / 2 + index * Math.PI * 2 / 14
        return <circle key={index} cx={10 + Math.cos(angle) * 8} cy={10 + Math.sin(angle) * 8} r=".32" stroke="currentColor" strokeWidth={stroke} />
      })}
    </svg>
  </span>
}
