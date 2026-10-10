import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ArkmeDayRecap, DayRecordingReview, latestDayRecordingReview } from '../src/client/ArkmeDayRecap.js'
import { buildDayRecapInput, type DayRecapGenerator } from '../src/client/day-recap-input.js'
import { dayActivityOverview, dayActivityPeriod, type DayActivityEntry, type DayActivityQuery } from '../src/client/calendar-activity-model.js'
import { DAY_RECAP_MAX_CHARS, dayRecapText, parseDayRecapInput, parseDayRecapPoints, type DayRecapResult } from '../src/day-recap.js'
import type { ArkmeRecordingVersion } from '../src/types.js'

const query: DayActivityQuery = { accountScope: 'prod:1', bucketDate: '2026-09-19', timezone: 'Asia/Shanghai', kind: 'all', mode: 'activities', includeBackground: false }
const entry = (id = 'one', changes: Partial<DayActivityEntry> = {}): DayActivityEntry => ({ id, kind: 'private_chat',
  startAtMillis: Date.parse('2026-09-19T14:00:00+08:00'), endAtMillis: Date.parse('2026-09-19T14:02:00+08:00'),
  title: '昵称', participant: { name: '昵称', remark: '备注名' }, sourceName: '', preview: '讨论明天的计划', access: 'available',
  recordCount: 2, participation: 'self', ...changes })
const result: DayRecapResult = { points: [{ text: '讨论明天的计划', sourceIds: ['a1'] }], modelName: '测试模型', generatedAtMillis: Date.now() }
const version = (id: string, changes: Partial<ArkmeRecordingVersion> = {}): ArkmeRecordingVersion => ({ id, status: 'done', selectable: true,
  content: '已有录音回顾', generatedAtMillis: 1000, modelDisplayName: '既有模型', timelineEvents: [], generationStage: 0, error: '', ...changes })
function text(node: unknown): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(text).join('')
  return node && typeof node === 'object' && 'children' in node ? text(node.children) : ''
}
let view: ReactTestRenderer | undefined
const content = () => text(view!.toJSON())
const button = (label: string) => view!.root.findAllByType('button').find(button => text(button.props.children) === label)!
afterEach(() => { act(() => view?.unmount()); view = undefined })

describe('bounded daily recap material', () => {
  it('allowlists only visible available excerpts and uses remarks, not private handles or coordinates', () => {
    const { input, sources } = buildDayRecapInput(query, [entry('hidden', { access: 'restricted', preview: '秘密' }),
      entry('note:private-id', { sourceIdentity: 'opaque-private-handle', location: { source: 'device', latitude: 30.1234, longitude: 114.4567 } })])
    expect(input.items).toHaveLength(1)
    expect(input.items[0]?.title).toBe('备注名')
    expect(JSON.stringify(input)).not.toMatch(/秘密|opaque-private-handle|latitude|30.1234|note:private-id/)
    expect(sources.get('a1')?.activityId).toBe('note:private-id')
  })
  it('caps both item count and serialized text size without extra reads', () => {
    const { input } = buildDayRecapInput(query, Array.from({ length: 100 }, (_, i) => entry(String(i), { preview: '内容'.repeat(200) })))
    expect(input.items.length).toBeLessThanOrEqual(24)
    expect(input.items.length).toBeGreaterThan(0)
    expect(JSON.stringify(input.items).length).toBeLessThanOrEqual(DAY_RECAP_MAX_CHARS)
    expect(parseDayRecapInput(input)).toEqual(input)
  })
  it('redacts coordinate pairs and URLs in excerpts', () => {
    expect(dayRecapText('位置 30.1234,114.1234 https://example.com/?token=secret', 240)).toBe('位置 [坐标已省略] [链接]')
  })
  it.each([{ consent: false }, { items: [] }, { bucketDate: '2026-02-31' }, { timezone: 'unknown' }])('rejects invalid or unapproved input %j', change => {
    expect(() => parseDayRecapInput({ ...buildDayRecapInput(query, [entry()]).input, ...change })).toThrow()
  })
  it('rejects duplicate ids, unknown evidence, empty or oversized generated points', () => {
    const input = buildDayRecapInput(query, [entry()]).input
    expect(() => parseDayRecapInput({ ...input, items: [input.items[0], input.items[0]] })).toThrow()
    for (const points of [[], [{ text: '编造', sourceIds: ['a99'] }], [{ text: '无来源', sourceIds: [] }], [{ text: 'x'.repeat(241), sourceIds: ['a1'] }]]) {
      expect(() => parseDayRecapPoints(JSON.stringify({ points }), input)).toThrow('来源')
    }
    expect(parseDayRecapPoints('```json\n' + JSON.stringify(result) + '\n```', input)).toEqual(result.points)
  })
  it('keys evidence by account, date, filter, original identity and content', () => {
    const before = buildDayRecapInput(query, [entry()]).key
    expect(buildDayRecapInput(query, [entry()]).key).toBe(before)
    for (const change of [{ accountScope: 'prod:2' }, { bucketDate: '2026-09-18' }, { kind: 'conversation' as const }]) {
      expect(buildDayRecapInput({ ...query, ...change }, [entry()]).key).not.toBe(before)
    }
    expect(buildDayRecapInput(query, [entry('two')]).key).not.toBe(before)
    expect(buildDayRecapInput(query, [entry('one', { preview: '变更' })]).key).not.toBe(before)
  })
  it('uses requested timezone periods and labels loaded counts honestly in both modes', () => {
    expect(dayActivityPeriod(Date.parse('2026-09-19T12:00Z'), 'Asia/Shanghai')).toBe('晚上')
    expect(dayActivityPeriod(Date.parse('2026-09-19T12:00Z'), 'America/Los_Angeles')).toBe('凌晨')
    expect(dayActivityOverview([entry(), entry('no', { access: 'restricted' }), entry('c', { kind: 'call' })], 'activities')).toBe('已加载：1 段对话 · 1 次通话')
    expect(dayActivityOverview([entry()], 'records')).toBe('已加载：1 条对话记录')
  })
})

