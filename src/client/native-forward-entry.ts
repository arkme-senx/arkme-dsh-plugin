import type { NativeChatSelectionSnapshot } from '../native-chat-selection-contract.js'
import type { ArkmeSourceItem, ArkmeSourceSendResult } from '../types.js'
import { arkmeSourceIdentityKey } from './source-identity.js'

export interface NativeForwardResult { completed: boolean }
export interface NativeForwardDelivery {
  readonly comment: string | undefined
  send(target: ArkmeSourceItem, comment: string, signal: AbortSignal): Promise<ArkmeSourceSendResult>
}
export interface NativeForwardContent {
  snapshot: NativeChatSelectionSnapshot
  userId: number
  delivery: NativeForwardDelivery
}
export interface NativeForwardEntry {
  open(content: NativeForwardContent, signal: AbortSignal, caller: Window): Promise<NativeForwardResult>
}
export const NATIVE_FORWARD_ENTRY = '__arkmeNativeForwardEntry'
export type NativeForwardWindow = Window & { [NATIVE_FORWARD_ENTRY]?: NativeForwardEntry }

/** The native frame submits local content; only Arkme owns the target picker. */
export function openNativeForward(doc: Document, content: NativeForwardContent, signal: AbortSignal) {
  const caller = doc.defaultView
  const entry = (caller?.parent as NativeForwardWindow | undefined)?.[NATIVE_FORWARD_ENTRY]
  if (!caller || caller.parent === caller || !entry) throw new Error('Arkme 转发页面尚未就绪，请稍后重试')
  return entry.open(content, signal, caller)
}

export function isNativeForwardCaller(host: Window, caller: Window): boolean {
  return [...host.document.querySelectorAll<HTMLIFrameElement>('[data-arkme-owned="deepseek-harness-surface"][data-arkme-visible="true"] iframe')]
    .some(frame => frame.contentWindow === caller)
}

export function nativeForwardPreview(snapshot: NativeChatSelectionSnapshot) {
  const first = snapshot.messages[0]
  return {
    title: `我和DeepSeek Harness的${snapshot.messages.length > 1 ? `${snapshot.messages.length}条` : ''}快记`,
    subtitle: first ? `${first.role === 'user' ? '我' : 'DeepSeek Harness'}：${first.text.trim().replace(/\s+/g, ' ')}` : '',
  }
}

export interface NativeForwardIdentity {
  requestId: string; recordUid: string; commentRecordUid: string; sendAtMillis: number
}

/** Keep retry identity and comment with the frozen content, not with signed target refs. */
export function nativeForwardDelivery(
  send: (target: ArkmeSourceItem, identity: NativeForwardIdentity, comment: string, signal: AbortSignal) => Promise<ArkmeSourceSendResult>,
): NativeForwardDelivery {
  let frozenComment: string | undefined
  const attempts = new Map<string, { identity: NativeForwardIdentity; result?: ArkmeSourceSendResult }>()
  return {
    get comment() { return frozenComment },
    async send(target: ArkmeSourceItem, comment: string, signal: AbortSignal) {
      frozenComment ??= comment.trim()
      const key = `${target.kind}:${target.kind === 'send_to_self' || target.kind === 'default_category' ? target.kind : arkmeSourceIdentityKey(target)}`
      let attempt = attempts.get(key)
      if (!attempt) {
        attempt = { identity: { requestId: `dsh-forward-${crypto.randomUUID()}`, recordUid: crypto.randomUUID(), commentRecordUid: crypto.randomUUID(), sendAtMillis: Date.now() } }
        attempts.set(key, attempt)
      }
      if (attempt.result) return attempt.result
      const result = await send(target, attempt.identity, frozenComment, signal)
      if (result.localState !== 'synced' || !result.itemUid) throw new Error('转发结果未确认，请使用原请求重试')
      if (!result.warningText) attempt.result = result
      return result
    },
  }
}
