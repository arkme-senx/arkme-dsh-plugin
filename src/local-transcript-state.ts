import { createHash } from 'node:crypto'
import { readMessageQuote, quoteCanonicalText, quoteMatchesCanonical, quoteSourceContent } from './message-quote.js'
import type { MessageUnderline, MessageUnderlineChange } from './message-annotations.js'

export interface LocalTranscriptEntry { revision: number; original: string; text: string; marks: MessageUnderline[] }
export interface LocalTranscriptChange { id: string; original: string; expectedRevision: number; text?: string; mark?: MessageUnderlineChange; restore?: boolean }
export function changeLocalTranscript(previous: LocalTranscriptEntry | undefined, change: LocalTranscriptChange, userId: number): LocalTranscriptEntry {
  if (!change || typeof change.id !== 'string' || !change.id || change.id.length > 2048
    || typeof change.original !== 'string' || change.original.length > 100000
    || !Number.isSafeInteger(change.expectedRevision) || change.expectedRevision < 0
    || [change.text !== undefined, change.mark !== undefined, change.restore === true].filter(Boolean).length !== 1) throw new Error('转写更正参数无效')
  if ((previous?.revision ?? 0) !== change.expectedRevision) throw new Error('本机转写已更新，请重新选择后重试')
  if (previous && previous.original !== change.original && !change.restore) throw new Error('云端原文已更新，请先恢复原文，再重新更正')
  const current = previous ?? { revision: 0, original: change.original, text: change.original, marks: [] }
  if (change.restore) return { revision: current.revision + 1, original: change.original, text: change.original, marks: current.marks }
  if (change.text !== undefined) {
    if (typeof change.text !== 'string' || !change.text.trim() || change.text.length > 100000) throw new Error('转写文字不能为空或超过长度限制')
    return { ...current, revision: current.revision + 1, text: change.text }
  }
  const mark = change.mark!
  if (mark.kind !== 'add' && mark.kind !== 'remove') throw new Error('标记参数无效')
  if (typeof mark.operationId !== 'string' || !/^[a-zA-Z0-9._:-]{1,128}$/.test(mark.operationId)) throw new Error('标记参数无效')
  if (mark.kind === 'remove') return { ...current, revision: current.revision + 1, marks: current.marks.filter(m => m.id !== mark.annotationId) }
  const anchor = readMessageQuote(mark.anchor)
  const source = { title: '', textContent: current.text, textFormat: 'plain' as const }
  const digest = createHash('sha256').update(quoteSourceContent(source)).digest('hex')
  if (!anchor || anchor.sourceDigest !== digest || !quoteMatchesCanonical(anchor, quoteCanonicalText(source))) throw new Error('转写已变化，请重新选择文字')
  if (current.marks.length >= 500) throw new Error('这一段标记过多，请先取消部分标记')
  if (current.marks.some(m => m.id === mark.operationId)) return current
  return { ...current, revision: current.revision + 1, marks: [...current.marks, { id: mark.operationId, actorId: userId, actorName: '你', mine: true, anchor, state: 'available' }] }
}
