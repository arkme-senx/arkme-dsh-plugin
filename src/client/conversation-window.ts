import type { ArkmeSourceItem } from '../types.js'
import { arkmeAuthStore } from './auth-store.js'
import { arkmeSourceIdentityKey } from './source-identity.js'
export interface ConversationWindowTarget { accountKey: string; sourceKey: string; source: ArkmeSourceItem }
export type ConversationWindowEvent = ({kind: 'article'; key: string; value: unknown} | {kind: 'call'; source: ArkmeSourceItem; mediaType: 'audio' | 'video'} | {kind: 'draft'; key: string; value: unknown} | {kind: 'changed'} | {kind: 'activate'; source: ArkmeSourceItem} | {kind: 'busy'; key: string; value: boolean}) & {accountKey?: string}
export interface ConversationWindowBridge {
 version: 1
 open(target: ConversationWindowTarget): Promise<boolean>
 account(account: string | null): Promise<boolean>
 context(): Promise<ConversationWindowTarget | null>
 active(): Promise<boolean>
 close(): Promise<void>
 focusMain(target?: ConversationWindowTarget): Promise<boolean>
 requestCall(mediaType: 'audio' | 'video'): Promise<boolean>
 snapshot(account: string): Promise<ConversationWindowEvent[]>
 publish(event: ConversationWindowEvent, account: string): Promise<boolean>
 acquire(key: string, account: string, token: string): Promise<boolean>
 consumed(key: string, account: string, token: string): Promise<void>
 release(key: string, account: string, token: string): Promise<void>
 onEvent(listener: (event: ConversationWindowEvent) => void): () => void
}
export function conversationWindowBridge(): ConversationWindowBridge | undefined {
 const bridge = (globalThis as typeof globalThis & {arkmeConversation?: ConversationWindowBridge}).arkmeConversation
 return bridge?.version === 1 ? bridge : undefined
}
export function conversationWindowRequested(): boolean {
 return typeof location !== 'undefined' && new URLSearchParams(location.search).get('arkmeConversation') === '1'
}
export function conversationAccountKey(): string | null {
 const auth = arkmeAuthStore.getSnapshot().auth
 return auth?.status === 'authenticated' && auth.userId !== undefined ? `${auth.environment}:${auth.userId}` : null
}
export function conversationWindowTarget(accountKey: string, source: ArkmeSourceItem): ConversationWindowTarget | undefined {
 if (!['private_chat','group_chat','send_to_self'].includes(source.kind)) return
 return {accountKey, sourceKey: arkmeSourceIdentityKey(source), source}
}
export async function openConversationWindow(source: ArkmeSourceItem): Promise<void> {
 const bridge = conversationWindowBridge()
 if (!bridge) throw new Error('当前客户端不支持独立会话窗口，请更新客户端')
 const account = conversationAccountKey()
 if (!account) throw new Error('请先登录')
 const target = conversationWindowTarget(account,source)
 if (!target) throw new Error('该会话暂不支持独立窗口')
 if (conversationWindowRequested()) {
  if ((await bridge.context())?.accountKey !== account || !await bridge.active()) throw new Error('会话窗口已失效，请重新打开')
 } else if (!await bridge.account(account)) throw new Error('账号已切换，请重试')
 if (account !== conversationAccountKey()) throw new Error('账号已切换，请重试')
 if (!await bridge.open(target)) throw new Error('会话窗口打开失败，请重试')
}

/** Navigation policy for the shared conversation surface in a fixed child window. */
export async function navigateConversationWindow(source: ArkmeSourceItem): Promise<{destination: 'window' | 'main'; reason?: string}> {
 const account = conversationAccountKey()
 const bridge = conversationWindowBridge()
 const target = account ? conversationWindowTarget(account, source) : undefined
 if (!bridge || !target) throw new Error('当前会话无法打开，请重新登录或更新客户端')
 try {
  await openConversationWindow(source)
  return {destination: 'window'}
 } catch (error) {
  if (account !== conversationAccountKey() || (await bridge.context())?.accountKey !== account || !await bridge.active()) throw new Error('会话窗口已失效，请重新打开')
  const reason = error instanceof Error ? error.message : '独立窗口打开失败'
  let activated = false
  try { activated = await bridge.focusMain(target) } catch { /* Report both failed destinations below. */ }
  if (!activated) throw new Error(`${reason}；主窗口也无法打开该会话，请重试`)
  return {destination: 'main', reason}
 }
}
