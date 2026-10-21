import type { TeamMessage, TeamTimeline } from '../team-app-contract.js'
import type { ArkmeCalendarBucketDay } from '../types.js'
import type { ConversationActivityResult } from '../conversation-activity.js'
import { quoteCanonicalText } from '../message-quote.js'
import { teamMessagePresentation } from './TeamMessageContent.js'

export const availableTeamMessage = (m: TeamMessage) => m.state === 'published' && m.contentStatus === 'available'
export function teamHistoryDate(at: number): string {
  const d = new Date(at)
  return Number.isFinite(at) && at > 0 && !Number.isNaN(d.getTime())
    ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : ''
}
export function teamHistoryText(m: TeamMessage): string {
  return [quoteCanonicalText(teamMessagePresentation(m)), ...m.media.map(media => media.name)].filter(Boolean).join('\n')
}
const sorted = (messages: Iterable<TeamMessage>) => [...messages].sort((a, b) => a.seq - b.seq)
/** Sequential, permission-checked cursor reads. Never persist messages or sealed refs. */
export async function readTeamHistory(read: (before: number, signal: AbortSignal) => Promise<TeamTimeline>, signal: AbortSignal,
  progress: (messages: TeamMessage[]) => void): Promise<TeamMessage[]> {
  let before = 0, boundary = Infinity
  const found = new Map<string, TeamMessage>()
  for (let pass = 0; pass < 2000; pass++) {
    signal.throwIfAborted()
    const page = await read(before, signal)
    signal.throwIfAborted()
    if (pass === 0) boundary = Math.max(0, ...page.messages.map(m => m.seq))
    // A later head/new message must not leak into this bounded historical read.
    for (const m of page.messages) if (m.seq <= boundary) {
      const previous = found.get(m.key)
      if (!previous || m.version >= previous.version) found.set(m.key, m)
    }
    progress(sorted(found.values()))
    if (!page.hasMore) return sorted(found.values())
    if (!Number.isSafeInteger(page.beforeSeq) || page.beforeSeq <= 0 || before > 0 && page.beforeSeq >= before || !page.messages.length) {
      throw new Error('历史消息分页异常，当前结果不完整，请重试')
    }
    before = page.beforeSeq
  }
  throw new Error('历史消息较多，当前结果尚未覆盖全部记录，需要服务端检索支持')
}
export function teamHistoryDays(messages: readonly TeamMessage[]): ArkmeCalendarBucketDay[] {
  const days = new Map<string, ArkmeCalendarBucketDay>()
  for (const m of messages) {
    const date = teamHistoryDate(m.createdAt)
    if (!availableTeamMessage(m) || !date) continue
    const day = days.get(date) ?? { bucketDate: date, count: 0, protectedCount: 0, hasRecords: true }
    day.count++; days.set(date, day)
  }
  return [...days.values()].sort((a, b) => a.bucketDate.localeCompare(b.bucketDate))
}
/** Names are labels, never identity keys. Missing identities stay unknown, not merged by nickname. */
export const teamHistoryPerson = (m: TeamMessage) => m.own ? 'self' : m.sender.personKey ? `person:${m.sender.personKey}` : 'unknown'
export function teamHistoryActivity(messages: readonly TeamMessage[]): ConversationActivityResult {
  const items = [...new Map(messages.filter(m => availableTeamMessage(m) && teamHistoryDate(m.createdAt)).map(m => [m.key, m])).values()]
  const hourly = Array.from({ length: 24 }, (_, hour) => ({ hour, weekday: null, messages: 0, systemMessages: 0, participants: 0 }))
  const weekly = Array.from({ length: 168 }, (_, i) => ({ hour: i % 24, weekday: Math.floor(i / 24) + 1, messages: 0, systemMessages: 0, participants: 0 }))
  const people = new Set<string>(), days = new Set<string>(), bins = Array.from({ length: 192 }, () => new Set<string>())
  let fromAt: number | null = null, toAt: number | null = null
  for (const m of items) {
    const d = new Date(m.createdAt), h = d.getHours(), w = ((d.getDay() || 7) - 1) * 24 + h, person = teamHistoryPerson(m)
    hourly[h]!.messages++; weekly[w]!.messages++; days.add(teamHistoryDate(m.createdAt))
    if (person !== 'unknown') { people.add(person); bins[h]!.add(person); bins[24 + w]!.add(person) }
    fromAt = fromAt === null ? m.createdAt : Math.min(fromAt, m.createdAt)
    toAt = toAt === null ? m.createdAt : Math.max(toAt, m.createdAt)
  }
  hourly.forEach((b, i) => { b.participants = bins[i]!.size })
  weekly.forEach((b, i) => { b.participants = bins[24 + i]!.size })
  return { id: 'team-local', updatedAt: Date.now(), totalMessages: items.length, systemMessages: 0,
    activeDays: days.size, participants: people.size, fromAt, toAt, hourly, weekly }
}
export function exportTeamHistory(messages: readonly TeamMessage[], title: string, now = new Date()): string {
  const items = messages.filter(availableTeamMessage)
  return [`# ${title.replace(/[\r\n]/g, ' ')} · 团队对话`, `导出时间：${now.toLocaleString()} · ${Intl.DateTimeFormat().resolvedOptions().timeZone}`,
    `共 ${items.length} 条可访问消息。附件仅列出文件名，不包含文件或访问凭据。`,
    ...items.map(m => [`## ${m.own ? '我' : m.sender.nickname.replace(/[\r\n]/g, ' ')} · ${teamHistoryDate(m.createdAt) ? new Date(m.createdAt).toLocaleString() : '时间未提供'}`,
      m.content?.text_content ?? '', ...m.media.map(media => `[附件：${media.name.replace(/[\r\n]/g, ' ')}]`)].join('\n\n'))].join('\n\n') + '\n'
}
