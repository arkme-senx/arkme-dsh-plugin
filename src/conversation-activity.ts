import { assertConversationWordsEnvelope, wordObject, wordText, type ConversationWordsQuery } from './conversation-word-frequency.js'

export interface ConversationActivityBucket { hour: number; weekday: number | null; messages: number; systemMessages: number; participants: number }
export interface ConversationActivityResult {
  id: string; updatedAt: number; fromAt: number | null; toAt: number | null
  totalMessages: number; systemMessages: number; activeDays: number; participants: number
  hourly: ConversationActivityBucket[]; weekly: ConversationActivityBucket[]
}
export interface ConversationActivityState {
  supported: boolean; stale: boolean; result: ConversationActivityResult | null
  progress: { completed: number; total: number } | null
}
export interface ConversationActivitySelection { hour: number; weekday: number | null }
export const activityKinds = ['text', 'image', 'voice', 'video', 'file', 'call', 'mixed', 'card', 'system', 'other'] as const
export interface ConversationActivityMessage {
  key: string; sourceRef: string | null; senderName: string; preview: string; sentAt: number
  kind: typeof activityKinds[number]
}
export interface ConversationActivityMessages { items: ConversationActivityMessage[]; total: number; nextCursor: string | null }
const invalid = (): never => { throw new Error('活跃时间数据不完整或范围不匹配，请重试') }
const count = (v: unknown): number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : invalid()
export const unavailableConversationActivity = (): ConversationActivityState => ({ supported: false, stale: false, result: null, progress: null })
export function parseActivitySelection(value: unknown): ConversationActivitySelection {
  const v = wordObject(value), hour = count(v.hour), weekday = v.weekday === null ? null : count(v.weekday)
  if (hour > 23 || (weekday !== null && (weekday < 1 || weekday > 7))) invalid()
  return { hour, weekday }
}
export function assertActivityEnvelope(v: Record<string, unknown>, q: ConversationWordsQuery, sessionUid: string) {
  assertConversationWordsEnvelope(v, q, sessionUid, 'conversation_activity')
}
function parseBuckets(value: unknown, weekly: boolean): ConversationActivityBucket[] {
  if (!Array.isArray(value) || value.length !== (weekly ? 168 : 24)) invalid()
  const buckets = (value as unknown[]).map(item => {
    const v = wordObject(item), selection = parseActivitySelection(v)
    if (weekly !== (selection.weekday !== null)) invalid()
    const messages = count(v.messages), systemMessages = count(v.systemMessages), participants = count(v.participants)
    if (systemMessages > messages || participants > messages - systemMessages) invalid()
    return { ...selection, messages, systemMessages, participants }
  })
  if (new Set(buckets.map(b => `${b.weekday}:${b.hour}`)).size !== buckets.length) invalid()
  return buckets.sort((a, b) => (a.weekday ?? 0) - (b.weekday ?? 0) || a.hour - b.hour)
}
export function parseConversationActivity(value: unknown, q: ConversationWordsQuery, sessionUid: string): ConversationActivityState {
  const v = wordObject(value); assertActivityEnvelope(v, q, sessionUid)
  if (typeof v.stale !== 'boolean') invalid()
  let result: ConversationActivityResult | null = null
  if (v.result !== null) {
    const r = wordObject(v.result)
    if (r.corpus !== 'authorized_conversation_messages' || r.time_basis !== 'message_sent_at' || r.message_types !== 'all' || r.deduplication !== 'message_uid') invalid()
    const totalMessages = count(r.totalMessages), systemMessages = count(r.systemMessages), activeDays = count(r.activeDays), participants = count(r.participants)
    const hourly = parseBuckets(r.hourly, false), weekly = parseBuckets(r.weekly, true)
    if (systemMessages > totalMessages || activeDays > totalMessages || participants > totalMessages - systemMessages
      || (totalMessages > 0 && activeDays === 0) || (q.sender !== 'all' && systemMessages !== 0)) invalid()
    for (const bins of [hourly, weekly]) {
      if (bins.reduce((n, b) => n + b.messages, 0) !== totalMessages || bins.reduce((n, b) => n + b.systemMessages, 0) !== systemMessages
        || bins.some(b => b.participants > participants) || bins.reduce((n, b) => n + b.participants, 0) < participants) invalid()
    }
    for (const h of hourly) {
      const days = weekly.filter(b => b.hour === h.hour)
      if (days.reduce((n, b) => n + b.messages, 0) !== h.messages || days.reduce((n, b) => n + b.systemMessages, 0) !== h.systemMessages
        || days.some(b => b.participants > h.participants) || days.reduce((n, b) => n + b.participants, 0) < h.participants) invalid()
    }
    const fromAt = r.fromAt === null ? null : count(r.fromAt), toAt = r.toAt === null ? null : count(r.toAt)
    if (totalMessages === 0 ? fromAt !== null || toAt !== null : fromAt === null || toAt === null || fromAt <= 0 || fromAt > toAt) invalid()
    result = { id: wordText(r.id), updatedAt: count(r.updatedAt), fromAt, toAt, totalMessages, systemMessages, activeDays, participants, hourly, weekly }
  }
  let progress: ConversationActivityState['progress'] = null
  if (v.progress !== null) {
    const p = wordObject(v.progress); progress = { completed: count(p.completed), total: count(p.total) }
    if (progress.completed > progress.total) invalid()
  }
  if (!result && !progress) invalid()
  return { supported: true, stale: v.stale as boolean, result, progress }
}
/** Validate the message's actual local time, not its upload/sync time. */
export function activityMessageMatches(at: number, q: ConversationWordsQuery, selection: ConversationActivitySelection): boolean {
  if (!Number.isSafeInteger(at) || at <= 0) return false
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: q.timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', weekday: 'short' }).formatToParts(at)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)?.value ?? ''
  const date = `${part('year')}-${part('month')}-${part('day')}`
  const weekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(part('weekday')) + 1
  return Number(part('hour')) === selection.hour && (selection.weekday === null || weekday === selection.weekday)
    && (q.fromDate === null || date >= q.fromDate) && (q.toDate === null || date <= q.toDate)
}
export function parseActivityMessages(value: unknown, q: ConversationWordsQuery, sessionUid: string, resultId: string, selection: ConversationActivitySelection): ConversationActivityMessages {
  const v = wordObject(value); assertActivityEnvelope(v, q, sessionUid)
  if (v.result_id !== resultId || v.hour !== selection.hour || v.weekday !== selection.weekday || !Array.isArray(v.items) || v.items.length > 50) invalid()
  const items = (v.items as unknown[]).map(item => {
    const m = wordObject(item), kind = m.kind as ConversationActivityMessage['kind'], sentAt = count(m.sentAt)
    if (!activityKinds.includes(kind) || !activityMessageMatches(sentAt, q, selection) || (kind === 'system' && q.sender !== 'all') || typeof m.preview !== 'string' || m.preview.length > 20000) invalid()
    return { key: wordText(m.key), sourceRef: m.sourceRef === null ? null : wordText(m.sourceRef, 4096), senderName: wordText(m.senderName), preview: m.preview as string, sentAt, kind }
  })
  const total = count(v.total)
  if (items.length > total || new Set(items.map(i => i.key)).size !== items.length) invalid()
  return { items, total, nextCursor: v.next_cursor === null ? null : wordText(v.next_cursor, 4096) }
}
