/** Audio wire fixtures. They deliberately do not accept the retired day/number DTO. */
export const recordingId = '123456789012345678901234'
export const childId = '234567890123456789012345'
export const recordingRevision = 'a'.repeat(64)
export const speakerReference = 'speaker:bbbbbbbbbbbbbbbb'
export const emptyCoverage = { ready_count: 0, processing_count: 0, failed_count: 0, silent_count: 0, candidate_count: 0 }
export interface OwnerTestUtterance {
  text: string; start?: number; end?: number; ordinal?: number; childId?: string
  event?: string; background?: boolean
  speaker?: { reference?: string; kind?: string; label?: string; user_id?: number }
}
export interface OwnerTestRecording {
  captureState?: 'receiving' | 'complete' | 'interrupted'
  startAt: number; duration?: number; id?: string; revision?: string
  items: OwnerTestUtterance[]; enhanced?: OwnerTestUtterance[]
  coverage?: Partial<typeof emptyCoverage>; enhancedCoverage?: Partial<typeof emptyCoverage>
}
export function recordingOwnerResponse(path: string, body: Record<string, unknown>, recordings: OwnerTestRecording[]): Record<string, unknown> | undefined {
  if (path.endsWith('/recordings/query')) {
    const offset = Number(body.page_cursor ?? 0), limit = Number(body.limit ?? 50)
    const selected = recordings.slice(offset, offset + limit)
    return { items: selected.map(row => ({ status: 'available', recording_uid: row.id ?? recordingId, start_at: row.startAt,
      end_at: row.startAt + (row.duration ?? 10_000), duration_ms: row.duration ?? 10_000, owner_version: 1, capture_state: row.captureState,
    })), has_more: offset + limit < recordings.length,
    ...(offset + limit < recordings.length ? { next_page_cursor: String(offset + limit) } : {}) }
  }
  if (!path.endsWith('/recordings/transcript/query')) return undefined
  const row = recordings.find(value => (value.id ?? recordingId) === body.recording_uid)
  if (row === undefined) return { status: 'unavailable' }
  const enhanced = body.source === 'enhanced'
  const items = enhanced ? row.enhanced ?? [] : row.items
  const fragments = items.flatMap((item, index) => {
    const chars = Array.from(item.text)
    return Array.from({ length: Math.ceil(chars.length / 4_000) }, (_, part) => ({
      utterance_index: index, clip_locator: { child_id: item.childId ?? childId, source: body.source, ordinal: item.ordinal ?? index },
      start_offset_ms: item.start ?? index * 2_000, end_offset_ms: item.end ?? (item.start ?? index * 2_000) + 1_000,
      text: chars.slice(part * 4_000, (part + 1) * 4_000).join(''), text_start_offset: part * 4_000,
      text_end_offset: Math.min((part + 1) * 4_000, chars.length), text_total_length: chars.length,
      ...(chars.length > 4_000 ? { text_truncated: true } : {}), event: item.event ?? '', is_background: item.background ?? false,
      identity: { reference: speakerReference, kind: 'named', label: '我', user_id: 42, ...item.speaker },
    }))
  })
  const offset = Number(body.page_cursor ?? 0), selected = [] as typeof fragments
  let chars = 0
  for (const fragment of fragments.slice(offset, offset + Number(body.limit ?? 100))) {
    chars += Array.from(fragment.text).length
    if (chars > 20_000) break
    selected.push(fragment)
  }
  const more = offset + selected.length < fragments.length
  return { status: 'available', recording_uid: row.id ?? recordingId, start_at: row.startAt, revision: row.revision ?? recordingRevision,
    coverage: { ...emptyCoverage, ready_count: items.length > 0 ? 1 : 0, ...(enhanced ? row.enhancedCoverage : row.coverage) },
    speakers: selected.map(item => item.identity),
    utterances: selected.map(({ identity: _, ...item }, index) => ({ ...item, speaker_index: index })),
    has_more: more, ...(more ? { next_page_cursor: String(offset + selected.length) } : {}),
  }
}
