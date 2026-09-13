import { describe, expect, it, vi } from 'vitest'
import { RecordingReadOwner, type RecordingReadSource } from '../../src/services/recording-read-owner.js'
import type { ServiceRuntime } from '../../src/services/service.js'

const session = { userId: 42, accessToken: 'access', refreshToken: 'refresh' }
const start = 1_780_000_000_000
const window = { startAt: start, endAt: start + 86_400_000 }
const coverage = { ready_count: 1, processing_count: 0, failed_count: 0, silent_count: 0, candidate_count: 0 }
const objectId = (value: number) => value.toString(16).padStart(24, '0')
interface Row { body: string; offset: number; child: number; ordinal: number; reference?: string }
function fixture(rows: Row[][]) {
  let sid = 42
  const versions = rows.map(() => 'a'.repeat(64))
  const captureStates: unknown[] = rows.map(() => undefined)
  const requests: Array<{ path: string; body: Record<string, unknown> }> = []
  let mutate: ((value: Record<string, unknown>, request: Record<string, unknown>) => void) | undefined
  const runtime = {
    requireSession: vi.fn(async () => ({ ...session, userId: sid })),
    authenticatedAudioPost: vi.fn(async (path: string, body: Record<string, unknown>, _session: unknown, signal?: AbortSignal) => {
      signal?.throwIfAborted()
      requests.push({ path, body })
      if (path.endsWith('/recordings/query')) {
        const offset = Number(body.page_cursor ?? 0)
        return { items: rows.slice(offset, offset + 50).map((_, i) => ({ status: 'available', capture_state: captureStates[offset + i], recording_uid: objectId(offset + i + 1), start_at: start, end_at: start + 10_000, duration_ms: 10_000, owner_version: 1 })), has_more: offset + 50 < rows.length, ...(offset + 50 < rows.length ? { next_page_cursor: String(offset + 50) } : {}) }
      }
      if (!path.endsWith('/transcript/query')) throw new Error(`Unexpected owner route: ${path}`)
      const index = parseInt(String(body.recording_uid), 16) - 1
      const fragments = rows[index]!.flatMap((row, ordinal) => {
        const chars = Array.from(row.body)
        return Array.from({ length: Math.ceil(chars.length / 4_000) }, (_, part) => ({
          clip_locator: { child_id: objectId(row.child), source: body.source, ordinal: row.ordinal },
          start_offset_ms: row.offset, end_offset_ms: row.offset + 1_000, speaker_index: ordinal,
          text: chars.slice(part * 4_000, (part + 1) * 4_000).join(''), utterance_index: ordinal,
          text_start_offset: part * 4_000, text_end_offset: Math.min((part + 1) * 4_000, chars.length), text_total_length: chars.length,
          ...(chars.length > 4_000 ? { text_truncated: true } : {}),
        }))
      })
      const offset = Number(body.page_cursor ?? 0)
      const selected = [] as typeof fragments
      let budget = 20_000
      for (const item of fragments.slice(offset, offset + Number(body.limit))) {
        const length = Array.from(item.text).length
        if (length > budget) break
        selected.push(item); budget -= length
      }
      // The real owner compacts speakers to the current page, not global indices.
      const speakers = selected.map(item => ({ reference: rows[index]![item.speaker_index]!.reference ?? 'speaker:bbbbbbbbbbbbbbbb', label: '同名', kind: 'named' }))
      const value: Record<string, unknown> = { status: 'available', recording_uid: body.recording_uid, start_at: start, revision: versions[index], coverage,
        speakers, utterances: selected.map((item, i) => ({ ...item, speaker_index: i })), has_more: offset + selected.length < fragments.length,
        ...(offset + selected.length < fragments.length ? { next_page_cursor: String(offset + selected.length) } : {}),
      }
      mutate?.(value, body)
      return value
    }),
  } as unknown as Pick<ServiceRuntime, 'requireSession' | 'authenticatedAudioPost'>
  return { owner: new RecordingReadOwner(runtime), runtime, requests, versions, captureStates, setSid(value: number) { sid = value }, mutate(fn: typeof mutate) { mutate = fn } }
}

