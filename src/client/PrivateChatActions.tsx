import { useEffect, useMemo, useRef, type ReactNode, type RefObject } from 'react'
import { type MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import { DownloadSimple } from '@phosphor-icons/react/dist/csr/DownloadSimple'
import { Prohibit } from '@phosphor-icons/react/dist/csr/Prohibit'
import { UserMinus } from '@phosphor-icons/react/dist/csr/UserMinus'
import { UserPlus } from '@phosphor-icons/react/dist/csr/UserPlus'
import { Waveform } from '@phosphor-icons/react/dist/icons/Waveform'
import type { ArkmeSourceItem } from '../types.js'
import type { useDirectMessageAdmission } from './direct-message-admission.js'
import { banAuthorizationRejected, chatActionKey, privateChatActions, UnconfirmedBanError } from './private-chat-actions-store.js'
import { useResource } from './use-resource.js'
import {
  ArkmeConversationHeaderIconButton, ArkmeConversationMoreIcon,
} from './ArkmeGroupChatControls.js'
import { ArkmeDshMenu } from './ArkmeDshMenu.js'

export function usePrivateChatActions(account: string | undefined, userId: number | undefined,
  source: ArkmeSourceItem | undefined, active: boolean, open: boolean) {
  const binding = useMemo(() => ({ account: account ?? '', source: source ?? {
    sourceRef: '', kind: 'private_chat' as const, displayName: '',
  } }), [account, source?.sourceRef, source?.sourceKey, source?.kind, source?.peerUserId, source?.displayName])
  const identityBinding = useMemo(() => ({ account: account ?? '', userId: userId ?? 0 }), [account, userId])
  const key = active && account !== undefined && source?.kind === 'private_chat' ? chatActionKey(binding) : undefined
  const identity = useResource(privateChatActions.identity, key === undefined ? undefined : account, identityBinding, key !== undefined)
  // Eligibility is account-level able-func policy, not the peer's recording list or access grant.
  const eligibility = useResource(privateChatActions.eligibility, key === undefined ? undefined : account, binding, open && key !== undefined)
  const canManage = key !== undefined && privateChatActions.canManage(binding, identityBinding)
  const ban = useResource(privateChatActions.ban, key, binding, canManage && open)
  const activeRef = useRef(key)
  activeRef.current = key
  useEffect(() => () => { activeRef.current = undefined }, [])
  useEffect(() => {
    // An explicit reopen retries a failed identity read; a fresh identity still needs no network.
    if (open && key !== undefined) void privateChatActions.identity.refresh(identityBinding.account, identityBinding, false).catch(() => undefined)
  }, [open, key, identityBinding])
  useEffect(() => {
    if (open && identity.snapshot.stale && !identity.snapshot.refreshing && identity.snapshot.error === undefined) identity.refresh()
  }, [open, identity.snapshot, identity.refresh])
  const changeBan = async (banned: boolean): Promise<void> => {
    try {
      await privateChatActions.setBanned(binding, identityBinding, banned, (name, desired) => window.confirm(
        `确认${desired ? '封禁' : '解封'}“${name}”吗？\n${desired
          ? '封禁后该用户将无法重新登录；Backend、聊天和录音请求会立即受限；其他仅离线验 JWT 的服务中，旧 Access Token 最迟约 1 小时失效。'
          : '解封后该用户可以重新登录并恢复操作。'}`,
      ), () => activeRef.current === key)
    } catch { /* Persistent inline feedback is owned by the resource; canceled contexts stay silent. */ }
  }
  const currentAccount = privateChatActions.account === account
  return { canManage: canManage && !banAuthorizationRejected(ban.snapshot.error), changeBan,
    relatedAllowed: currentAccount && eligibility.snapshot.value?.allowed === true,
    relatedError: eligibility.snapshot.error,
    refreshRelated: eligibility.refresh,
    ban: currentAccount ? ban.snapshot : privateChatActions.ban.empty,
  }
}

export interface ConversationActionItem {
  id: string
  label: string
  icon: ReactNode
  checked?: boolean
  busy?: boolean
  disabled?: boolean
  error?: string
  invoke(): void
}

export interface ConversationExportAction {
  busy: boolean
  processed: number
  invoke(): void
}

export function conversationExportActionItem(action: ConversationExportAction): ConversationActionItem {
  return {
    id: 'export',
    label: action.busy
      ? `正在导出${action.processed > 0 ? ` · ${String(action.processed)} 条` : ''}`
      : '导出',
    icon: <DownloadSimple size={20} weight="regular" aria-hidden />,
    busy: action.busy,
    invoke: action.invoke,
  }
}

/** Ordered business declarations; adding an item never changes the menu's cache or event machinery. */
export function privateChatActionItems(actions: ReturnType<typeof usePrivateChatActions>,
  admission: ReturnType<typeof useDirectMessageAdmission>, openRelated: () => void,
  exportAction?: ConversationExportAction): ConversationActionItem[] {
  const items: ConversationActionItem[] = []
  if (actions.relatedAllowed) items.push({ id: 'related', label: '相关录音', icon: <Waveform size={20} aria-hidden />, invoke: openRelated,
    error: actions.relatedError === undefined ? '' : '暂时无法更新相关录音资格' })
  else if (actions.relatedError !== undefined) items.push({ id: 'related', label: '重新检查相关录音', icon: <Waveform size={20} aria-hidden />, invoke: actions.refreshRelated })
  if (admission.applicable) items.push({ id: 'refusal', label: '拒收对方消息', icon: <Prohibit size={20} aria-hidden />,
    checked: admission.admission?.ownRefused ?? false, busy: admission.busy, error: admission.error,
    disabled: admission.admission !== undefined && !admission.admission.ownRefused && !admission.admission.refusalCreationEnabled,
    invoke: () => { void admission.toggle(() => window.confirm('拒收对方消息？\n拒收后你们都无法发送新消息；聊天记录保留，你可以随时解除拒收。')) },
  })
  if (actions.canManage) {
    const retry = actions.ban.operationError instanceof UnconfirmedBanError ? actions.ban.operationError : undefined
    const desired = retry?.banned ?? !(actions.ban.value?.banned ?? false)
    items.push({ id: 'ban', label: `${retry === undefined ? '' : '重试'}${desired ? '封禁' : '解封'}用户`,
      icon: desired ? <UserMinus size={20} aria-hidden /> : <UserPlus size={20} aria-hidden />,
      busy: actions.ban.mutating,
      error: actions.ban.operationError instanceof Error ? actions.ban.operationError.message
        : actions.ban.error !== undefined ? '暂时无法读取封禁状态；操作时仍会由服务端校验' : '',
      invoke: () => { void actions.changeBan(desired) },
    })
  }
  if (exportAction !== undefined) items.push(conversationExportActionItem(exportAction))
  return items
}

export function ConversationActionsMenu({ items, anchor, onClose, label = '更多私聊操作', trigger }: {
  items: readonly ConversationActionItem[]
  anchor: RefObject<HTMLButtonElement>
  host?: HTMLElement
  onClose(): void
  label?: string
  trigger?: { open: boolean; onOpenChange(open: boolean): void; busy?: boolean }
}) {
  const open = trigger?.open ?? true
  useEffect(() => {
    if (!open) return
    return () => {
      if (typeof anchor.current?.focus === 'function') anchor.current.focus()
    }
  }, [anchor, open])
  const menuItems: MenuEntry[] = []
  for (const item of items) {
    if (item.id === 'export') {
      if (menuItems.length > 0) menuItems.push({ type: 'separator', id: 'export-separator' })
    }
    const disabled = item.disabled === true || item.busy === true
    menuItems.push({ id: item.id, label: item.label, icon: item.icon, ...(disabled ? { disabled: true } : {}) })
    if (item.error) menuItems.push({ id: `${item.id}:error`, label: <span role="status">{item.error}</span>, disabled: true })
  }
  if (menuItems.length === 0) menuItems.push({ id: 'empty', label: '当前没有可用操作', disabled: true })
  const close = () => {
    trigger?.onOpenChange(false)
    onClose()
  }
  return <ArkmeDshMenu
    conversationAppearance
    open={open}
    label={label}
    align="end"
    portal
    getAnchorRect={() => anchor.current?.getBoundingClientRect() ?? null}
    items={menuItems}
    selectedIds={items.filter(item => item.checked === true).map(item => item.id)}
    onClose={close}
    onSelect={id => {
      const item = items.find(value => value.id === id)
      if (item === undefined) return
      close()
      item.invoke()
    }}
    anchor={trigger === undefined
      ? <span aria-hidden />
      : <ArkmeConversationHeaderIconButton
        label={label}
        buttonRef={anchor}
        hasPopup
        expanded={open}
        {...(trigger.busy === undefined ? {} : { busy: trigger.busy })}
        onClick={() => { trigger.onOpenChange(!open) }}
      ><ArkmeConversationMoreIcon /></ArkmeConversationHeaderIconButton>}
  />
}
