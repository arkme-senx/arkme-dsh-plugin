import type { CSSProperties } from 'react'

const badgeStyle: CSSProperties = {
  flex: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '2px 7px',
  borderRadius: 999,
  boxSizing: 'border-box',
  fontSize: 10,
  lineHeight: '14px',
  fontWeight: 500,
  whiteSpace: 'nowrap',
}

export function ArkmeTopicTagBadge({ label, selected = false }: { label: string, selected?: boolean }) {
  return <span
    data-arkme-topic-tag={label}
    style={{
      ...badgeStyle,
      background: selected ? 'rgba(32, 198, 106, .12)' : 'rgba(36, 38, 41, .05)',
      color: selected ? '#16834b' : 'var(--dsw-alias-label-secondary, #777d85)',
    }}
  >{label}</span>
}
