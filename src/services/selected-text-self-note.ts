import { readSelectedTextNoteQuote, selectedTextNoteWireText } from '../selected-text-note.js'
import { ArkmePluginError, type ServiceRuntime } from './service.js'
import type { ArkmeSourceSendResult } from '../types.js'

export async function sendSelectedTextSelfNote(runtime: ServiceRuntime, input: {
  expectedAccountKey: string; recordUid: string; noteText: string; quote: unknown
}, send: (text: string, userId: number) => Promise<ArkmeSourceSendResult>, signal?: AbortSignal) {
  const session = await runtime.requireSession()
  signal?.throwIfAborted()
  const accountKey = `${runtime.config.environment}:${session.userId}`
  if (input.expectedAccountKey !== accountKey) throw new ArkmePluginError('self-note-account-changed', '账号已切换，请重新选择内容', false, 409)
  const quote = readSelectedTextNoteQuote(input.quote), note = input.noteText.trim()
  if (!quote || !note || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.recordUid)) {
    throw new ArkmePluginError('self-note-invalid', '引用或笔记内容无效，请重新选择', false)
  }
  const text = selectedTextNoteWireText(note, quote)
  if (text.length > runtime.config.maxTextLength) throw new ArkmePluginError('self-note-too-long', `引用与笔记合计最多 ${runtime.config.maxTextLength} 个字符`, false)
  const store = runtime.stateStore.selfNoteQuotes
  if (!store) throw new ArkmePluginError('self-note-storage-unavailable', '本机引用存储暂不可用，尚未发送，请重试', true, 503)
  // Save structure BEFORE submitting. Ambiguous network outcomes can then be reconciled after restart.
  store.prepare(accountKey, input.recordUid, quote, note)
  const current = await runtime.accountScopedSession()
  if (!current || current.userId !== session.userId || current.refreshToken !== session.refreshToken) throw new ArkmePluginError('self-note-account-changed', '账号已切换，本次发送已取消', false, 409)
  signal?.throwIfAborted()
  const result = await send(text, session.userId)
  if (result.itemUid !== input.recordUid || result.localState !== 'synced') throw new ArkmePluginError('self-note-unconfirmed', '发送结果未确认，内容已保留，请使用原内容重试', true, 502)
  return result
}