const rows = (count: number, phase = 0): Row[] => Array.from({ length: count }, (_, i) => ({ body: `原文-${phase}-${i}`, offset: 2 * i + phase, child: phase + 100, ordinal: i }))

describe('RecordingReadOwner', () => {
  it('keeps receiving and incomplete captures separate from transcript work throughout pagination', async () => {
    const f = fixture([rows(101), rows(101, 1)])
    f.captureStates[0] = 'receiving'; f.captureStates[1] = 'interrupted'
    const first = await f.owner.dayPage(window, 'primary', session)
    expect(first.captureCoverage).toEqual({ receiving: 1, interrupted: 1 })
    expect(first.coverage.processing_count).toBe(0)
    const next = await f.owner.dayPage(window, 'primary', session, first.next)
    expect(next.captureCoverage).toEqual(first.captureCoverage)
    for (const state of ['done', false, 1]) {
      f.captureStates[0] = state
      await expect(f.owner.recordings(window, session)).rejects.toMatchObject({ code: 'recording-owner-response-invalid' })
    }
  })
  it('continues bounded metadata scans through empty pages and rejects a repeated scan cursor', async () => {
    const f = fixture([])
    const post = vi.mocked(f.runtime.authenticatedAudioPost)
    post.mockResolvedValueOnce({ items: [], has_more: true, next_page_cursor: 'scan-next' })
      .mockResolvedValueOnce({ items: [{ status: 'available', recording_uid: objectId(1), start_at: start,
        end_at: start + 1000, duration_ms: 1000, owner_version: 1 }], has_more: false })
    expect(await f.owner.recordings(window, session)).toHaveLength(1)
    expect(post.mock.calls[1]![1]).toMatchObject({ page_cursor: 'scan-next' })
    post.mockResolvedValue({ items: [], has_more: true, next_page_cursor: 'repeat' })
    await expect(f.owner.recordings(window, session)).rejects.toMatchObject({ code: 'recording-owner-response-invalid' })
    expect(post).toHaveBeenCalledTimes(4)
  })
  it('merges overlapping recordings chronologically with bounded lookahead and preserves all ordinals', async () => {
    const f = fixture([rows(250, 0), rows(250, 1)])
    const first = await f.owner.dayPage(window, 'primary', session)
    expect(first.items).toHaveLength(100)
    expect(first.items.map(item => item.startAt)).toEqual(Array.from({ length: 100 }, (_, i) => start + i))
    expect(first.next).toBeDefined()
    expect(JSON.stringify(first.next)).not.toContain('原文')
    expect(f.requests.filter(row => row.path.endsWith('/transcript/query')).map(row => row.body.limit)).toEqual([1, 1, 100, 100])
    expect(f.requests.every(row => !row.path.includes('one-day-trans'))).toBe(true)
    const all = [...first.items]
    let next = first.next
    while (next !== undefined) {
      const page = await f.owner.dayPage(window, 'primary', session, next)
      all.push(...page.items); next = page.next
    }
    expect(all).toHaveLength(500)
    expect(all.map(item => item.startAt)).toEqual(Array.from({ length: 500 }, (_, i) => start + i))
    expect(new Set(all.map(item => `${item.recordingId}/${item.locator.ordinal}`)).size).toBe(500)
    expect(first.views).toEqual([1, 2].map(i => ({ recording_uid: objectId(i), source: 'primary', revision: 'a'.repeat(64) })))
  })

  it('full consumers exhaust pages and join unicode fragments without losing whitespace or trailing text', async () => {
    const original = `  ${'汉🎙'.repeat(15_000)} 尾部\n`
    const f = fixture([[{ body: original, offset: 1, child: 100, ordinal: 7 }, { body: '最后一句', offset: 2, child: 100, ordinal: 11 }]])
    const complete = await f.owner.completeDay(window, 'enhanced', session)
    expect(complete.next).toBeUndefined()
    expect(complete.items.map(item => item.text)).toEqual([original, '最后一句'])
    expect(complete.items.map(item => item.locator.ordinal)).toEqual([7, 11])
    expect(complete.items.every(item => item.locator.source === 'enhanced')).toBe(true)
    expect(f.requests.filter(row => row.path.endsWith('/transcript/query')).every(row => row.body.text_mode === 'full')).toBe(true)
  })

  it('metadata pagination does not truncate a day at the first 50 recordings', async () => {
    const f = fixture(Array.from({ length: 51 }, () => []))
    const page = await f.owner.dayPage(window, 'primary', session)
    expect(page.items).toEqual([])
    expect(page.views).toHaveLength(51)
    expect(page.next).toBeUndefined()
    expect(f.requests.filter(row => row.path.endsWith('/recordings/query'))).toHaveLength(2)
  })

  it('validates even completed recordings on a later page and rejects revision mixing', async () => {
    const f = fixture([rows(1, 0), rows(250, 1)])
    const first = await f.owner.dayPage(window, 'primary', session)
    expect(first.next!.positions[0]!.done).toBe(true)
    f.versions[0] = 'c'.repeat(64)
    await expect(f.owner.dayPage(window, 'primary', session, first.next)).rejects.toMatchObject({ code: 'recording-view-changed' })
  })

  it.each(['ordinal', 'source', 'offset', 'speaker', 'cursor', 'tail', 'time', 'number'] as const)('rejects malformed owner %s without legacy fallback', async field => {
    const f = fixture([rows(2)])
    f.mutate(value => {
      const item = (value.utterances as Array<Record<string, unknown>>)[0]!
      if (field === 'ordinal') (item.clip_locator as Record<string, unknown>).ordinal = -1
      if (field === 'source') (item.clip_locator as Record<string, unknown>).source = 'enhanced'
      if (field === 'offset') item.text_end_offset = 1
      if (field === 'speaker') item.speaker_index = 99
      if (field === 'cursor') { value.has_more = true; delete value.next_page_cursor }
      if (field === 'tail') { item.text_total_length = 99; item.text_truncated = true; value.has_more = false; delete value.next_page_cursor }
      if (field === 'time') item.end_offset_ms = 0
      if (field === 'number') item.utterance_index = 0.1
    })
    await expect(f.owner.transcript(objectId(1), 'primary', window, session, { limit: 1 })).rejects.toMatchObject({ code: 'recording-owner-response-invalid' })
    expect(f.requests).toHaveLength(1)
  })

  it('rechecks the account after the response and forwards abort without starting another read', async () => {
    const f = fixture([rows(250)])
    f.mutate(() => { f.setSid(43) })
    await expect(f.owner.transcript(objectId(1), 'primary', window, session)).rejects.toMatchObject({ code: 'recording-view-changed' })
    expect(f.requests).toHaveLength(1)
    f.setSid(42)
    const controller = new AbortController(); controller.abort()
    await expect(f.owner.transcript(objectId(1), 'primary', window, session, {}, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(f.requests).toHaveLength(1)
  })

  it('does not reuse a continuation for another date or source', async () => {
    const f = fixture([rows(250)])
    const first = await f.owner.dayPage(window, 'primary', session)
    for (const source of ['enhanced'] as RecordingReadSource[]) await expect(f.owner.dayPage(window, source, session, first.next)).rejects.toMatchObject({ code: 'recording-view-changed' })
    await expect(f.owner.dayPage({ ...window, endAt: window.endAt + 1 }, 'primary', session, first.next)).rejects.toMatchObject({ code: 'recording-view-changed' })
  })
})
