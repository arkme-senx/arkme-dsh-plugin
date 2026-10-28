import { createHash } from 'node:crypto'
import type { ArkmeArrangementEvidence } from './types.js'
import { objectValue, stringValue } from './services/service.js'
import { validRecordingSourceDay } from './arrangement-recording-source.js'

export interface ArrangementEvidenceData {
  id: string; kind: string; role: string; text: string
  persisted?: boolean
  [key: string]: unknown
}
const kinds = new Set(['record', 'audio_summary', 'call', 'input', 'voice_input', 'agent', 'manual'])
export const sourceDigest = (value: string) => createHash('sha256').update(value).digest('hex')
const rows = (value: unknown) => Array.isArray(value) ? value.map(objectValue) : []
export function arrangementEvidence(item: Record<string, unknown>, recovered?: ArrangementEvidenceData): ArrangementEvidenceData[] {
  const provenance = objectValue(item.source_provenance)
  const saved = provenance.version === 1 && Array.isArray(provenance.items) ? rows(provenance.items).filter(e => kinds.has(stringValue(e.kind))).map(e => ({ ...e,
    id: stringValue(e.id) || sourceDigest(JSON.stringify(e)), kind: stringValue(e.kind), role: e.role === 'supplement' ? 'supplement' : 'initial', text: stringValue(e.text), persisted: true,
  })) : []
  const kind = ({ 1: 'manual', 2: 'record', 3: 'input', 4: 'agent', 5: 'audio_summary', 6: 'call' } as Record<number, string>)[Number(item.source_type)] ?? 'input'
  const sources = rows(item.source_items)
  const inputs = sources.length ? sources : stringValue(item.source_text) ? [{ text: item.source_text }] : []
  const result: ArrangementEvidenceData[] = saved.length ? saved : recovered ? [{ ...recovered, persisted: false }] : inputs.map((e, i) => ({ ...e, id: `legacy-input-${i}`, kind, role: 'initial', text: stringValue(e.text), persisted: false }))
  const legacySummary = objectValue(item.recording_source)
  if (!saved.length && !recovered && kind === 'audio_summary' && legacySummary.kind === 'daily-summary' && stringValue(legacySummary.summary_id) && validRecordingSourceDay(legacySummary.date_stamp, legacySummary.tz_offset)) {
    result.splice(0, result.length, {id: sourceDigest(`summary:${legacySummary.summary_id}:${item.uid}`), kind, role:'initial', text:inputs.map(e=>stringValue(e.text)).join('\n'), summary_id:legacySummary.summary_id, date_stamp:legacySummary.date_stamp, tz_offset:legacySummary.tz_offset})
  }
  // A historical relation proves association, not that it caused recognition.
  const records = rows(item.related_records)
  const uids = new Set([...records.map(r => stringValue(r.uid)), ...(Array.isArray(item.record_uids) ? item.record_uids.map(stringValue) : [])].filter(Boolean))
  for (const uid of uids) {
    if (result.some(e => e.record_uid === uid)) continue
    const r = records.find(r => r.uid === uid)
    result.push({ id: sourceDigest(`record:${uid}`), kind: 'record', role: 'related', text: stringValue(r?.text_content), record_uid: uid, occurred_at: r?.create_at })
  }
  if (!result.length) result.push({ id: 'legacy-origin', kind, role: 'initial', text: '', pending_detail: kind === 'record' && !Array.isArray(item.related_records) })
  return result
}
export function projectEvidence(e: ArrangementEvidenceData): ArkmeArrangementEvidence {
  const validDay = validRecordingSourceDay(e.date_stamp, e.tz_offset)
  const canOpen = e.kind === 'record' ? !!e.record_uid : e.kind === 'call' ? !!e.room_id : e.kind === 'audio_summary' ? !!e.summary_id && validDay : e.kind === 'agent' ? !!e.agent_session_id && !!e.agent_message_id : false
  return { id: e.id, kind: e.kind as ArkmeArrangementEvidence['kind'], role: e.role as ArkmeArrangementEvidence['role'], text: e.text, canOpen,
    ...(e.persisted && ['record', 'audio_summary', 'call', 'agent'].includes(e.kind) ? { readOnExpand: true } : {}),
    ...(e.kind === 'audio_summary' && validDay ? { sourceDate: new Date(Number(e.date_stamp) + Number(e.tz_offset)).toISOString().slice(0,10) } : {}),
    ...(typeof e.occurred_at === 'number' && e.occurred_at > 0 ? { createdAtMillis: e.occurred_at } : {}),
    ...(!canOpen && !['input', 'manual', 'voice_input'].includes(e.kind) ? { unavailableReason: e.pending_detail ? '展开查看来源' : '历史记录未保存定位信息' } : {}),
  }
}
export function exactSummaryEvidence(item: Record<string, unknown>, summaries: Record<string, unknown>[]): ArrangementEvidenceData | undefined {
  if (item.source_type !== 5 || !stringValue(item.uid).startsWith('asumarr:')) return undefined
  const quote = stringValue(item.source_text) || rows(item.source_items).map(e => stringValue(e.text)).join('\n')
  if (!quote.trim()) return undefined
  const found = summaries.filter(s => {
    const id=stringValue(s.id); const answer=stringValue(s.answer)
    return id && validRecordingSourceDay(s.date_stamp,s.tz_offset) && answer.includes(quote) && item.uid === `asumarr:${sourceDigest(id).slice(0,8)}:${sourceDigest(`${id}\n${stringValue(item.title)}\n${quote}\n${Number(item.due_at)||0}`).slice(0,16)}`
  })
  const unique = [...new Map(found.map(s => [stringValue(s.id), s])).values()]
  if (unique.length !== 1) return undefined
  const s=unique[0]!
  return { id: sourceDigest(`summary:${s.id}:${item.uid}`), kind:'audio_summary', role:'initial', text:quote,
    summary_id:s.id, date_stamp:s.date_stamp, tz_offset:s.tz_offset, recovery:'exact_uid_and_quote' }
}
