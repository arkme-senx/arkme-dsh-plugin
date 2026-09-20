import { dayActivityDisplayName, dayActivityTime, type DayActivityEntry, type DayActivityExcerpt } from './calendar-activity-model.js'
import { tr } from './locale.js'

export const isDayConversation = (entry: DayActivityEntry) => ['private_chat', 'group_chat', 'arko', 'bot', 'dsh'].includes(entry.kind)

/** Only rank existing text. Short acknowledgements remain in detail, and are used if nothing else exists. */
const acknowledgement = /^(?:好[的啊吧]?|嗯[嗯好]?|收到|明白[了]?|了解[了]?|谢谢[了]?|感谢|是的|对[的啊]?|继续|测试\d*|ok(?:ay)?|yes|no|thanks|thank you|continue|test)[\s.!！。?？~～]*$/i
function score(entry: DayActivityEntry): number {
  const text = entry.preview.trim()
  if (!text || acknowledgement.test(text)) return 0
  return Math.min(text.length, 100) + (/\[(?:文件|图片|语音|视频)\]/.test(text) ? 15 : 0)
}

export function selectDayActivityExcerpts(members: readonly DayActivityEntry[]): DayActivityExcerpt[] {
  const candidates = members.filter(entry => entry.access === 'available' && entry.participation !== 'background' && entry.preview.trim())
    .sort((a, b) => score(b) - score(a) || b.startAtMillis - a.startAtMillis || a.id.localeCompare(b.id))
  const first = candidates[0]
  if (!first) return []
  const self = (entry: DayActivityEntry) => entry.participation === 'self'
  const alternatives = candidates.filter(entry => entry.id !== first.id && entry.preview.trim() !== first.preview.trim() && score(entry) > 0)
  // Prefer the other side of a meaningful exchange, without fabricating a reply relationship.
  const second = alternatives.find(entry => self(entry) !== self(first)) ?? alternatives[0]
  return [first, ...(second ? [second] : [])].sort((a, b) => a.startAtMillis - b.startAtMillis || a.id.localeCompare(b.id))
    .map(entry => ({ id: entry.id, text: entry.preview.trim(), self: self(entry), ...(entry.previewAuthor ? { author: entry.previewAuthor } : {}) }))
}

export function dayExcerptAuthor(entry: DayActivityEntry, excerpt: DayActivityExcerpt): string {
  if (excerpt.self) return tr('我')
  if (excerpt.author?.name || excerpt.author?.remark) return dayActivityDisplayName(excerpt.author)
  if (entry.kind === 'private_chat') return tr('对方')
  if (entry.kind === 'arko') return 'Arko'
  if (entry.kind === 'bot') return 'Bot'
  if (entry.kind === 'group_chat') return tr('群成员')
  return ''
}

export function dayActivityMetadata(entry: DayActivityEntry, timezone: string, dayStart: number, dayEnd: number): string {
  const parts: string[] = []
  if (entry.startAtMillis < dayStart) parts.push(tr('始于前一天'))
  if (entry.endAtMillis > dayEnd) parts.push(tr('延续至下一天'))
  const start = dayActivityTime(Math.max(entry.startAtMillis, dayStart), timezone)
  const end = dayActivityTime(Math.min(entry.endAtMillis, dayEnd), timezone)
  // The left gutter already carries the start. Avoid ranges like 17:20–17:20.
  if (start !== end) parts.push(`${start}–${end}`)
  if (entry.kind === 'call' && entry.statusLabel) parts.push(entry.statusLabel)
  if (entry.kind === 'recording') {
    const seconds = Math.max(0, Math.round((Math.min(entry.endAtMillis, dayEnd) - Math.max(entry.startAtMillis, dayStart)) / 1000))
    const duration = seconds >= 3600 ? tr('{v0}小时{v1}分', { v0: Math.floor(seconds / 3600), v1: Math.floor(seconds / 60) % 60 })
      : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
    parts.push(tr('录音 {v0}', { v0: duration }))
  } else if (isDayConversation(entry)) {
    parts.push(tr('{v0} 条相关消息', { v0: entry.recordCount }))
  }
  return parts.join(' · ')
}
