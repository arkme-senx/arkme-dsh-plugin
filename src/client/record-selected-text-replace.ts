import type { ArkmeRecordReeditEditorSnapshot, ArkmeRecordReeditSubmissionView } from '../record-reedit-contract.js'
import type { ArkmeMessageQuote } from '../message-quote.js'
import { quoteSourceContent } from '../message-quote.js'
import type { MessageSelectionTarget } from './ArkmeMessageTextSelection.js'
import { applyMessageTextReplacement, resolveMessageTextReplacement } from './message-text-replacement.js'
import { callArkme } from './api.js'

/** Reuse Record's versioned, durable submission; never overwrite another editor's draft. */
export async function prepareRecordSelectedTextReplace(target: MessageSelectionTarget, quote: ArkmeMessageQuote, signal: AbortSignal,
  guard: () => void, accepted: (job: ArkmeRecordReeditSubmissionView) => void) {
  guard(); signal.throwIfAborted()
  const range = resolveMessageTextReplacement(target.item, quote)
  const snapshot = await callArkme<ArkmeRecordReeditEditorSnapshot>('source.record-reedit.detail', {
    sourceRef: target.sourceRef, itemUid: target.item.itemUid,
  }, signal)
  signal.throwIfAborted(); guard()
  if (snapshot.draft) throw new Error('这条消息有未提交的编辑草稿，请先在“重新编辑”中处理，草稿不会被覆盖')
  if (snapshot.itemUid !== target.item.itemUid || snapshot.textContent !== target.item.textContent
    || (target.item.recordVersion !== undefined && snapshot.version !== target.item.recordVersion)
    || quoteSourceContent(snapshot) !== quoteSourceContent(target.item)) throw new Error('消息已更新，请重新选择要替换的文字')
  return { async save(value: string) {
    signal.throwIfAborted(); guard()
    const next = applyMessageTextReplacement(snapshot.textContent, range, value, snapshot.mentions)
    if (!next.text.trim() && !snapshot.hasVoice && !snapshot.attachments.length) throw new Error('消息内容不能为空')
    if (next.text.length > snapshot.maxTextLength) throw new Error(`消息最多 ${snapshot.maxTextLength} 个字符`)
    if (next.text === snapshot.textContent) return
    const result = await callArkme<ArkmeRecordReeditSubmissionView>('source.record-reedit.submit', {
      sourceRef: target.sourceRef, itemUid: target.item.itemUid, newText: next.text, mentions: next.mentions,
      expectedVersion: snapshot.version, expectedDraftRevision: 0,
      attachments: snapshot.attachments.map(attachment => attachment.selection),
    }, signal)
    signal.throwIfAborted(); accepted(result)
  } }
}