describe('manual recap UI', () => {
  const mount = async (generate: DayRecapGenerator, onSource = vi.fn()) => {
    await act(async () => { view = create(<ArkmeDayRecap query={query} entries={[entry()]} generate={generate} onSource={onSource} />) })
  }
  it('does not generate on render or first click; shows consent and actual excerpts', async () => {
    const generate = vi.fn<DayRecapGenerator>().mockResolvedValue(result)
    await mount(generate)
    expect(generate).not.toHaveBeenCalled()
    act(() => button('生成 AI 小结').props.onClick())
    expect(generate).not.toHaveBeenCalled()
    expect(content()).toContain('可能消耗额度')
    expect(content()).toContain('查看本次发送的摘录')
    expect(content()).toContain('讨论明天的计划')
    act(() => button('暂不生成').props.onClick())
    expect(generate).not.toHaveBeenCalled()
  })
  it('generates once, opens cited source, and reuses unchanged result when toggled or rerendered', async () => {
    const generate = vi.fn<DayRecapGenerator>().mockResolvedValue(result), open = vi.fn()
    await mount(generate, open)
    act(() => button('生成 AI 小结').props.onClick())
    await act(async () => button('确认生成').props.onClick())
    expect(generate).toHaveBeenCalledTimes(1)
    expect(generate.mock.calls[0]?.[0].consent).toBe(true)
    act(() => button('来源1').props.onClick())
    expect(open).toHaveBeenCalledExactlyOnceWith('one')
    act(() => button('收起小结').props.onClick())
    act(() => button('展开小结').props.onClick())
    await act(async () => view!.update(<ArkmeDayRecap query={query} entries={[entry()]} generate={generate} onSource={open} />))
    expect(generate).toHaveBeenCalledTimes(1)
    expect(content()).toContain('非完整全天回顾')
  })
  it('hides old content after evidence is revoked and cannot regenerate without available evidence', async () => {
    const generate = vi.fn<DayRecapGenerator>().mockResolvedValue(result)
    await mount(generate)
    act(() => button('生成 AI 小结').props.onClick())
    await act(async () => button('确认生成').props.onClick())
    await act(async () => view!.update(<ArkmeDayRecap query={query} entries={[entry('one', { access: 'restricted' })]} generate={generate} onSource={vi.fn()} />))
    expect(content()).not.toContain('讨论明天的计划')
    expect(button('更新 AI 小结').props.disabled).toBe(true)
  })
  it.each(['accountScope', 'bucketDate'] as const)('aborts pending work and discards a late result after %s changes', async field => {
    let done!: (value: DayRecapResult) => void
    const generate = vi.fn<DayRecapGenerator>(() => new Promise(resolve => { done = resolve }))
    await mount(generate)
    act(() => button('生成 AI 小结').props.onClick())
    await act(async () => button('确认生成').props.onClick())
    const next = { ...query, [field]: field === 'bucketDate' ? '2026-09-18' : 'prod:2' }
    await act(async () => view!.update(<ArkmeDayRecap query={next} entries={[entry()]} generate={generate} onSource={vi.fn()} />))
    expect(generate.mock.calls[0]?.[1].aborted).toBe(true)
    await act(async () => done(result))
    expect(content()).not.toContain('测试模型')
  })
  it('shows failures without automatic retry and cancellation aborts the host request', async () => {
    const generate = vi.fn<DayRecapGenerator>().mockRejectedValue(new Error('余额不足'))
    await mount(generate)
    act(() => button('生成 AI 小结').props.onClick())
    await act(async () => button('确认生成').props.onClick())
    expect(content()).toContain('余额不足')
    expect(generate).toHaveBeenCalledTimes(1)
    generate.mockImplementation(() => new Promise(() => {}))
    act(() => button('生成 AI 小结').props.onClick())
    await act(async () => button('确认生成').props.onClick())
    act(() => button('取消生成').props.onClick())
    expect(generate.mock.calls[1]?.[1].aborted).toBe(true)
  })
})

describe('reuse existing recording AI without generating', () => {
  it('chooses the latest completed selectable version, not a newer failed or locked one', () => {
    const section = { state: 'ready' as const, message: '', items: [version('old'), version('new', { generatedAtMillis: 2000 }),
      version('failed', { status: 'failed', generatedAtMillis: 3000 }), version('locked', { selectable: false, generatedAtMillis: 4000 })] }
    expect(latestDayRecordingReview(section)?.id).toBe('new')
  })
  it('keeps the recording-only scope and date explicit, separate from activity cards', () => {
    act(() => { view = create(<DayRecordingReview page={{ query, items: [], snapshotId: 'v1', hasMore: false, completeness: 'partial', missingKinds: [],
      dayStartMillis: 1, dayEndMillis: 2, recordingReview: { summary: { state: 'ready', message: '', items: [version('v')] },
        timeline: { state: 'error', message: '', items: [] } } }} />) })
    expect(content()).toContain('2026-09-19 的录音来源回顾，不代表全天全部活动')
    expect(content()).toContain('已有录音回顾')
    expect(content()).toContain('部分录音回顾读取失败')
    expect(view!.root.findAllByType('button')).toHaveLength(0)
  })
})
