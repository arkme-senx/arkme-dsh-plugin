import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Check } from '@phosphor-icons/react/dist/csr/Check'
import { Prohibit } from '@phosphor-icons/react/dist/csr/Prohibit'
import { UserMinus } from '@phosphor-icons/react/dist/csr/UserMinus'
import { UserPlus } from '@phosphor-icons/react/dist/csr/UserPlus'
import { Waveform } from '@phosphor-icons/react/dist/icons/Waveform'
import type { ArkmeSourceItem } from '../types.js'
import type { useDirectMessageAdmission } from './direct-message-admission.js'
import { banAuthorizationRejected, chatActionKey, privateChatActions, UnconfirmedBanError } from './private-chat-actions-store.js'
import { useResource } from './use-resource.js'
import { arkmeTheme } from './arkme-theme.js'
import {
  ARKME_CONVERSATION_SETTINGS_MENU_ROW_STYLE, ARKME_CONVERSATION_SETTINGS_MENU_SCRIM_STYLE,
  ARKME_CONVERSATION_SETTINGS_MENU_STATUS_STYLE, ARKME_CONVERSATION_SETTINGS_MENU_WIDTH,
  ARKME_CONVERSATION_SETTINGS_POPOVER_STYLE,
} from './ArkmeGroupChatControls.js'

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

/** Ordered business declarations; adding an item never changes the menu's cache or event machinery. */
export function privateChatActionItems(actions: ReturnType<typeof usePrivateChatActions>,
  admission: ReturnType<typeof useDirectMessageAdmission>, openRelated: () => void): ConversationActionItem[] {
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
  return items
}

export function ConversationActionsMenu({ items, anchor, host, onClose }: {
  items: readonly ConversationActionItem[]; anchor: RefObject<HTMLButtonElement>; host: HTMLElement; onClose(): void
}) {
  const menuRef = useRef<HTMLDivElement>(null)
  const gesture = useRef<{ id: string; invoke(): void }>()
  const [position, setPosition] = useState({ left: 12, top: 54 })
  const structure = items.map(item => item.id).join('|')
  useLayoutEffect(() => {
    gesture.current = undefined
    const positionMenu = () => {
      const button = anchor.current; const menu = menuRef.current
      if (button === null || menu === null) return
      const parent = host.getBoundingClientRect(); const trigger = button.getBoundingClientRect()
      setPosition({ left: Math.max(12, Math.min(parent.width - ARKME_CONVERSATION_SETTINGS_MENU_WIDTH - 12,
        trigger.right - parent.left - ARKME_CONVERSATION_SETTINGS_MENU_WIDTH)),
      top: Math.max(8, Math.min(parent.height - menu.getBoundingClientRect().height - 12, trigger.bottom - parent.top + 8)) })
    }
    positionMenu()
    if (typeof document !== 'undefined' && document.activeElement === document.body) {
      menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    }
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(positionMenu)
    if (menuRef.current !== null) observer?.observe(menuRef.current)
    observer?.observe(host)
    return () => { observer?.disconnect() }
  }, [anchor, host, structure])
  useEffect(() => {
    const menu = menuRef.current; const button = anchor.current
    menu?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    return () => {
      if (typeof document !== 'undefined' && (document.activeElement === document.body || menu?.contains(document.activeElement))) button?.focus()
    }
  }, [anchor])
  return <div style={ARKME_CONVERSATION_SETTINGS_MENU_SCRIM_STYLE} role="presentation" onMouseDown={event => {
    if (event.target === event.currentTarget) onClose()
  }}>
    <div ref={menuRef} style={{ ...ARKME_CONVERSATION_SETTINGS_POPOVER_STYLE, ...position, maxHeight: 'calc(100% - 20px)', overflowY: 'auto' }}
      role="menu" aria-label="更多私聊操作" onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); return }
        if (event.key === 'Tab') { onClose(); return }
        const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault()
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
            : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
          buttons[next]?.focus()
        }
      }}>
      {items.length === 0 && <div style={ARKME_CONVERSATION_SETTINGS_MENU_STATUS_STYLE}>当前没有可用操作</div>}
      {items.map(item => <div key={item.id}>
        <button type="button" role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
          aria-checked={item.checked} aria-busy={item.busy || undefined} disabled={item.disabled || item.busy}
          style={ARKME_CONVERSATION_SETTINGS_MENU_ROW_STYLE}
          onMouseEnter={event => { event.currentTarget.style.background = arkmeTheme.subtle }}
          onMouseLeave={event => { event.currentTarget.style.background = 'transparent' }}
          onPointerDown={() => { gesture.current = { id: item.id, invoke: item.invoke } }}
          onKeyDown={event => {
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (!event.repeat && !event.nativeEvent.isComposing) item.invoke() }
          }}
          onClick={event => {
            const captured = gesture.current; gesture.current = undefined
            if (event.detail === 0) item.invoke()
            else if (captured?.id === item.id) captured.invoke()
          }}>
          {item.icon}<span>{item.label}</span>
          {item.busy ? <span aria-hidden style={{ marginLeft: 'auto', fontSize: 12, color: arkmeTheme.secondary }}>处理中…</span>
            : item.checked === true && <Check size={16} style={{ marginLeft: 'auto' }} aria-hidden />}
        </button>
        {item.error && <div role="status" style={ARKME_CONVERSATION_SETTINGS_MENU_STATUS_STYLE}>{item.error}</div>}
      </div>)}
    </div>
  </div>
}
