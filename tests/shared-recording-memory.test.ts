import { describe, expect, it, vi } from 'vitest'
import { sharedRecordingDetailToolModule } from '../src/tools/business/conversation/shared-recording-detail.js'
import { createDocumentedDayActivityReader } from '../src/client/documented-day-activity-reader.js'
import { prepareDayRecapInput } from '../src/client/day-recap-input.js'
import { parseDayRecapInput } from '../src/day-recap.js'
import { dayActivityOverview } from '../src/client/calendar-activity-model.js'
import { dayActivityMetadata } from '../src/client/day-activity-presentation.js'
import type { callArkme } from '../src/client/api.js'
import type { DayActivityQuery } from '../src/client/calendar-activity-model.js'

const start = Date.parse('2026-10-10T09:00:00+08:00')
const query: DayActivityQuery = { accountScope: 'test:42', bucketDate: '2026-10-10', timezone: 'Asia/Shanghai', mode: 'activities', kind: 'recording', includeBackground: false }
const opts = () => ({ signal: new AbortController().signal })
const detail = { sourceDigest: 'digest-1', title: '产品讨论', summary: '讨论计划', transcript: '甲：先完成权限校验。\n乙：明天联调。', sharedByUserId: 7, sharedAtMillis: start + 86400000, displayAtMillis: start, endAtMillis: start + 3600000, timeRangeText: '09:00–10:00', transcriptAvailable: true, participants: [] }
const projection = (uid = 'r1') => ({ occurred_at: start, record_projection: { recordUid: uid, sendAtMillis: start, accessState: 'available', protected: false, textContent: '摘要', source: { kind: 'private_chat', sourceRef: 'chat-ref', displayName: '小林' }, content: { isMe: false, sharedRecording: { ...detail, transcript: undefined, detailRef: 'detail-ref' } } } })
function readerSetup() {
  let revoked = false
  const read = vi.fn<typeof callArkme>(async (operation, params) => {
    if (operation === 'source.shared-recording-detail') { if (revoked) throw new Error('共享已撤回'); return detail }
    if (params.source === 'record') return { items: [projection(), projection('r2')], has_more: false }
    if (params.source === 'audio') return { items: [{ start_at: start, end_at: start + 3600000, source_label: '本人录音' }], has_more: false }
    return { items: [], has_more: false }
  })
  return { read, reader: createDocumentedDayActivityReader(query.accountScope, read), revoke: () => { revoked = true } }
}

describe('shared recording Agent reads', () => {
  it('paginates complete text without splitting emoji and reauthorizes every chunk', async () => {
    const sharedRecordingDetail = vi.fn(async () => ({ ...detail, transcript: '甲😀乙丙' }))
    const tool = sharedRecordingDetailToolModule.create({ sharedRecordingDetail } as never)
    const result = await tool.execute({ detail_ref: 'sealed', limit: 2 }, opts() as never) as string
    expect(result).toContain('甲😀')
    expect(result).toContain('"next_offset": 2')
    expect(await tool.execute({ detail_ref: 'sealed', limit: 2, offset: 2 }, opts() as never)).toContain('乙丙')
    sharedRecordingDetail.mockRejectedValueOnce(new Error('revoked'))
    await expect(tool.execute({ detail_ref: 'sealed', offset: 2 }, opts() as never)).rejects.toThrow('revoked')
    expect(sharedRecordingDetail).toHaveBeenCalledTimes(3)
    expect(sharedRecordingDetailToolModule.meta.effect).toBe('read')
  })
  it('rejects invalid bounds before reading and does not turn missing text into a full transcript', async () => {
    const sharedRecordingDetail = vi.fn(async () => ({ ...detail, transcript: undefined }))
    const tool = sharedRecordingDetailToolModule.create({ sharedRecordingDetail } as never)
    await expect(tool.execute({ detail_ref: 'sealed', offset: -1 }, opts() as never)).rejects.toThrow()
    expect(sharedRecordingDetail).not.toHaveBeenCalled()
    expect(await tool.execute({ detail_ref: 'sealed' }, opts() as never)).toContain('"transcriptAvailable": false')
  })
})

describe('shared recording calendar evidence', () => {
  it('keeps simultaneous sources separate, labels origin and never inflates physical coverage', async () => {
    const { reader } = readerSetup(), page = await reader.loadDay(query, opts())
    expect(page.items).toHaveLength(3)
    expect(dayActivityOverview(page.items, 'activities')).toBe('已加载：1 个本人录音时段 · 2 份共享录音文字')
    expect(page.coverage?.intervals).toHaveLength(1)
    const shared = page.items.find(item => item.id === 'note:r1')!
    expect(shared).toMatchObject({ kind: 'recording', participation: 'received', startAtMillis: start, sharedRecording: { sourceLabel: '小林共享的录音' } })
    expect(dayActivityMetadata(shared, query.timezone, start, start + 86400000)).toContain('共享文字')
    const full = await reader.loadDetail(query, shared.id, { ...opts(), snapshotId: page.snapshotId })
    expect(full.items[0]?.text).toBe(detail.transcript)
    expect(full.items[0]?.author.name).toBe('小林共享的录音')
  })
  it('rechecks access for details and recap instead of using a previously fetched transcript', async () => {
    const { reader, read, revoke } = readerSetup(), page = await reader.loadDay(query, opts())
    const shared = page.items.filter(item => item.sharedRecording)
    const prepared = await prepareDayRecapInput(query, shared, opts().signal, read)
    expect(prepared.input.items[0]?.excerpt).toBe(detail.transcript.replace('\n', ' '))
    expect(prepared.input.items[0]?.scope).toContain('小林共享')
    expect(JSON.stringify(prepared.input)).not.toMatch(/detail-ref|digest-1|sourceDigest|chat-ref/)
    expect(parseDayRecapInput(prepared.input)).toEqual(prepared.input)
    revoke()
    await expect(reader.loadDetail(query, shared[0]!.id, { ...opts(), snapshotId: page.snapshotId })).rejects.toThrow('撤回')
    await expect(prepareDayRecapInput(query, shared, opts().signal, read)).rejects.toThrow('撤回')
  })
  it('discards detail responses after the selected day changes', async () => {
    const { reader, read } = readerSetup(), page = await reader.loadDay(query, opts())
    let resolve!: (value: unknown) => void
    read.mockImplementationOnce(async () => await new Promise(done => { resolve = done }))
    const pending = reader.loadDetail(query, 'note:r1', { ...opts(), snapshotId: page.snapshotId })
    const rejection = expect(pending).rejects.toThrow('变化')
    await reader.loadDay({ ...query, bucketDate: '2026-10-11' }, opts())
    resolve(detail)
    await rejection
  })
  it('rejects a changed source and bounds shared transcript excerpts within the existing total budget', async () => {
    const { reader, read } = readerSetup(), page = await reader.loadDay(query, opts())
    const shared = page.items.filter(item => item.sharedRecording)
    read.mockResolvedValueOnce({ ...detail, sourceDigest: 'other' })
    await expect(prepareDayRecapInput(query, shared, opts().signal, read)).rejects.toThrow('变化')
    read.mockResolvedValue({ ...detail, transcript: '字'.repeat(10000) })
    const prepared = await prepareDayRecapInput(query, shared, opts().signal, read)
    expect(prepared.input.items[0]?.excerpt).toHaveLength(1200)
    expect(JSON.stringify(prepared.input.items).length).toBeLessThanOrEqual(6000)
  })
})
