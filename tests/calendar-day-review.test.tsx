import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DAY_REVIEW_SOURCES, parseDayReviewQuery, parseDayReviewResult, parseDayReviewState } from '../src/calendar-day-review.js'
import { ArkmeCalendarDayReview } from '../src/client/ArkmeCalendarDayReview.js'
import { callArkme } from '../src/client/api.js'
vi.mock('../src/client/api.js', () => ({ callArkme: vi.fn() }))
vi.mock('../src/client/explore/ExploreSurface.js', () => ({ ExploreRecordingSource: () => null }))
vi.mock('../src/client/ArkmeNoteDetails.js', () => ({ ArkmeTimelineDetailDrawer: () => null }))
vi.mock('../src/client/ArkmeCallDetailContent.js', () => ({ ArkmeCallDetailContent: () => null }))
export const query = { accountScope: 'prod:7', bucketDate: '2026-10-15', timezone: 'Asia/Shanghai' }
export const envelope = { schema_version: 1, scope: 'calendar_day', date: query.bucketDate, time_zone: query.timezone }
const at = Date.parse('2026-10-15T12:00:00+08:00')
export const rawResult = () => ({ ...envelope, id: 'result-1', snapshot_id: 'snapshot-1', generated_at: at, model_name: '测试模型',
  source_kinds: [...DAY_REVIEW_SOURCES], coverage: DAY_REVIEW_SOURCES.map(kind => ({ kind, status: 'complete', count: 1 })),
  sources: [{ ref: 'source-1', kind: 'audio', label: '12:00 · 录音原文' }],
  summary: [{ text: '讨论了录音存储方案', source_refs: ['source-1'] }],
  timeline: [{ title: '讨论存储', text: '有依据的结论', start_at: at, end_at: at + 60000, source_refs: ['source-1'] }],
})
export const rawState = () => ({ ...envelope, job: null, result: rawResult(), freshness: 'unchanged', versions: [{ id: 'result-1', generated_at: at }] })
const current = () => parseDayReviewState(rawState(), query)
describe('calendar review material and provenance contract', () => {
  it('requires actual dates, timezone and matching scope, rather than accepting recording-only results', () => {
    expect(parseDayReviewQuery(query)).toEqual(query)
    expect(() => parseDayReviewQuery({ ...query, bucketDate: '2026-02-30' })).toThrow()
    expect(() => parseDayReviewQuery({ ...query, timezone: 'bad/zone' })).toThrow()
    expect(() => parseDayReviewResult({ ...rawResult(), scope: 'recording' }, query)).toThrow()
    expect(() => parseDayReviewResult(rawResult(), { ...query, bucketDate: '2026-10-14' })).toThrow()
  })
  it('rejects untraceable claims, duplicate citations, missing coverage and events outside the day', () => {
    expect(() => parseDayReviewResult({ ...rawResult(), summary: [{ text: '臆测', source_refs: ['missing'] }] }, query)).toThrow()
    expect(() => parseDayReviewResult({ ...rawResult(), sources: [...rawResult().sources, ...rawResult().sources] }, query)).toThrow()
    expect(() => parseDayReviewResult({ ...rawResult(), coverage: [] }, query)).toThrow()
    expect(() => parseDayReviewResult({ ...rawResult(), timeline: [{ ...rawResult().timeline[0], start_at: at - 86400000 }] }, query)).toThrow()
  })
  it('preserves partial coverage, original citations, snapshot and both outputs', () => {
    const result = parseDayReviewResult({ ...rawResult(), coverage: DAY_REVIEW_SOURCES.map(kind => ({ kind, status: kind === 'location' ? 'partial' : 'complete', count: 1 })) }, query)
    expect(result.coverage.find(x => x.kind === 'location')?.status).toBe('partial')
    expect(result.summary[0]?.sourceRefs).toEqual(['source-1'])
    expect(result.timeline[0]?.startAtMillis).toBe(at)
    expect(result.snapshotId).toBe('snapshot-1')
  })
})
let view: ReactTestRenderer | undefined
const text = (node: unknown): string => typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' && 'children' in node ? text(node.children) : ''
const content = () => text(view!.toJSON())
const button = (label: string) => view!.root.findAllByType('button').find(x => text(x.props.children) === label)!
const mount = async () => act(async () => { view = create(<ArkmeCalendarDayReview query={query} view="summary" />) })
beforeEach(() => { vi.mocked(callArkme).mockReset(); vi.mocked(callArkme).mockResolvedValue(current()) })
afterEach(() => { act(() => view?.unmount()); view = undefined; vi.useRealTimers() })
describe('calendar review interaction', () => {
  it('shows unavailable support clearly and never automatically submits AI work', async () => {
    vi.mocked(callArkme).mockResolvedValue({ supported: false, job: null, result: null, versions: [], freshness: 'unknown' })
    await mount()
    expect(content()).toContain('日历回顾服务尚未接通')
    expect(button('生成当天回顾').props.disabled).toBe(true)
    expect(vi.mocked(callArkme).mock.calls.map(x => x[0])).toEqual(['calendar.day-review.state'])
  })
  it('opens exact citations and clears both output views when source access fails', async () => {
    await mount()
    expect(content()).toContain('讨论了录音存储方案')
    vi.mocked(callArkme).mockRejectedValueOnce(new Error('原文已删除'))
    await act(async () => button('12:00 · 录音原文').props.onClick())
    expect(callArkme).toHaveBeenLastCalledWith('calendar.day-review.source', expect.objectContaining({ resultId: 'result-1', sourceRef: 'source-1' }), expect.any(AbortSignal))
    expect(content()).toContain('原文已删除')
    await act(async () => view!.update(<ArkmeCalendarDayReview query={query} view="timeline" />))
    expect(content()).not.toContain('有依据的结论')
    expect(content()).not.toContain('讨论了录音存储方案')
    expect(vi.mocked(callArkme).mock.calls.filter(x => x[0] === 'calendar.day-review.state')).toHaveLength(1)
  })
  it('keeps the previous result on failed updates and reuses an uncertain submission id', async () => {
    await mount()
    vi.mocked(callArkme).mockRejectedValueOnce(new Error('网络断开'))
    await act(async () => button('更新回顾').props.onClick())
    const first = vi.mocked(callArkme).mock.calls.find(x => x[0] === 'calendar.day-review.create')![1]
    expect(content()).toContain('讨论了录音存储方案')
    expect(content()).toContain('提交结果尚未确认')
    vi.mocked(callArkme).mockResolvedValueOnce({ ...current(), job: { id: 'job', status: 'collecting', message: '' } })
    await act(async () => button('核对提交').props.onClick())
    expect(vi.mocked(callArkme).mock.calls.filter(x => x[0] === 'calendar.day-review.create')).toHaveLength(1)
    expect(callArkme).toHaveBeenLastCalledWith('calendar.day-review.reconcile', query, expect.any(AbortSignal))
    expect(first).toMatchObject({ sourceKinds: DAY_REVIEW_SOURCES })
    expect(first).not.toHaveProperty('transcripts')
    expect(content()).toContain('收集资料')
    expect(content()).toContain('下方保留上一次生成的结果')
  })
  it('aborts and discards responses from a previous date', async () => {
    let resolve!: (v: unknown) => void
    vi.mocked(callArkme).mockImplementationOnce(() => new Promise(r => { resolve = r }) as never)
    await mount()
    const oldSignal = vi.mocked(callArkme).mock.calls[0]![2]!
    vi.mocked(callArkme).mockResolvedValueOnce({ supported: true, result: null, job: null, versions: [], freshness: 'unknown' })
    await act(async () => view!.update(<ArkmeCalendarDayReview query={{ ...query, bucketDate: '2026-10-14' }} view="summary" />))
    await act(async () => resolve(current()))
    expect(oldSignal.aborted).toBe(true)
    expect(content()).not.toContain('讨论了录音存储方案')
    expect(content()).toContain('把这一天串起来')
  })
  it('retains results when the durable job reports failure', async () => {
    vi.mocked(callArkme).mockResolvedValueOnce({ ...current(), job: { id: 'failed', status: 'failed', message: '部分资料读取失败' } })
    await mount()
    expect(content()).toContain('部分资料读取失败')
    expect(content()).toContain('讨论了录音存储方案')
    expect(button('更新回顾').props.disabled).toBe(false)
  })
  it('rechecks durable progress when the calendar signals new data', async () => {
    await mount()
    vi.mocked(callArkme).mockResolvedValueOnce({ ...current(), freshness: 'changed' })
    await act(async () => view!.update(<ArkmeCalendarDayReview query={query} view="summary" refreshVersion={1} />))
    expect(content()).toContain('有新内容可更新')
    expect(vi.mocked(callArkme).mock.calls.filter(x => x[0] === 'calendar.day-review.state')).toHaveLength(2)
  })
  it('does not read or generate before an account scope is established', async () => {
    await act(async () => { view = create(<ArkmeCalendarDayReview query={{ ...query, accountScope: '' }} view="summary" />) })
    expect(content()).toContain('账号范围尚未确认')
    expect(callArkme).not.toHaveBeenCalled()
  })
})
