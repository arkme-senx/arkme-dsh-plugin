import { useEffect, useState } from 'react'
import { callArkme } from './api.js'

export type DocumentedDayMarkers = { chat?: boolean; call?: boolean; recording?: boolean; arko?: boolean; bot?: boolean }

function objectValue(value: unknown): Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {} }
function listValue(value: unknown): unknown[] { return Array.isArray(value) ? value : [] }
function stringValue(value: unknown): string { return typeof value === 'string' ? value.trim() : '' }
function numberValue(value: unknown): number { return typeof value === 'number' && Number.isFinite(value) ? value : Number(value) || 0 }
function dateOf(item: Record<string, unknown>, timezone: string): string {
  const value = stringValue(item.date ?? item.bucket_date ?? item.bucketDate)
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const stamp = numberValue(item.date_stamp ?? item.dateStamp ?? item.start_at ?? item.startAt)
  if (!stamp) return ''
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(stamp)).map(part => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}
function responseItems(value: unknown): Record<string, unknown>[] {
  const raw = objectValue(value), data = Object.keys(objectValue(raw.data)).length ? objectValue(raw.data) : raw
  return listValue(data.daily_data ?? data.dailyData ?? data.days).map(objectValue)
}

export function useDocumentedDayMonth(accountScope: string, visibleMonth: Date, timezone: string, enabled = true, revision = 0): { markers: Map<string, DocumentedDayMarkers>; loading: boolean; partial: boolean } {
  const [state, setState] = useState<{ key: string; markers: Map<string, DocumentedDayMarkers>; loading: boolean; partial: boolean }>({ key: '', markers: new Map(), loading: false, partial: false })
  const year = visibleMonth.getFullYear(), month = visibleMonth.getMonth()
  const startDate = `${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}-01`
  const next = new Date(year, month + 1, 1)
  const endDate = `${String(next.getFullYear()).padStart(4, '0')}-${String(next.getMonth() + 1).padStart(2, '0')}-01`
  const key = `${accountScope}:${startDate}:${timezone}:${revision}`
  useEffect(() => {
    if (!enabled || !accountScope) return
    const controller = new AbortController()
    setState({ key, markers: new Map(), loading: true, partial: false })
    const sources: Array<[keyof DocumentedDayMarkers, 'chat' | 'call' | 'arko' | 'bot']> = [['chat', 'chat'], ['call', 'call'], ['arko', 'arko'], ['bot', 'bot']]
    const read = async (source: 'chat' | 'call' | 'arko' | 'bot') => await callArkme('calendar.activity', { source, mode: 'buckets', body: { start_date: startDate, end_date: endDate, timezone, filters: source === 'chat' ? { conversation_types: ['private', 'group'], relation_types: ['sent', 'received', 'mentioned_me', 'replied_to_me'] } : undefined } }, controller.signal)
    void Promise.allSettled(sources.map(async ([marker, source]) => ({ marker, value: await read(source) }))).then(results => {
      if (controller.signal.aborted) return
      const markers = new Map<string, DocumentedDayMarkers>(); let partial = false
      for (const result of results) {
        if (result.status === 'rejected') { partial = true; continue }
        for (const item of responseItems(result.value.value)) {
          const date = dateOf(item, timezone); const count = numberValue(item.count ?? item.message_count ?? item.total)
          if (!date || count <= 0 && item.has_items !== true && item.hasRecords !== true) continue
          const current = markers.get(date) ?? {}; current[result.value.marker] = true; markers.set(date, current)
        }
      }
      setState({ key, markers, loading: false, partial })
    })
    return () => controller.abort()
  }, [accountScope, endDate, enabled, key, startDate, timezone])
  return enabled && state.key === key ? state : { markers: new Map(), loading: enabled && !!accountScope, partial: false }
}
