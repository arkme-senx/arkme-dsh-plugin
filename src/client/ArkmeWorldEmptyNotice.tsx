import type { CSSProperties, ReactNode } from 'react'

const emptyNoticeStyle: CSSProperties = {
  boxSizing: 'border-box',
  padding: '13px 15px',
  border: 0,
  borderRadius: 12,
  background: 'var(--dsw-alias-bg-subtle, #f6f6f7)',
  color: 'var(--dsw-alias-label-secondary, #858992)',
  fontSize: 12,
  lineHeight: '18px',
}

export function ArkmeWorldEmptyNotice({
  children,
  className,
  style,
}: {
  children: ReactNode
  className?: string | undefined
  style?: CSSProperties | undefined
}) {
  return <div
    className={className}
    data-arkme-world-empty-state="true"
    style={{ ...emptyNoticeStyle, ...style }}
  >{children}</div>
}
