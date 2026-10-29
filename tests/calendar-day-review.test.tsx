import type { ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DAY_REVIEW_SOURCES, parseDayReviewQuery, parseDayReviewResult, parseDayReviewState } from '../src/calendar-day-review.js'
import { ArkmeCalendarDayReview } from '../src/client/ArkmeCalendarDayReview.js'
import { callArkme } from '../src/client/api.js'
import { ArkmeClientError } from '../src/sdk/index.js'
vi.mock('../src/client/api.js', () => ({ callArkme: vi.fn() }))
vi.mock('../src/client/explore/ExploreSurface.js', () => ({ ExploreRecordingSource: () => null }))
vi.mock('../src/client/ArkmeNoteDetails.js', () => ({ ArkmeTimelineDetailDrawer: () => null }))
vi.mock('../src/client/ArkmeDetailShell.js', () => ({ ArkmeDetailShell: ({ children }: { children: ReactNode }) => <div>{children}</div> }))
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
const modelCatalog = { defaultCode: 'deepseek-v4-flash', models: [{ code: 'deepseek-v4-flash', displayName: 'DeepSeek V4.1 Flash（官方）' }, { code: 'qwen-flash', displayName: 'Qwen Flash' }, { code: 'qwen3.8-flash', displayName: 'Qwen 3.8 Flash' }] }
let view: ReactTestRenderer | undefined
const text = (node: unknown): string => typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' && 'children' in node ? text(node.children) : ''
const content = () => text(view!.toJSON())
const button = (label: string) => view!.root.findAllByType('button').find(x => text(x.props.children) === label)!
const mount = async () => act(async () => { view = create(<ArkmeCalendarDayReview query={query} view="summary" />) })
beforeEach(() => { vi.mocked(callArkme).mockReset(); vi.mocked(callArkme).mockImplementation(async op => op === 'calendar.day-review.models' ? modelCatalog : current()) })
afterEach(() => { act(() => view?.unmount()); view = undefined; vi.useRealTimers() })
describe('calendar review interaction', () => {
  it('labels insufficient balance as the previous failure rather than the current balance', async () => {
    vi.mocked(callArkme).mockResolvedValueOnce(parseDayReviewState({ ...rawState(), result: null, job: { id: 'original', status: 'failed', failure_code: 'insufficient_balance', message: 'AI 积分不足，补充额度后可继续原任务', resumable: true } }, query))
    await mount()
    expect(content()).toContain('上次生成因积分不足中断')
    expect(content()).toContain('已完成步骤会复用，剩余步骤仍消耗积分')
    expect(button('继续生成').props.disabled).toBe(false)
    expect(vi.mocked(callArkme).mock.calls.some(x => ['calendar.day-review.create', 'calendar.day-review.resume'].includes(x[0]))).toBe(false)
  })
  it('does not enter reconciliation when the confirmation window was blocked before submission', async () => {
    await mount()
    await act(async () => button('更新回顾').props.onClick())
    vi.mocked(callArkme).mockRejectedValueOnce(new ArkmeClientError({ code: 'day-review-human-required', message: '确认页未打开，本次操作尚未提交', retryable: false }))
    await act(async () => button('确认').props.onClick())
    expect(content()).toContain('本次操作尚未提交')
    expect(content()).not.toContain('提交结果尚未确认')
    expect(content()).not.toContain('核对提交')
    expect(vi.mocked(callArkme).mock.calls.some(x => x[0] === 'calendar.day-review.reconcile')).toBe(false)
    expect(button('更新回顾').props.disabled).toBe(false)
  })
  it.each([['source_revoked', '旧结果的来源权限已变化'], ['source_changed', '原始资料已更正']])('hides %s content but preserves new generation and active progress', async (code, message) => {
    const revoked = { ...rawState(), result: null, result_error: code, freshness: 'unknown' }
    vi.mocked(callArkme).mockResolvedValueOnce(parseDayReviewState(revoked, query))
    await mount()
    expect(content()).toContain(message)
    expect(content()).not.toContain('讨论了录音存储方案')
    expect(button('生成当天回顾').props.disabled).toBe(false)
    vi.mocked(callArkme).mockResolvedValueOnce(parseDayReviewState({ ...revoked, job: { id: 'new-job', status: 'collecting', message: '' } }, query))
    await act(async () => button('刷新').props.onClick())
    expect(content()).toContain('收集资料')
    expect(button('正在生成…').props.disabled).toBe(true)
    expect(() => parseDayReviewState({ ...revoked, result: rawResult() }, query)).toThrow()
  })
  it('clears an aborted source spinner when correction invalidates the displayed result', async () => {
    let resolve!: (value: unknown) => void
    await mount()
    vi.mocked(callArkme).mockImplementationOnce(() => new Promise(r => { resolve = r }) as never)
    act(() => { button('12:00 · 录音原文').props.onClick() })
    expect(button('正在打开…').props.disabled).toBe(true)
    vi.mocked(callArkme).mockResolvedValueOnce(parseDayReviewState({ ...rawState(), result: null, result_error: 'source_changed' }, query))
    await act(async () => button('刷新').props.onClick())
    vi.mocked(callArkme).mockResolvedValueOnce(current())
    await act(async () => button('刷新').props.onClick())
    expect(button('12:00 · 录音原文').props.disabled).toBe(false)
    await act(async () => resolve({ kind: 'evidence', evidence: { text: '过期原文' } }))
    expect(content()).not.toContain('过期原文')
  })
  it('keeps history and its original panel open while rechecking permissions on refresh', async () => {
    const history = { ...current().result!, id: 'old', summary: [{ text: '历史摘要', sourceRefs: ['source-1'] }] }
    const original = { kind: 'evidence', evidence: { ref: 'source-1', resultId: 'old', kind: 'call', subtype: 'imported', label: '通话原文', text: '历史通话内容', startAtMillis: at, endAtMillis: at } }
    vi.mocked(callArkme).mockImplementation(async method => method === 'calendar.day-review.result' ? history : method === 'calendar.day-review.source' ? original : current() as never)
    await mount()
    await act(async () => view!.root.findByType('select').props.onChange({ target: { value: 'old' } }))
    await act(async () => button('12:00 · 录音原文').props.onClick())
    expect(content()).toContain('历史通话内容')
    await act(async () => button('刷新').props.onClick())
    expect(view!.root.findByType('select').props.value).toBe('old')
    expect(content()).toContain('历史摘要')
    expect(content()).toContain('历史通话内容')
    expect(vi.mocked(callArkme).mock.calls.filter(x => x[0] === 'calendar.day-review.result')).toHaveLength(2)
    expect(vi.mocked(callArkme).mock.calls.filter(x => x[0] === 'calendar.day-review.source')).toHaveLength(2)
    vi.mocked(callArkme).mockImplementation(async method => { if (method === 'calendar.day-review.result') throw new Error('历史权限已撤销'); return method === 'calendar.day-review.source' ? original : current() as never })
    await act(async () => button('刷新').props.onClick())
    expect(content()).toContain('历史权限已撤销')
    expect(content()).not.toContain('历史摘要')
    expect(content()).not.toContain('历史通话内容')
  })
  it('does not restore a previous history selection after a slow refresh', async () => {
    const history = { ...current().result!, id: 'old', summary: [{ text: '历史摘要', sourceRefs: ['source-1'] }] }
    vi.mocked(callArkme).mockImplementation(async method => method === 'calendar.day-review.result' ? history : current() as never)
    await mount()
    await act(async () => view!.root.findByType('select').props.onChange({ target: { value: 'old' } }))
    let resolve!: (value: unknown) => void
    vi.mocked(callArkme).mockImplementation(method => method === 'calendar.day-review.result' ? new Promise(r => { resolve = r }) as never : Promise.resolve(current()) as never)
    await act(async () => { button('刷新').props.onClick() })
    await act(async () => view!.root.findByType('select').props.onChange({ target: { value: '' } }))
    await act(async () => resolve(history))
    expect(view!.root.findByType('select').props.value).toBe('')
    expect(content()).not.toContain('历史摘要')
  })
  it('confines continuation to failed progress and never creates a new chargeable job', async () => {
    vi.mocked(callArkme).mockResolvedValue({ ...current(), job: { id: 'failed', status: 'failed', message: 'AI 积分不足，补充额度后可继续原任务', resumable: true } } as never)
    await mount()
    expect(content()).not.toContain('按实际模型用量使用 AI 积分')
    expect(button('继续生成').parent!.props.className).toBe('day-review-progress')
    vi.mocked(callArkme).mockResolvedValueOnce({ ...current(), job: { id: 'failed', status: 'collecting', message: '' } } as never)
    await act(async () => button('继续生成').props.onClick())
    expect(callArkme).toHaveBeenLastCalledWith('calendar.day-review.resume', { ...query, jobId: 'failed' }, expect.any(AbortSignal))
    expect(vi.mocked(callArkme).mock.calls.some(x => x[0] === 'calendar.day-review.create')).toBe(false)
    expect(button('继续生成')).toBeUndefined()
  })
  it('accepts the backend Unicode character limit for generated text', () => {
    const result = rawResult()
    result.summary[0]!.text = '😀'.repeat(10000)
    expect(parseDayReviewResult(result, query).summary[0]!.text).toBe(result.summary[0]!.text)
    result.summary[0]!.text += '😀'
    expect(() => parseDayReviewResult(result, query)).toThrow()
  })
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
    await act(async () => button('更新回顾').props.onClick())
    vi.mocked(callArkme).mockRejectedValueOnce(new Error('网络断开'))
    await act(async () => button('确认').props.onClick())
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
  it('finishes an in-flight read and coalesces soft invalidations into one trailing read', async () => {
    const resolve: Array<(value: unknown) => void> = []
    vi.mocked(callArkme).mockImplementation(() => new Promise(r => { resolve.push(r) }) as never)
    await mount()
    const firstSignal = vi.mocked(callArkme).mock.calls[0]![2]!
    for (const revision of [1, 2, 3]) {
      await act(async () => view!.update(<ArkmeCalendarDayReview query={query} view="summary" refreshVersion={revision} />))
    }
    expect(firstSignal.aborted).toBe(false)
    expect(callArkme).toHaveBeenCalledTimes(1)
    await act(async () => resolve[0]!(current()))
    expect(content()).toContain('讨论了录音存储方案')
    expect(callArkme).toHaveBeenCalledTimes(2)
    await act(async () => resolve[1]!({ ...current(), freshness: 'changed' }))
    expect(content()).toContain('有新内容可更新')
    expect(button('刷新').props.disabled).toBe(false)
    expect(callArkme).toHaveBeenCalledTimes(2)
  })
  it('does not extend the read deadline when soft invalidations arrive', async () => {
    vi.useFakeTimers()
    vi.mocked(callArkme).mockImplementationOnce(() => new Promise(() => {}) as never)
    await mount()
    const firstSignal = vi.mocked(callArkme).mock.calls[0]![2]!
    await act(async () => vi.advanceTimersByTimeAsync(20_000))
    await act(async () => view!.update(<ArkmeCalendarDayReview query={query} view="summary" refreshVersion={1} />))
    expect(firstSignal.aborted).toBe(false)
    await act(async () => vi.advanceTimersByTimeAsync(10_000))
    expect(firstSignal.aborted).toBe(true)
    expect(callArkme).toHaveBeenCalledTimes(1)
    expect(content()).toContain('读取超时')
    expect(button('刷新').props.disabled).toBe(false)
    await act(async () => button('刷新').props.onClick())
    expect(callArkme).toHaveBeenCalledTimes(2)
    expect(content()).toContain('讨论了录音存储方案')
  })
  it('keeps timeout recovery available under continuous hints and restores automatic reads after manual retry', async () => {
    vi.useFakeTimers()
    let late!: (value: unknown) => void
    vi.mocked(callArkme).mockImplementationOnce(() => new Promise(r => { late = r }) as never)
    await mount()
    for (const revision of [1, 2, 3, 4, 5]) {
      await act(async () => vi.advanceTimersByTimeAsync(20_000))
      await act(async () => view!.update(<ArkmeCalendarDayReview query={query} view="summary" refreshVersion={revision} />))
    }
    expect(callArkme).toHaveBeenCalledTimes(1)
    expect(content()).toContain('读取超时')
    expect(content()).not.toContain('正在读取当天回顾')
    expect(button('刷新').props.disabled).toBe(false)
    await act(async () => late(current()))
    expect(content()).not.toContain('讨论了录音存储方案')
    await act(async () => button('刷新').props.onClick())
    expect(content()).toContain('讨论了录音存储方案')
    expect(content()).not.toContain('读取超时')
    await act(async () => view!.update(<ArkmeCalendarDayReview query={query} view="summary" refreshVersion={6} />))
    expect(callArkme).toHaveBeenCalledTimes(3)
    expect(vi.mocked(callArkme).mock.calls.every(x => x[0] === 'calendar.day-review.state')).toBe(true)
  })
  it('ends a failed trailing read and permits repeated explicit retries', async () => {
    let resolve!: (value: unknown) => void
    vi.mocked(callArkme).mockImplementationOnce(() => new Promise(r => { resolve = r }) as never)
    await mount()
    await act(async () => view!.update(<ArkmeCalendarDayReview query={query} view="summary" refreshVersion={1} />))
    vi.mocked(callArkme).mockRejectedValue(new Error('连接失败'))
    await act(async () => resolve(current()))
    expect(callArkme).toHaveBeenCalledTimes(2)
    expect(content()).toContain('连接失败')
    expect(content()).not.toContain('讨论了录音存储方案')
    await act(async () => view!.update(<ArkmeCalendarDayReview query={query} view="summary" refreshVersion={2} />))
    expect(callArkme).toHaveBeenCalledTimes(2)
    await act(async () => button('刷新').props.onClick())
    expect(callArkme).toHaveBeenCalledTimes(3)
    expect(content()).toContain('连接失败')
    expect(button('刷新').props.disabled).toBe(false)
    vi.mocked(callArkme).mockResolvedValue(current())
    await act(async () => button('刷新').props.onClick())
    expect(content()).not.toContain('连接失败')
    expect(content()).toContain('讨论了录音存储方案')
  })
  it.each(['history', 'source'])('preserves %s permission failures despite queued refresh hints', async kind => {
    const historical = { ...current().result!, id: 'old' }
    const original = { kind: 'evidence', evidence: { ref: 'source-1', resultId: 'old', kind: 'call', subtype: 'imported', label: '通话原文', text: '受限原文', startAtMillis: at, endAtMillis: at } }
    vi.mocked(callArkme).mockImplementation(async method => method === 'calendar.day-review.result' ? historical : method === 'calendar.day-review.source' ? original : current() as never)
    await mount()
    await act(async () => view!.root.findByType('select').props.onChange({ target: { value: 'old' } }))
    await act(async () => button('12:00 · 录音原文').props.onClick())
    let reject!: (reason: Error) => void
    vi.mocked(callArkme).mockImplementation(method => method === (kind === 'history' ? 'calendar.day-review.result' : 'calendar.day-review.source') ? new Promise((_, r) => { reject = r }) as never : Promise.resolve(method === 'calendar.day-review.result' ? historical : method === 'calendar.day-review.source' ? original : current()) as never)
    await act(async () => { button('刷新').props.onClick() })
    await act(async () => view!.update(<ArkmeCalendarDayReview query={query} view="summary" refreshVersion={1} />))
    await act(async () => reject(new Error('来源权限已撤销')))
    const count = vi.mocked(callArkme).mock.calls.length
    expect(content()).toContain('来源权限已撤销')
    expect(content()).not.toContain('受限原文')
    await act(async () => view!.update(<ArkmeCalendarDayReview query={query} view="summary" refreshVersion={2} />))
    expect(callArkme).toHaveBeenCalledTimes(count)
    expect(content()).toContain('来源权限已撤销')
    expect(button('刷新').props.disabled).toBe(false)
  })
  it.each(['date', 'account', 'privacy'])('does not carry a read failure into a new %s scope', async change => {
    vi.mocked(callArkme).mockRejectedValueOnce(new Error('读取失败'))
    await mount()
    expect(content()).toContain('读取失败')
    await act(async () => view!.update(<ArkmeCalendarDayReview key={change === 'privacy' ? 'new' : undefined}
      query={{ ...query, ...(change === 'date' ? { bucketDate: '2026-10-14' } : change === 'account' ? { accountScope: 'prod:8' } : {}) }} view="summary" />))
    expect(callArkme).toHaveBeenCalledTimes(2)
    expect(content()).not.toContain('读取失败')
  })
  it.each(['date', 'account', 'privacy', 'close'])('discards a queued soft refresh on %s changes', async change => {
    let resolve!: (value: unknown) => void
    vi.mocked(callArkme).mockImplementationOnce(() => new Promise(r => { resolve = r }) as never)
    await mount()
    const firstSignal = vi.mocked(callArkme).mock.calls[0]![2]!
    await act(async () => view!.update(<ArkmeCalendarDayReview query={query} view="summary" refreshVersion={1} />))
    vi.mocked(callArkme).mockResolvedValue({ supported: true, result: null, job: null, versions: [], freshness: 'unknown' })
    await act(async () => {
      if (change === 'close') { view!.unmount(); view = undefined }
      else view!.update(<ArkmeCalendarDayReview key={change === 'privacy' ? 'new' : undefined}
        query={{ ...query, ...(change === 'date' ? { bucketDate: '2026-10-14' } : change === 'account' ? { accountScope: 'prod:8' } : {}) }} view="summary" />)
    })
    expect(firstSignal.aborted).toBe(true)
    await act(async () => resolve(current()))
    expect(callArkme).toHaveBeenCalledTimes(change === 'close' ? 1 : 2)
    if (view) { expect(content()).not.toContain('讨论了录音存储方案'); expect(content()).toContain('把这一天串起来') }
  })
  it('coalesces new hints during a trailing read without losing the final update', async () => {
    const resolve: Array<(value: unknown) => void> = []
    vi.mocked(callArkme).mockImplementation(() => new Promise(r => { resolve.push(r) }) as never)
    await mount()
    await act(async () => view!.update(<ArkmeCalendarDayReview query={query} view="summary" refreshVersion={1} />))
    await act(async () => resolve[0]!(current()))
    for (const revision of [2, 3, 4]) await act(async () => view!.update(<ArkmeCalendarDayReview query={query} view="summary" refreshVersion={revision} />))
    expect(callArkme).toHaveBeenCalledTimes(2)
    await act(async () => resolve[1]!(current()))
    expect(callArkme).toHaveBeenCalledTimes(3)
    await act(async () => resolve[2]!({ ...current(), freshness: 'changed' }))
    expect(content()).toContain('有新内容可更新')
    expect(button('刷新').props.disabled).toBe(false)
    expect(callArkme).toHaveBeenCalledTimes(3)
  })
  it('explains the active view without restarting or creating a job on tab changes', async () => {
    vi.mocked(callArkme).mockResolvedValue({ ...current(), result: null, job: { id: 'job', status: 'generating', message: '整理资料 5/9', resumable: false } } as never)
    await mount()
    expect(content()).toContain('生成完成后，这里会自动显示日总结。')
    const before = vi.mocked(callArkme).mock.calls.length
    await act(async () => view!.update(<ArkmeCalendarDayReview query={query} view="timeline" />))
    expect(content()).toContain('生成完成后，这里会自动显示时间轴。')
    expect(content()).not.toContain('生成完成后，这里会自动显示日总结。')
    expect(callArkme).toHaveBeenCalledTimes(before)
    expect(button('刷新').props.title).toContain('不会重新生成或扣费')
  })
  it('resumes owner progress polling only after an explicit retry recovers a failed poll', async () => {
    vi.useFakeTimers()
    const pending = { ...current(), job: { id: 'job', status: 'collecting', message: '', resumable: false } }
    vi.mocked(callArkme).mockResolvedValueOnce(pending)
    await mount()
    vi.mocked(callArkme).mockRejectedValueOnce(new Error('进度读取失败'))
    await act(async () => vi.advanceTimersByTimeAsync(5000))
    expect(content()).toContain('进度读取失败')
    await act(async () => view!.update(<ArkmeCalendarDayReview query={query} view="summary" refreshVersion={1} />))
    await act(async () => vi.advanceTimersByTimeAsync(60_000))
    expect(callArkme).toHaveBeenCalledTimes(2)
    vi.mocked(callArkme).mockResolvedValueOnce(pending)
    await act(async () => button('刷新').props.onClick())
    expect(content()).toContain('收集资料')
    await act(async () => vi.advanceTimersByTimeAsync(5000))
    expect(callArkme).toHaveBeenCalledTimes(4)
    expect(content()).not.toContain('进度读取失败')
    expect(button('更新回顾').props.disabled).toBe(false)
    expect(vi.mocked(callArkme).mock.calls.every(x => x[0] === 'calendar.day-review.state')).toBe(true)
  })
  it.each(['version', 'generate', 'resume'])('a deliberate %s action can recover after a historical refresh failure', async action => {
    vi.useFakeTimers()
    const previous = { ...current(), job: action === 'resume' ? { id: 'job', status: 'failed', message: '生成失败', resumable: true } : null }
    vi.mocked(callArkme).mockImplementation(async op => op === 'calendar.day-review.result' ? current().result : previous as never)
    await mount()
    await act(async () => view!.root.findByType('select').props.onChange({ target: { value: 'result-1' } }))
    vi.mocked(callArkme).mockImplementation(async op => { if (op === 'calendar.day-review.result') throw new Error('历史读取失败'); return previous as never })
    await act(async () => button('刷新').props.onClick())
    expect(content()).toContain('历史读取失败')
    const reads = () => vi.mocked(callArkme).mock.calls.filter(x => x[0] === 'calendar.day-review.state').length
    const before = reads()
    vi.mocked(callArkme).mockImplementation(async op => op === 'calendar.day-review.create' || op === 'calendar.day-review.resume'
      ? { ...current(), job: { id: 'job', status: 'collecting', message: '', resumable: false } } as never : op === 'calendar.day-review.models' ? modelCatalog as never : current() as never)
    if (action === 'version') {
      await act(async () => view!.root.findByType('select').props.onChange({ target: { value: '' } }))
      await act(async () => view!.update(<ArkmeCalendarDayReview query={query} view="summary" refreshVersion={1} />))
    } else {
      await act(async () => button(action === 'generate' ? '更新回顾' : '继续生成').props.onClick())
      if (action === 'generate') await act(async () => button('确认').props.onClick())
      await act(async () => vi.advanceTimersByTimeAsync(5000))
    }
    expect(reads()).toBe(before + 1)
    expect(content()).not.toContain('历史读取失败')
    expect(button('更新回顾').props.disabled).toBe(false)
    if (action === 'resume') expect(vi.mocked(callArkme).mock.calls.some(x => x[0] === 'calendar.day-review.create')).toBe(false)
  })
  it('does not read or generate before an account scope is established', async () => {
    await act(async () => { view = create(<ArkmeCalendarDayReview query={{ ...query, accountScope: '' }} view="summary" />) })
    expect(content()).toContain('账号范围尚未确认')
    expect(callArkme).not.toHaveBeenCalled()
  })
})

