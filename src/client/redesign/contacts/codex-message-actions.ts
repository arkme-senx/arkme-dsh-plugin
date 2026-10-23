import type { TeamCodexEvent, TeamCodexTask } from '../../../team-codex-contract.js'
import type { NativeChatSelectionSnapshot } from '../../../native-chat-selection-contract.js'
import { codexPromptText } from '../../../team-codex-prompt-text.js'
import type { ArkmeSourceItem, ArkmeSourceSendResult } from '../../../types.js'
import { callArkme } from '../../api.js'

export const codexEventKey = (event: TeamCodexEvent) => event.eventId ?? `${event.turnId}:${event.kind}:${event.sequence}`
export const codexSelectable = (event: TeamCodexEvent) => event.kind !== 'Interrupt' && !event.truncated && !!event.text.trim()
export interface CodexSelectionSnapshot extends NativeChatSelectionSnapshot { taskTitle: string; inputName: string }
export function codexSelectionSnapshot(teamRef: string, task: TeamCodexTask, events: TeamCodexEvent[], keys: Set<string>): CodexSelectionSnapshot {
  if (!keys.size || keys.size > 100) throw new Error('请选择 1 至 100 条消息')
  const selected = events.filter(event => keys.has(codexEventKey(event))).sort((a,b) => a.sequence-b.sequence)
  if (selected.length !== keys.size || selected.some(event => !codexSelectable(event))) throw new Error('所选消息已变化或正文不完整，请重新选择')
  const messages = selected.map(event => ({ key: codexEventKey(event), anchorSeq: event.sequence, role: event.kind === 'UserPromptSubmit' ? 'user' as const : 'assistant' as const,
    text: event.kind === 'UserPromptSubmit' ? codexPromptText(event.text) : event.text, createdAtMillis: event.at }))
  if (messages.some((message, i) => !message.text.trim() || !Number.isSafeInteger(message.anchorSeq) || message.anchorSeq < 0 || (i > 0 && message.anchorSeq <= messages[i-1]!.anchorSeq) || !Number.isSafeInteger(message.createdAtMillis) || message.createdAtMillis <= 0)) throw new Error('所选消息来源不完整，请重新选择')
  const bytes = messages.map(message => new TextEncoder().encode(message.text).byteLength)
  if (bytes.some(size => size > 256*1024) || bytes.reduce((sum,size) => sum+size,0) > 8*1024*1024) throw new Error('所选内容超过大小限制，请减少消息')
  return { sessionId: JSON.stringify([teamRef, task.cloud?.sourceId ?? task.installationId ?? 'local', task.id]), taskTitle: task.title, inputName: task.member.displayName, messages }
}

export function codexQuoteNote(input: string, quote: { text: string; title: string; sender: string; at: number }): string {
  return `${input.trim()}\n\n引用 · Codex · ${quote.title}\n${quote.sender} · ${new Date(quote.at).toLocaleString('zh-CN')}\n${quote.text.split(/\r?\n/u).map(line => `> ${line}`).join('\n')}`
}
/** One note, immutable content and stable ID across ambiguous network retries. */
export function codexSelfDelivery(expectedUserId: number, content: string, recordUid = crypto.randomUUID()) {
  let result: ArkmeSourceSendResult | undefined
  return async (signal: AbortSignal) => {
    signal.throwIfAborted()
    if (result) return result
    const target = await callArkme<ArkmeSourceItem>('sources.self-target', {}, signal)
    if (target.kind !== 'send_to_self') throw new Error('发给自己入口暂不可用')
    const next = await callArkme<ArkmeSourceSendResult>('source.send-text', { sourceRef: target.sourceRef, expectedUserId, recordUid, textContent: content }, signal)
    if (next.itemUid !== recordUid || next.localState !== 'synced') throw new Error(next.localState === 'failed' ? '发送失败，输入已保留，请重试' : '发送结果待核对，请使用原内容重试')
    result = next; return next
  }
}
