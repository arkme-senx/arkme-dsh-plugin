import {createHash} from 'node:crypto'
import type {RecordExcerpt} from '../record-excerpt.js'
import { readSelectedTextNoteQuote, selectedTextForwardWireText, selectedTextNoteHeader } from '../selected-text-note.js'
import { ArkmePluginError, type ServiceRuntime } from './service.js'
import type { ArkmeSourceSendResult } from '../types.js'
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** Personal selection snapshot: never fetch or forward the rest of the original message. */
export async function sendSelectedTextForward(runtime: ServiceRuntime, input: {
  expectedAccountKey: string; recordUid: string; relationUid: string; commentText: string; quote: unknown; sendAtMillis:number
}, target: { kind: string; ownerRef: string }, send: (text: string, userId: number, excerpt:RecordExcerpt) => Promise<ArkmeSourceSendResult>, signal?: AbortSignal) {
  const session = await runtime.requireSession()
  signal?.throwIfAborted()
  const scope = `${runtime.config.environment}:${session.userId}`
  if (scope !== input.expectedAccountKey) throw new ArkmePluginError('selected-text-account-changed', '账号已变化，请重新选择', false, 409)
  if (!['send_to_self', 'default_category', 'topic', 'private_chat', 'group_chat'].includes(target.kind)) throw new ArkmePluginError('selected-text-target-invalid', '此对话暂不支持转发', false, 400)
  const quote = readSelectedTextNoteQuote(input.quote)
  if (!quote || !uuid.test(input.recordUid) || !uuid.test(input.relationUid)) throw new ArkmePluginError('selected-text-invalid', '选中文字或发送标识无效，请重新选择', false, 400)
  const text = selectedTextForwardWireText(input.commentText, quote)
  if (text.length > runtime.config.maxTextLength) throw new ArkmePluginError('selected-text-too-long', `引用与附言合计最多 ${runtime.config.maxTextLength} 个字符`, false, 400)
  if(!Number.isSafeInteger(input.sendAtMillis)||input.sendAtMillis<=0)throw new ArkmePluginError('selected-text-invalid','发送时间无效',false,400)
  const header=selectedTextNoteHeader(quote),quoteEnd=header.length+1+quote.text.length
  const noteStart=input.commentText.trim()?quoteEnd+'\n\n附言\n'.length:quoteEnd
  const excerpt:RecordExcerpt={schema_version:1,kind:'forward',header_end:header.length,quote_start:header.length+1,quote_end:quoteEnd,note_start:noteStart,frozen_digest:createHash('sha256').update(text.slice(0,noteStart)).digest('hex'),...(quote.source?{source:quote.source}:{}),...(quote.sourceSelection?{source_selection:quote.sourceSelection}:{})}
  const current = await runtime.accountScopedSession()
  if (!current || current.userId !== session.userId || current.refreshToken !== session.refreshToken) throw new ArkmePluginError('selected-text-account-changed', '账号已变化，本次转发已取消', false, 409)
  signal?.throwIfAborted()
  const result = await send(text, session.userId, excerpt)
  if (result.itemUid !== input.recordUid || result.localState !== 'synced') throw new ArkmePluginError('selected-text-unconfirmed', '转发结果未确认，请使用原请求重试', true, 502)
  return result
}
