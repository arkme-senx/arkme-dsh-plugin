import { describe, expect, it, vi } from 'vitest'
import type { ArkmeCalendarDayRecordPage, ArkmeCalendarRecordItem, ArkmeRecordingDay, ArkmeRecordingWorkbenchItem } from '../src/types.js'
import { createExistingDayActivityReader, existingDayBounds, continuousRecordingIntervals } from '../src/client/existing-day-activity-reader.js'
import type { DayActivityQuery } from '../src/client/calendar-activity-model.js'
import type { callArkme } from '../src/client/api.js'

const start = new Date(2026, 8, 19).getTime(), hour = 3_600_000
const query: DayActivityQuery = { accountScope: 'prod:123', bucketDate: '2026-09-19', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  kind: 'all', mode: 'activities', includeBackground: false }
const options = () => ({ signal: new AbortController().signal })
const note = (id: string, time = 12, changes: Partial<ArkmeCalendarRecordItem> = {}): ArkmeCalendarRecordItem => ({ recordUid: id,
  sendAtMillis: start + hour * time, accessState: 'available', title: '', textContent: '自己写的内容', preview: '自己写的内容',
  sourceKind: 'self', creationSource: 0, templateKind: 1, displayKind: 0, protected: false, ...changes })
const notes = (items: ArkmeCalendarRecordItem[], changes: Partial<ArkmeCalendarDayRecordPage> = {}): ArkmeCalendarDayRecordPage => ({
  scope: 'self', bucketDate: query.bucketDate, timezone: query.timezone, refreshedAtMillis: start, items, hasMore: false, ...changes })
const transcript = (id: string, time = 8, changes: Partial<ArkmeRecordingWorkbenchItem> = {}): ArkmeRecordingWorkbenchItem => ({
  itemId: id, itemRef: `ref:${id}`, transcriptSource: 'system', sessionKey: 'session', startAtMillis: start + time * hour,
  endAtMillis: start + time * hour + 1000, speakerNumber: 1, speakerKey: 'speaker', speakerColorIndex: 1, speakerLabel: '说话人',
  sameSpeakerItemCount: 1, isSelf: true, isBackground: false, recordingBelongsToViewer: true, text: '转写', ...changes })
const interval = (from: number, to: number) => ({ startAtMillis: start + hour * from, endAtMillis: start + hour * to, sourceLabel: '我的录音', status: 'saved' as const })
const recording = (changes: Partial<ArkmeRecordingDay> = {}): ArkmeRecordingDay => ({ dateStamp: start, totalDurationMillis: hour,
  coverage: { state: 'ready', intervals: [interval(8, 9)] },
  transcript: { state: 'ready', message: '', items: [transcript('t')], totalDurationMillis: hour, processingCount: 0 },
  summary: { state: 'empty', items: [], message: '' }, timeline: { state: 'empty', items: [], message: '' }, ...changes })
function setup(notePages = [notes([note('a')])], audio: ArkmeRecordingDay | Error = recording()) {
  let index = 0
  const read = vi.fn<typeof callArkme>(async (operation) => {
    if (operation === 'calendar.records') return notePages[index++] ?? notes([])
    if (operation === 'recordings.day') { if (audio instanceof Error) throw audio; return audio }
    throw new Error(`unexpected operation ${operation}`)
  })
  return { reader: createExistingDayActivityReader(query.accountScope, read), read }
}

