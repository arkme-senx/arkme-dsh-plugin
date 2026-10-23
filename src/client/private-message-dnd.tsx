import { useEffect, useRef, useState } from 'react'
import { BellSlash } from '@phosphor-icons/react/dist/csr/BellSlash'
import type { ArkmeChatNotificationResult, ArkmeSourceItem } from '../types.js'
import type { ArkmeSourceIdentityFacts } from './source-identity.js'
import type { ConversationActionItem } from './PrivateChatActions.js'
import { MessageDndSwitch } from './ArkmeGroupChatControls.js'
import { callArkme } from './api.js'
import { withArkmeReadDeadline } from './read-deadline.js'
import { tr } from './locale.js'

type Snapshot = { key: string; value?: ArkmeChatNotificationResult | undefined; error?: string | undefined }
const version = (value?: ArkmeChatNotificationResult) => value?.chatNotificationPolicyUpdatedAtMillis ?? 0
function sourcePolicy(source?: ArkmeSourceItem): ArkmeChatNotificationResult | undefined {
  return typeof source?.isMuted === 'boolean' && (source.chatNotificationPolicyUpdatedAtMillis ?? 0) > 0
    ? { messageDnd: source.isMuted, chatNotificationPolicyUpdatedAtMillis: source.chatNotificationPolicyUpdatedAtMillis! }
    : undefined
}

/** The server owns persistence. Local intent only paints the switch while the write is in flight. */
export function usePrivateMessageDnd(account: string | undefined, source: ArkmeSourceItem | undefined, open: boolean,
  onUpdated: (target: ArkmeSourceIdentityFacts, result: ArkmeChatNotificationResult) => boolean): ConversationActionItem | undefined {
  const key = account && source?.kind === 'private_chat' ? `${account}:${source.sourceKey || source.sourceRef}` : ''
  const [snapshot, setSnapshot] = useState<Snapshot>({ key: '' })
  const [retry, setRetry] = useState(0)
  const current = useRef({ key, account, source, onUpdated }); current.current = { key, account, source, onUpdated }
  const reader = useRef<AbortController>(), generation = useRef(0)
  const writers = useRef(new Map<string, { account: string; enabled: boolean; controller: AbortController }>())
  const server = sourcePolicy(source)
  const stored = snapshot.key === key ? snapshot : undefined
  const value = version(server) > version(stored?.value) ? server : stored?.value ?? server
  const pending = writers.current.get(key)
  const shown = pending?.enabled ?? value?.messageDnd
  const busy = pending !== undefined
  const accept = (target: ArkmeSourceItem, result: ArkmeChatNotificationResult, targetKey: string, targetAccount: string) => {
    if (current.current.account !== targetAccount) return
    current.current.onUpdated(target, result)
    if (current.current.key === targetKey) setSnapshot(old => ({ ...(old.key === targetKey ? old : {}), key: targetKey,
      value: old.key === targetKey && version(old.value) > version(result) ? old.value : result }))
  }
  useEffect(() => () => { reader.current?.abort(); for (const write of writers.current.values()) write.controller.abort(); writers.current.clear() }, [])
  useEffect(() => {
    for (const [target, write] of writers.current) {
      if (write.account !== account) { write.controller.abort(); writers.current.delete(target) }
    }
    setSnapshot(old => old.key === key ? old : { key })
  }, [key, account])
  useEffect(() => {
    if (!open || !key || !account || !source || writers.current.has(key)) return
    const controller = new AbortController(); reader.current = controller
    const attempt = ++generation.current
    void withArkmeReadDeadline(signal => callArkme<ArkmeChatNotificationResult>('chat.notification.get', { sourceRef: source.sourceRef }, signal), controller.signal)
      .then(result => {
        if (controller.signal.aborted || attempt !== generation.current || current.current.key !== key) return
        accept(source, result, key, account)
        setSnapshot(old => ({ ...old, key, error: undefined }))
      }).catch(() => {
        if (!controller.signal.aborted && attempt === generation.current && current.current.key === key) {
          setSnapshot(old => ({ ...(old.key === key ? old : { key }), error: tr(value ? '免打扰状态暂未更新，请重新打开菜单重试' : '免打扰状态读取失败，点击重试') }))
        }
      })
    return () => { controller.abort() }
  }, [key, open, retry])

  const toggle = async (enabled: boolean) => {
    if (!key || !account || !source || current.current.key !== key || writers.current.has(key)) return
    reader.current?.abort(); generation.current++
    const controller = new AbortController(); writers.current.set(key, { account, enabled, controller })
    setSnapshot({ key, value })
    try {
      const result = await callArkme<ArkmeChatNotificationResult>('chat.notification.set', { sourceRef: source.sourceRef, enabled }, controller.signal)
      if (!controller.signal.aborted) accept(source, result, key, account)
    } catch {
      if (controller.signal.aborted || current.current.account !== account) return
      // A dropped response is not proof the write failed. Read back once, never repeat a write blindly.
      let reconciled = false
      try {
        const result = await withArkmeReadDeadline(signal => callArkme<ArkmeChatNotificationResult>('chat.notification.get', { sourceRef: source.sourceRef }, signal), controller.signal)
        if (!controller.signal.aborted) { accept(source, result, key, account); reconciled = result.messageDnd === enabled }
      } catch { /* Keep the previous verified value; expose retry below. */ }
      if (!controller.signal.aborted && current.current.key === key && !reconciled) {
        setSnapshot(old => ({ ...old, error: tr('免打扰未确认保存，请重试') }))
      }
    } finally {
      if (writers.current.get(key)?.controller === controller) {
        writers.current.delete(key)
        if (current.current.key === key) setSnapshot(old => ({ ...old }))
      }
    }
  }
  if (!key) return undefined
  const error = stored?.error
  const unread = shown === undefined
  return {
    id: 'message-dnd', keepOpenOnSelect: true,
    label: <span style={{ display: 'flex', alignItems: 'center', gap: 24, justifyContent: 'space-between' }}>
      <span>{tr('消息免打扰')}</span>
      {unread ? <span style={{ fontSize: 12 }}>{tr(error ? '重试' : '读取中…')}</span>
        : <MessageDndSwitch checked={shown} busy={busy} onChange={next => { void toggle(next) }} />}
    </span>,
    icon: <BellSlash size={20} aria-hidden />, disabled: busy || unread && !error, ...(error ? { error } : {}),
    invoke: () => { if (unread) setRetry(n => n + 1); else void toggle(!shown) },
  }
}
