import type { CSSProperties, ReactNode } from 'react'
import { messageSelectionStyles as styles } from './message-selection-presentation.js'

export interface MessageSelectionAction {
  id: string; label: string; icon: ReactNode; disabled?: boolean; reason?: string | undefined; danger?: boolean; onSelect(anchor: HTMLButtonElement): void
}
/** Shared batch-action surface; each message owner supplies its capabilities. */
export function ArkmeMessageSelectionBar({ count, actions, children, style, ariaLabel }: { count: number; actions: readonly (MessageSelectionAction | false | undefined)[]; children?: ReactNode; style?: CSSProperties | undefined; ariaLabel?: string }) {
  return <div role="toolbar" aria-label={ariaLabel ?? `已选择 ${count} 条消息`} style={{ ...styles.selectBar, flexWrap: 'wrap', ...style }}>
    {children}
    {actions.filter((action): action is MessageSelectionAction => !!action).map(action => <span key={action.id} title={action.reason}>
      <button type="button" aria-label={action.label} disabled={action.disabled} data-arkme-feedback={action.danger ? 'danger' : 'neutral'}
        style={{ ...styles.selectBarButton, ...(action.disabled ? styles.selectBarButtonDisabled : {}) }} onClick={event => action.onSelect(event.currentTarget)}>
        <span style={styles.selectBarIconTile}>{action.icon}</span><span style={styles.selectBarLabel}>{action.label}</span>
      </button>
    </span>)}
  </div>
}