describe('existing personal calendar domain adapter', () => {
  it('loads a location only on explicit request, scoped to the active read session', async () => {
    const location = { source: 'device' as const, latitude: 30.52, longitude: 114.31 }
    const read = vi.fn<typeof callArkme>(async operation => operation === 'calendar.records'
      ? notes([note('a', 12, { locationRef: 'opaque', locationObservation: location })]) : operation === 'recordings.day' ? recording()
      : { recordUid: 'a', access: 'available', location })
    const reader = createExistingDayActivityReader(query.accountScope, read)
    const page = await reader.loadDay(query, options())
    expect(page.items.find(item => item.id === 'note:a')).toMatchObject({ canLoadLocation: true, location })
    expect(read).toHaveBeenCalledTimes(2)
    await reader.loadDetail(query, 'note:a', { ...options(), snapshotId: page.snapshotId })
    expect(read).toHaveBeenCalledTimes(2)
    expect(await reader.loadLocation!(query, 'note:a', { ...options(), snapshotId: page.snapshotId })).toMatchObject({ activityId: 'note:a', location })
    expect(read.mock.calls[2]?.slice(0, 2)).toEqual(['calendar.record-location', { locationRef: 'opaque' }])
    await expect(reader.loadLocation!({ ...query, accountScope: 'another' }, 'note:a', { ...options(), snapshotId: page.snapshotId })).rejects.toThrow('过期')
    await expect(reader.loadLocation!(query, page.items.find(item => item.kind === 'recording')!.id, { ...options(), snapshotId: page.snapshotId })).rejects.toThrow('暂不能读取')
  })
  it('rejects mismatched location identity and discards a late location after refresh', async () => {
    let finish!: (value: unknown) => void
    const read = vi.fn<typeof callArkme>(async operation => operation === 'calendar.records' ? notes([note('a', 12, { locationRef: 'opaque' })])
      : operation === 'recordings.day' ? recording() : { recordUid: 'another', access: 'available' })
    const reader = createExistingDayActivityReader(query.accountScope, read)
    const page = await reader.loadDay(query, options())
    await expect(reader.loadLocation!(query, 'note:a', { ...options(), snapshotId: page.snapshotId })).rejects.toThrow('不一致')
    read.mockImplementationOnce(async () => await new Promise(done => { finish = done }))
    const pending = reader.loadLocation!(query, 'note:a', { ...options(), snapshotId: page.snapshotId })
    const rejection = expect(pending).rejects.toThrow('已变化')
    await reader.loadDay(query, options())
    finish({ recordUid: 'a', access: 'available' })
    await rejection
  })
  it('uses only two existing read operations, does not invent global chat activity or server snapshots', async () => {
    const { reader, read } = setup()
    const page = await reader.loadDay(query, options())
    expect(read.mock.calls.map(call => call[0])).toEqual(['calendar.records', 'recordings.day'])
    expect(read.mock.calls[0]![1]).toEqual({ bucketDate: query.bucketDate, timezone: query.timezone, limit: 20 })
    expect(page.items.map(item => item.kind)).toEqual(['note', 'recording'])
    expect(page.snapshotId).toMatch(/^local-read-/)
    expect(page.order).toBe('descending')
    expect(page.missingKinds).toEqual(['private_chat', 'group_chat', 'call'])
    expect(page.completeness).toBe('partial')
    expect(page.hasMore).toBe(false)
    const detail = await reader.loadDetail(query, 'note:a', { ...options(), snapshotId: page.snapshotId })
    expect(detail.items[0]?.content?.textContent).toBe('自己写的内容')
    expect(read).toHaveBeenCalledTimes(2)
    expect(reader.resolveTarget('https://untrusted.example')).toBeUndefined()
  })
  it('keeps older recording intervals behind a bounded descending note cursor without a history scan', async () => {
    const cursor = { sendAtMillis: start + hour * 10, recordUid: 'b' }
    const { reader, read } = setup([notes([note('a', 14), note('b', 10)], { hasMore: true, nextCursor: cursor }), notes([note('c', 7)])],
      recording({ coverage: { state: 'ready', intervals: [interval(11, 12), interval(8, 9), interval(5, 6)] } }))
    const first = await reader.loadDay(query, options())
    expect(first.items.map(item => (item.startAtMillis - start) / hour)).toEqual([14, 11, 10])
    expect(read).toHaveBeenCalledTimes(2)
    const second = await reader.loadDay(query, { ...options(), snapshotId: first.snapshotId, cursor: first.nextCursor! })
    expect(second.items.map(item => (item.startAtMillis - start) / hour)).toEqual([8, 7, 5])
    expect(second.hasMore).toBe(false)
    expect(read.mock.calls[2]![1]).toMatchObject({ cursor, limit: 20 })
  })
  it('limits rendered pages even for hundreds of separate audio segments', async () => {
    const audio = recording({ coverage: { state: 'ready', intervals: Array.from({ length: 100 }, (_, index) => interval(index / 10, index / 10 + .01)) } })
    const { reader, read } = setup([], audio)
    const q = { ...query, kind: 'recording' as const }
    let page = await reader.loadDay(q, options())
    const all = [...page.items]
    while (page.hasMore) {
      expect(page.items.length).toBeLessThanOrEqual(40)
      page = await reader.loadDay(q, { ...options(), snapshotId: page.snapshotId, cursor: page.nextCursor! })
      all.push(...page.items)
    }
    expect(new Set(all.map(item => item.id)).size).toBe(100)
    expect(read).toHaveBeenCalledTimes(1)
  })
  it('joins adjacent same-source audio only and preserves silence/no-transcript coverage and gaps', async () => {
    const joined = continuousRecordingIntervals([interval(8, 9), interval(9, 10), interval(12, 13),
      { ...interval(10, 11), sourceLabel: '另一个设备' }])
    expect(joined).toHaveLength(3)
    expect(joined).toContainEqual(interval(8, 10))
    const { reader } = setup([], recording({ coverage: { state: 'ready', intervals: [interval(8, 20)] },
      transcript: { state: 'empty', message: '', items: [], totalDurationMillis: 0, processingCount: 0 } }))
    const page = await reader.loadDay({ ...query, kind: 'recording' }, options())
    expect(page.items[0]?.recordCount).toBe(0)
    expect(page.items[0]?.preview).toContain('已记录声音')
    expect(page.coverage?.intervals).toEqual([interval(8, 20)])
    expect(page.speechIntervals).toEqual([])
  })
  it('requires recording ownership, not the current user being the speaker', async () => {
    const own = transcript('owned', 8)
    const { reader } = setup([], recording({ transcript: { state: 'ready', message: '', totalDurationMillis: hour, processingCount: 0,
      items: [own, transcript('background', 8, { isBackground: true, text: '背景声音' }), transcript('foreign', 8, { recordingBelongsToViewer: false, text: 'foreign secret' }),
        transcript('unknown', 8, { recordingBelongsToViewer: undefined, text: 'unknown secret' })] } }))
    const page = await reader.loadDay(query, options())
    expect(page.speechIntervals).toHaveLength(1)
    const audio = page.items.find(item => item.kind === 'recording')!
    const detail = await reader.loadDetail(query, audio.id, { ...options(), snapshotId: page.snapshotId })
    expect(detail.items.map(item => item.id)).toEqual(['owned', 'background'])
    expect(JSON.stringify(page)).not.toContain('secret')
  })
  it('preserves rich content, hides protected payloads and resolves only current authorized targets', async () => {
    const { reader } = setup([notes([note('protected', 12, { protected: true, title: 'secret', textContent: 'secret', preview: 'secret' })])])
    const page = await reader.loadDay(query, options())
    expect(JSON.stringify(page)).not.toContain('secret')
    expect(await reader.loadDetail(query, 'note:protected', { ...options(), snapshotId: page.snapshotId }))
      .toMatchObject({ access: 'restricted', items: [], hasMore: false })
    const item = page.items.find(item => item.kind === 'recording')!
    const detail = await reader.loadDetail(query, item.id, { ...options(), snapshotId: page.snapshotId })
    expect(reader.resolveTarget(detail.sourceRef!)).toEqual({ kind: 'recording', dateStamp: start, startAtMillis: start + 8 * hour })
    await reader.loadDay(query, options())
    expect(reader.resolveTarget(detail.sourceRef!)).toBeUndefined()
  })
  it('keeps notes when audio fails and audio when notes fail; distinguishes partial coverage', async () => {
    const { reader } = setup(undefined, new Error('offline'))
    const page = await reader.loadDay(query, options())
    expect(page.items[0]?.kind).toBe('note')
    expect(page.missingKinds).toContain('recording')
    const read = vi.fn<typeof callArkme>(async operation => {
      if (operation === 'calendar.records') throw new Error('offline')
      return recording({ coverage: { state: 'partial', intervals: [interval(8, 9)] } })
    })
    const other = await createExistingDayActivityReader(query.accountScope, read).loadDay(query, options())
    expect(other.items[0]?.kind).toBe('recording')
    expect(other.missingKinds).toEqual(expect.arrayContaining(['note', 'recording']))
  })
  it('separates failed transcription from physical coverage', async () => {
    const { reader } = setup([], recording({ transcript: { state: 'error', message: '', items: [], totalDurationMillis: 0, processingCount: 0 } }))
    const page = await reader.loadDay(query, options())
    expect(page.coverage?.intervals).toHaveLength(1)
    expect(page.items[0]?.preview).toContain('转写暂不可用')
    expect(page.notice).toContain('转写暂不可用')
  })
  it('paginates audio transcripts only after selection and deduplicates stable transcript IDs', async () => {
    const items = Array.from({ length: 61 }, (_, index) => transcript(`t${index}`, 8 + index / 100))
    const { reader } = setup([], recording({ transcript: { state: 'ready', message: '', totalDurationMillis: hour, processingCount: 0, items: [...items, items[0]!] } }))
    const page = await reader.loadDay(query, options())
    const id = page.items[0]!.id
    expect(page.items[0]!.recordCount).toBe(61)
    const first = await reader.loadDetail(query, id, { ...options(), snapshotId: page.snapshotId })
    expect(first.items).toHaveLength(50)
    const second = await reader.loadDetail(query, id, { ...options(), snapshotId: page.snapshotId, cursor: first.nextCursor! })
    expect(second.items).toHaveLength(11)
    expect(second.hasMore).toBe(false)
    await expect(reader.loadDetail(query, id, { ...options(), snapshotId: page.snapshotId, cursor: '-1' })).rejects.toThrow('分页无效')
  })
  it('rejects mismatched account, timezone, stale pagination and aborted requests', async () => {
    const { reader, read } = setup()
    await expect(reader.loadDay({ ...query, accountScope: 'other' }, options())).rejects.toThrow('账号范围')
    expect(() => existingDayBounds({ ...query, timezone: query.timezone === 'UTC' ? 'Asia/Shanghai' : 'UTC' })).toThrow('时区')
    const controller = new AbortController(); controller.abort()
    await expect(reader.loadDay(query, { signal: controller.signal })).rejects.toThrow()
    expect(read).not.toHaveBeenCalled()
    await expect(reader.loadDay(query, { ...options(), snapshotId: 'old', cursor: 'old:1' })).rejects.toThrow('分页已过期')
  })
  it('allows same-time distinct note IDs, filtered-empty pages and rejects cursor cycles', async () => {
    const cursor = { sendAtMillis: start + 12 * hour, recordUid: 'b' }
    const { reader } = setup([notes([note('a'), note('b')], { hasMore: true, nextCursor: cursor }), notes([], { hasMore: true, nextCursor: cursor })])
    const page = await reader.loadDay(query, options())
    expect(page.items.map(item => item.id)).toEqual(['note:b', 'note:a'])
    await expect(reader.loadDay(query, { ...options(), snapshotId: page.snapshotId, cursor: page.nextCursor! })).rejects.toThrow('分页已失效')
  })
  it('does not attach a late response to a refreshed session', async () => {
    let finish!: (value: ArkmeRecordingDay) => void
    const pending = new Promise<ArkmeRecordingDay>(resolve => { finish = resolve })
    let count = 0
    const read = vi.fn<typeof callArkme>(async operation => operation === 'calendar.records' ? notes([]) : ++count === 1 ? pending : recording())
    const reader = createExistingDayActivityReader(query.accountScope, read)
    const first = reader.loadDay(query, options())
    const firstRejection = expect(first).rejects.toThrow('日期或账号已变化')
    const second = await reader.loadDay(query, options())
    finish(recording())
    await firstRejection
    const detail = await reader.loadDetail(query, second.items[0]!.id, { ...options(), snapshotId: second.snapshotId })
    expect(detail.items).toHaveLength(1)
  })
  it('does not let a hung audio source indefinitely block available notes', async () => {
    vi.useFakeTimers()
    try {
      const read = vi.fn<typeof callArkme>(async operation => operation === 'calendar.records' ? notes([note('ready')]) : new Promise(() => {}))
      const pending = createExistingDayActivityReader(query.accountScope, read).loadDay(query, options())
      await vi.advanceTimersByTimeAsync(30_000)
      const page = await pending
      expect(page.items.map(item => item.id)).toEqual(['note:ready'])
      expect(page.missingKinds).toContain('recording')
    } finally { vi.useRealTimers() }
  })
  it('uses local day boundaries across daylight saving transitions rather than assuming 24 hours', () => {
    vi.stubEnv('TZ', 'America/New_York')
    try {
      const [start, end] = existingDayBounds({ ...query, bucketDate: '2026-03-08', timezone: 'America/New_York' })
      expect(end - start).toBe(23 * hour)
      const [fallStart, fallEnd] = existingDayBounds({ ...query, bucketDate: '2026-11-01', timezone: 'America/New_York' })
      expect(fallEnd - fallStart).toBe(25 * hour)
    } finally { vi.unstubAllEnvs() }
  })
})
