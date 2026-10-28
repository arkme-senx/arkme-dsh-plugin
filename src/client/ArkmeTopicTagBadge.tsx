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

export function ArkmeTopicTagBadge({ label, selected = false, truncate = false }: { label: string, selected?: boolean, truncate?: boolean }) {
  return <span
    data-arkme-topic-tag={label}
    title={truncate ? label : undefined}
    style={{
      ...badgeStyle,
      ...(truncate ? { flex: '0 1 auto', minWidth: 0, maxWidth: '50%' } : {}),
      background: selected ? '#e8eaf0' : 'rgba(36, 38, 41, .05)',
      color: selected ? '#50545d' : 'var(--dsw-alias-label-secondary, #777d85)',
    }}
  >{truncate ? <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span> : label}</span>
}
