import { readSelectedTextNoteQuote, selectedTextForwardWireText } from '../selected-text-note.js'
import { ArkmePluginError, type ServiceRuntime } from './service.js'
import type { ArkmeSourceSendResult } from '../types.js'
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** Personal selection snapshot: never fetch or forward the rest of the original message. */
export async function sendSelectedTextForward(runtime: ServiceRuntime, input: {
  expectedAccountKey: string; recordUid: string; relationUid: string; commentText: string; quote: unknown
}, target: { kind: string; ownerRef: string }, send: (text: string, userId: number) => Promise<ArkmeSourceSendResult>, signal?: AbortSignal) {
  const session = await runtime.requireSession()
  signal?.throwIfAborted()
  const scope = `${runtime.config.environment}:${session.userId}`
  if (scope !== input.expectedAccountKey) throw new ArkmePluginError('selected-text-account-changed', '账号已变化，请重新选择', false, 409)
  if (!['send_to_self', 'default_category', 'topic', 'private_chat', 'group_chat'].includes(target.kind)) throw new ArkmePluginError('selected-text-target-invalid', '此对话暂不支持转发', false, 400)
  const quote = readSelectedTextNoteQuote(input.quote)
  if (!quote || !uuid.test(input.recordUid) || !uuid.test(input.relationUid)) throw new ArkmePluginError('selected-text-invalid', '选中文字或发送标识无效，请重新选择', false, 400)
  const text = selectedTextForwardWireText(input.commentText, quote)
  if (text.length > runtime.config.maxTextLength) throw new ArkmePluginError('selected-text-too-long', `引用与附言合计最多 ${runtime.config.maxTextLength} 个字符`, false, 400)
  const store = runtime.stateStore.selfNoteQuotes
  if (!store) throw new ArkmePluginError('selected-text-storage-unavailable', '本机引用保存失败，尚未发送，请重试', true, 503)
  store.prepare(scope, input.recordUid, quote, input.commentText.trim(), { targetKey: JSON.stringify([target.kind, target.ownerRef]), relationUid: input.relationUid })
  const current = await runtime.accountScopedSession()
  if (!current || current.userId !== session.userId || current.refreshToken !== session.refreshToken) throw new ArkmePluginError('selected-text-account-changed', '账号已变化，本次转发已取消', false, 409)
  signal?.throwIfAborted()
  const result = await send(text, session.userId)
  if (result.itemUid !== input.recordUid || result.localState !== 'synced') throw new ArkmePluginError('selected-text-unconfirmed', '转发结果未确认，请使用原请求重试', true, 502)
  return result
}
