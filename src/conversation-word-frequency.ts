/** Chat-owned aggregation, not a count over the visible client message page. */
export interface ConversationWordsQuery {
  accountScope: string; sourceRef: string; timezone: string
  fromDate: string | null; toDate: string | null
  sender: 'all' | 'self' | 'peer' | string
}
export interface ConversationWord { key: string; text: string; count: number; messageCount: number }
export interface ConversationWordsResult {
  id: string; updatedAt: number; fromAt: number | null; toAt: number | null
  analyzedMessages: number; eligibleMessages: number; excludedMessages: number; voiceTranscriptMessages: number
  words: ConversationWord[]
}
export interface ConversationWordsState {
  supported: boolean; stale: boolean; result: ConversationWordsResult | null
  job: { id: string; status: 'queued' | 'processing' | 'failed'; completed: number; total: number } | null
}
export interface ConversationWordParticipant { ref: string; name: string; isSelf: boolean; former: boolean }
export interface ConversationWordParticipants { items: ConversationWordParticipant[]; nextCursor: string | null }
export interface ConversationWordMessage {
  key: string; sourceRef: string | null; senderName: string; text: string; sentAt: number; count: number; basis: 'text' | 'voice_transcript'
}
export interface ConversationWordMessages { items: ConversationWordMessage[]; total: number; nextCursor: string | null }

const invalid = (): never => { throw new Error('对话分析数据不完整或范围不匹配，请刷新后重试') }
export const wordObject = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : invalid()
export const wordText = (v: unknown, max = 512): string => typeof v === 'string' && v.trim() && v.length <= max ? v : invalid()
const number = (v: unknown): number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : invalid()
const boolean = (v: unknown): boolean => typeof v === 'boolean' ? v : invalid()
const array = (v: unknown, max: number): unknown[] => Array.isArray(v) && v.length <= max ? v : invalid()
const cursor = (v: unknown): string | null => v === null ? null : wordText(v, 4096)
function date(v: unknown): string | null {
  if (v === null) return null
  const s = wordText(v, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || new Date(`${s}T12:00:00Z`).toISOString().slice(0, 10) !== s) invalid()
  return s
}
export function parseConversationWordsQuery(input: unknown): ConversationWordsQuery {
  const v = wordObject(input), timezone = wordText(v.timezone, 100), fromDate = date(v.fromDate), toDate = date(v.toDate)
  new Intl.DateTimeFormat('en', { timeZone: timezone }).format(0)
  if ((fromDate === null) !== (toDate === null) || (fromDate && toDate && fromDate > toDate)) invalid()
  return { accountScope: wordText(v.accountScope, 100), sourceRef: wordText(v.sourceRef, 10000), timezone, fromDate, toDate, sender: wordText(v.sender, 4096) }
}
export function conversationWordsEnvelope(q: ConversationWordsQuery, sessionUid: string, scope: 'conversation_words' | 'conversation_activity' = 'conversation_words') {
  return { schema_version: 1, scope, chat_session_uid: sessionUid, time_zone: q.timezone,
    from_date: q.fromDate, to_date: q.toDate, sender: q.sender }
}
export function assertConversationWordsEnvelope(v: Record<string, unknown>, q: ConversationWordsQuery, sessionUid: string, scope: 'conversation_words' | 'conversation_activity' = 'conversation_words') {
  const expected = conversationWordsEnvelope(q, sessionUid, scope)
  if (Object.entries(expected).some(([k, value]) => v[k] !== value)) invalid()
}
export const unavailableConversationWords = (): ConversationWordsState => ({ supported: false, stale: false, result: null, job: null })
export function parseConversationWordsState(value: unknown, q: ConversationWordsQuery, sessionUid: string): ConversationWordsState {
  const v = wordObject(value); assertConversationWordsEnvelope(v, q, sessionUid)
  let result: ConversationWordsResult | null = null, job: ConversationWordsState['job'] = null
  if (v.result !== null) {
    const r = wordObject(v.result)
    if (r.corpus !== 'authorized_conversation_messages' || r.quote_policy !== 'authored_body_only') invalid()
    const words = array(r.words, 5000).map(value => { const w = wordObject(value)
      const count = number(w.count), messageCount = number(w.messageCount)
      if (!count || !messageCount || messageCount > count) invalid()
      return { key: wordText(w.key), text: wordText(w.text, 100), count, messageCount }
    })
    const analyzedMessages = number(r.analyzedMessages), eligibleMessages = number(r.eligibleMessages)
    if (analyzedMessages > eligibleMessages || words.some(w => w.messageCount > analyzedMessages) || new Set(words.map(w => w.key)).size !== words.length) invalid()
    const fromAt = r.fromAt === null ? null : number(r.fromAt), toAt = r.toAt === null ? null : number(r.toAt)
    if ((fromAt === null) !== (toAt === null) || (fromAt !== null && toAt !== null && fromAt > toAt)) invalid()
    const voiceTranscriptMessages = number(r.voiceTranscriptMessages)
    if (voiceTranscriptMessages > analyzedMessages) invalid()
    result = { id: wordText(r.id), updatedAt: number(r.updatedAt), fromAt, toAt, analyzedMessages, eligibleMessages,
      excludedMessages: number(r.excludedMessages), voiceTranscriptMessages, words }
  }
  if (v.job !== null) {
    const j = wordObject(v.job), status = j.status as NonNullable<ConversationWordsState['job']>['status']
    if (!['queued', 'processing', 'failed'].includes(status)) invalid()
    job = { id: wordText(j.id), status, completed: number(j.completed), total: number(j.total) }
    if (job.completed > job.total) invalid()
  }
  return { supported: true, stale: boolean(v.stale), result, job }
}
export function parseConversationWordParticipants(value: unknown, q: ConversationWordsQuery, sessionUid: string, scope: 'conversation_words' | 'conversation_activity' = 'conversation_words'): ConversationWordParticipants {
  const v = wordObject(value); assertConversationWordsEnvelope(v, q, sessionUid, scope)
  const items = array(v.items, 50).map(value => { const p = wordObject(value), ref = wordText(p.ref, 4096)
    if (['all', 'self', 'peer'].includes(ref)) invalid()
    return { ref, name: wordText(p.name), isSelf: boolean(p.isSelf), former: boolean(p.former) }
  })
  if (new Set(items.map(p => p.ref)).size !== items.length) invalid()
  return { items, nextCursor: cursor(v.next_cursor) }
}
export function parseConversationWordMessages(value: unknown, q: ConversationWordsQuery, sessionUid: string, resultId: string, wordKey: string): ConversationWordMessages {
  const v = wordObject(value); assertConversationWordsEnvelope(v, q, sessionUid)
  if (v.result_id !== resultId || v.word_key !== wordKey) invalid()
  const items = array(v.items, 50).map(value => { const m = wordObject(value), basis = m.basis as ConversationWordMessage['basis']
    if (!['text', 'voice_transcript'].includes(basis) || !number(m.count) || !number(m.sentAt)) invalid()
    return { key: wordText(m.key), sourceRef: cursor(m.sourceRef), senderName: wordText(m.senderName), text: wordText(m.text, 20000), sentAt: number(m.sentAt), count: number(m.count), basis }
  })
  const total = number(v.total)
  if (items.length > total || new Set(items.map(m => m.key)).size !== items.length) invalid()
  return { items, total, nextCursor: cursor(v.next_cursor) }
}
