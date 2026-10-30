import type { ReactNode } from 'react'
import type { ArkmeMenuAction } from './ArkmeDshMenu.js'
import { ArkmeSelectActionIcon } from './message-selection-presentation.js'
import { ReactionAddIcon } from './ArkmeReactionPreview.js'
import { AskDshIcon } from './AskDshIcon.js'
import { Info } from '@phosphor-icons/react/dist/icons/Info'
import { Checks } from '@phosphor-icons/react/dist/icons/Checks'
import { tr } from './locale.js'

/** One presentation contract for Chat and Team. Callers still own permissions and transport. */
const order = ['reaction', 'copy', 'link', 'extend', 'edit', 'assign', 'select', 'forward', 'world', 'ask-dsh', 'report', 'detail', 'receipts', 'withdraw-divider', 'withdraw']
const labels: Record<string, string> = { reaction: '表态', copy: '复制', link: '复制链接', extend: '延展', edit: '重新编辑', assign: '指定主题', select: '多选', forward: '转发', 'ask-dsh': '问 DSH', report: '举报', detail: '消息详情', receipts: '查看阅读状态', withdraw: '撤回' }
type Command = Omit<Extract<ArkmeMenuAction, { onSelect(): void }>, 'label'> & { label?: ReactNode; disabledReason?: string }
export function conversationMessageMenu(actions: readonly (Command | Extract<ArkmeMenuAction, { type: string }> | false | undefined)[]): ArkmeMenuAction[] {
  return actions.filter((action): action is Command | Extract<ArkmeMenuAction, { type: string }> => !!action)
    .map(action => {
      if ('type' in action) return action
      const label = action.label ?? tr(labels[action.id] ?? action.id)
      const icon = action.icon ?? conversationMessageIcon(action.id)
      return { ...action, label: action.disabledReason ? <span title={action.disabledReason}>{label}</span> : label, ...(icon ? { icon } : {}) }
    })
    .sort((a, b) => (order.indexOf(a.id) < 0 ? order.length : order.indexOf(a.id)) - (order.indexOf(b.id) < 0 ? order.length : order.indexOf(b.id)))
}
function conversationMessageIcon(id: string): ReactNode {
  if (id === 'reaction') return <ReactionAddIcon />
  if (id === 'extend') return <ArkmeDesktopExtensionIcon />
  if (id === 'ask-dsh') return <AskDshIcon size={20} />
  if (id === 'detail') return <Info />
  if (id === 'receipts') return <Checks />
  if (id === 'assign') return <ArkmeSelectActionIcon kind="assign" size={16} />
  if (['copy', 'link', 'select', 'forward', 'report', 'withdraw', 'edit'].includes(id)) return <ArkmeMessageActionIcon kind={id as Parameters<typeof ArkmeMessageActionIcon>[0]['kind']} />
  return undefined
}

export function ArkmeMessageActionIcon({ kind }: { kind: 'copy' | 'link' | 'select' | 'forward' | 'report' | 'withdraw' | 'edit' }) {
  if (kind === 'withdraw') return <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden>
    <path d="M4 7.5h8.25a4.25 4.25 0 0 1 0 8.5H9.5" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" />
    <path d="m6.8 4.7-3 2.8 3 2.8" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
  if (kind === 'report') return <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden>
    <path d="M4.5 17.25V3.25M5 4H13.45C14.55 4 15.16 5.27 14.48 6.14L13.26 7.7C12.91 8.15 12.91 8.78 13.26 9.23L14.48 10.79C15.16 11.66 14.55 12.93 13.45 12.93H4.5" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
  if (kind === 'edit') return <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden>
    <path d="M4 14.8 3.5 17l2.2-.5L15.8 6.4a1.7 1.7 0 0 0 0-2.4l-.8-.8a1.7 1.7 0 0 0-2.4 0L4 14.8Z" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round" />
    <path d="m11.7 4.2 4.1 4.1" stroke="currentColor" strokeWidth="1.45" />
  </svg>
  return <ArkmeSelectActionIcon kind={kind} size={16} />
}

export function ArkmeDesktopExtensionIcon() {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden
    data-arkme-message-extension-icon="desktop">
    <circle cx="8" cy="2" r="1.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="13" cy="6" r="1.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="1.5" cy="10.5" r="1" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="14.5" cy="14.5" r="1" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="8" cy="10" r="2.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M8 3.5V7.5" stroke="currentColor" />
    <path d="M12 7L10 8.5M13.5 14L10 11.5M2.5 10.5H5.5" stroke="currentColor" />
  </svg>
}