it('opens the existing model dialog, cancels without billing, and defaults to official DeepSeek', async()=>{
 await mount()
 await act(async()=>button('更新回顾').props.onClick())
 expect(content()).toContain('DeepSeek V4.1 Flash（官方）')
 expect(vi.mocked(callArkme).mock.calls.filter(c=>c[0]==='calendar.day-review.create')).toHaveLength(0)
 await act(async()=>button('取消').props.onClick())
 expect(vi.mocked(callArkme).mock.calls.filter(c=>c[0]==='calendar.day-review.create')).toHaveLength(0)
 await act(async()=>button('更新回顾').props.onClick())
 await act(async()=>button('确认').props.onClick())
 expect(vi.mocked(callArkme).mock.calls.find(c=>c[0]==='calendar.day-review.create')?.[1]).toMatchObject({modelCode:'deepseek-v4-flash'})
})
it('a model catalog failure keeps the prior result and does not create an uncertain payment', async()=>{
 await mount();vi.mocked(callArkme).mockRejectedValueOnce(new Error('模型目录暂不可用'))
 await act(async()=>button('更新回顾').props.onClick())
 expect(content()).toContain('模型目录暂不可用');expect(content()).toContain('讨论了录音存储方案');expect(content()).not.toContain('核对提交')
 expect(vi.mocked(callArkme).mock.calls.filter(c=>c[0]==='calendar.day-review.create')).toHaveLength(0)
})
it('requires an explicit choice when the default model is unavailable', async()=>{
 await mount()
 vi.mocked(callArkme).mockResolvedValueOnce({...modelCatalog,models:modelCatalog.models.filter(m=>m.code!=='deepseek-v4-flash')})
 await act(async()=>button('更新回顾').props.onClick())
 expect(content()).toContain('请选择模型')
 expect(button('确认').props.disabled).toBe(true)
 expect(vi.mocked(callArkme).mock.calls.filter(c=>c[0]==='calendar.day-review.create')).toHaveLength(0)
})
it.each(['qwen-flash','qwen3.8-flash'])('submits the user-selected %s through the shared model dropdown', async code=>{
 await mount()
 await act(async()=>button('更新回顾').props.onClick())
 await act(async()=>view!.root.findByProps({'aria-label':'选择生成模型'}).props.onClick({currentTarget:{getBoundingClientRect:()=>({left:0,right:280,top:0,bottom:36})}}))
 const label=modelCatalog.models.find(m=>m.code===code)!.displayName
 await act(async()=>view!.root.findAllByProps({role:'option'}).find(option=>option.props.title===label)!.props.onClick())
 await act(async()=>button('确认').props.onClick())
 expect(vi.mocked(callArkme).mock.calls.find(c=>c[0]==='calendar.day-review.create')?.[1]).toMatchObject({modelCode:code})
})
