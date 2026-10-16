import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArkmeCalendarDayReview } from '../src/client/ArkmeCalendarDayReview.js'
import { callArkme } from '../src/client/api.js'
import { parseReviewPromptConfig, parseReviewPromptSnapshot, reviewPromptStorageKey } from '../src/calendar-day-review-prompts.js'
vi.mock('../src/client/api.js', () => ({ callArkme: vi.fn() }))
vi.mock('../src/client/explore/ExploreSurface.js', () => ({ ExploreRecordingSource: () => null }))
vi.mock('../src/client/ArkmeNoteDetails.js', () => ({ ArkmeTimelineDetailDrawer: () => null }))
vi.mock('../src/client/ArkmeCallDetailContent.js', () => ({ ArkmeCallDetailContent: () => null }))
const q = { accountScope: 'prod:7', bucketDate: '2026-10-15', timezone: 'Asia/Shanghai' }
const defaults = { baseVersion: 'calendar-v1', constraints: '保持来源与人物身份',
  summary: { instruction: '归纳进展', chunk: '保留分段证据', aggregate: '合并总结' }, timeline: { instruction: '按发生时间组织', chunk: '保留局部事件', aggregate: '合并时间轴' } }
const support = { supported: true, snapshotReuse: true, defaults }
const result = { id: 'r1', snapshotId: 's1', generatedAtMillis: Date.now(), modelName: '模型', sourceKinds: ['audio'],
  coverage: [], sources: [], summary: [{ text: '旧结果仍然保留', sourceRefs: [] }], timeline: [], promptSnapshot: defaults }
const state = { supported: true, job: null, result, hasNewContent: false, versions: [] }
let view: ReactTestRenderer | undefined, storage: Map<string, string>
const text = (node: any): string => typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join('') : node?.children ? text(node.children) : ''
const content = () => text(view!.toJSON())
const button = (name: string) => view!.root.findAllByType('button').find(b => text(b.props.children) === name)!
const input = (name: string) => view!.root.findByProps({ 'aria-label': name })
const mount = async () => act(async () => { view = create(<ArkmeCalendarDayReview query={q} view="summary" />) })
const edit = async (name: string, value: string) => act(async () => input(name).props.onChange({ target: { value } }))
beforeEach(() => {
  storage = new Map()
  vi.stubGlobal('window', { localStorage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v) } })
  vi.mocked(callArkme).mockReset().mockImplementation(async (op) => op === 'calendar.day-review.prompts' ? support : state)
})
afterEach(() => { act(() => view?.unmount()); view = undefined; vi.unstubAllGlobals() })
describe('calendar prompt editing and actual generation binding', () => {
  it('loads real defaults lazily, edits both outputs and submits exact saved stages', async () => {
    await mount(); expect(callArkme).toHaveBeenCalledTimes(1)
    await act(async () => button('提示词').props.onClick())
    expect(input('日总结主要提示词').props.value).toBe('归纳进展')
    await edit('日总结主要提示词', '关注结论与进展')
    expect(button('更新回顾').props.disabled).toBe(true)
    await act(async () => button('时间轴').props.onClick())
    await edit('时间轴主要提示词', '按事件发生时间组织')
    await edit('时间轴分段整理指令', '保留时间精度和证据')
    await act(async () => button('保存配置').props.onClick())
    expect(button('更新回顾').props.disabled).toBe(false)
    expect(content()).toContain('提示词已修改，重新生成后生效')
    await act(async () => button('更新回顾').props.onClick())
    const params = vi.mocked(callArkme).mock.calls.find(c => c[0] === 'calendar.day-review.create')![1]
    expect(params).toMatchObject({ promptConfig: { baseVersion: 'calendar-v1', summary: { instruction: '关注结论与进展', chunk: '保留分段证据' }, timeline: { instruction: '按事件发生时间组织', chunk: '保留时间精度和证据' } } })
    expect(params).not.toHaveProperty('constraints')
    expect(content()).toContain('旧结果仍然保留')
  })
  it('restores unsaved drafts across date/remount and isolates accounts', async () => {
    await mount(); await act(async () => button('提示词').props.onClick()); await edit('日总结主要提示词', '未保存的测试要求')
    await act(async () => view!.update(<ArkmeCalendarDayReview query={{ ...q, bucketDate: '2026-10-14' }} view="summary" />))
    await act(async () => button('提示词 · 未保存').props.onClick())
    expect(input('日总结主要提示词').props.value).toBe('未保存的测试要求')
    await act(async () => button('保存配置').props.onClick())
    act(() => view!.unmount()); await mount()
    await act(async () => button('提示词 · 自定义').props.onClick())
    expect(input('日总结主要提示词').props.value).toBe('未保存的测试要求')
    await act(async () => view!.update(<ArkmeCalendarDayReview query={{ ...q, accountScope: 'prod:8' }} view="summary" />))
    await act(async () => button('提示词').props.onClick())
    expect(input('日总结主要提示词').props.value).toBe('归纳进展')
  })
  it('keeps offline text as drafts, does not invent defaults, and blocks unsupported generation', async () => {
    vi.mocked(callArkme).mockImplementation(async op => op === 'calendar.day-review.prompts' ? { supported: false, snapshotReuse: false } : state)
    await mount(); await act(async () => button('提示词').props.onClick())
    expect(input('日总结主要提示词').props.value).toBe('')
    await edit('日总结主要提示词', '后端接通后测试')
    await act(async () => button('保存草稿').props.onClick())
    expect(content()).toContain('尚未用于生成')
    expect(button('更新回顾').props.disabled).toBe(true)
    expect(vi.mocked(callArkme).mock.calls.filter(c => c[0] === 'calendar.day-review.create')).toHaveLength(0)
    await act(async () => button('恢复默认').props.onClick())
    expect(button('更新回顾').props.disabled).toBe(false)
    expect(JSON.parse(storage.get(reviewPromptStorageKey(q.accountScope))!)).toEqual({ schemaVersion: 1 })
  })
  it('requires explicit adoption when the server defaults version changes', async () => {
    storage.set(reviewPromptStorageKey(q.accountScope), JSON.stringify({ schemaVersion: 1, saved: { ...defaults, baseVersion: 'old' } }))
    await mount(); await act(async () => button('提示词 · 自定义').props.onClick())
    expect(button('更新回顾').props.disabled).toBe(true)
    await act(async () => button('保留内容并采用当前规则').props.onClick())
    await act(async () => button('保存配置').props.onClick())
    expect(button('更新回顾').props.disabled).toBe(false)
  })
  it('retries the same exact prompt and evidence selection after an unknown acknowledgement', async () => {
    await mount(); await act(async () => button('提示词').props.onClick())
    await edit('日总结主要提示词', '新的关注点'); await act(async () => button('保存配置').props.onClick())
    const reuse = view!.root.findByProps({ className: 'day-review-reuse' }).findByType('input')
    await act(async () => reuse.props.onChange({ target: { checked: true } }))
    vi.mocked(callArkme).mockRejectedValueOnce(new Error('network'))
    await act(async () => button('更新回顾').props.onClick())
    const first = vi.mocked(callArkme).mock.calls.filter(c => c[0] === 'calendar.day-review.create')[0]![1]
    expect(first).toMatchObject({ reuseResultId: 'r1', sourceKinds: ['audio'] })
    expect(view!.root.findAllByType('fieldset').every(f => f.props.disabled)).toBe(true)
    await act(async () => button('核对提交').props.onClick())
    expect(vi.mocked(callArkme).mock.calls.filter(c => c[0] === 'calendar.day-review.create')[1]![1]).toEqual(first)
  })
  it('fills offline untouched fields from real defaults without replacing authored instructions', async () => {
    storage.set(reviewPromptStorageKey(q.accountScope), JSON.stringify({ schemaVersion: 1, saved: {
      baseVersion: '', summary: { instruction: '保留这个关注点', chunk: '', aggregate: '' }, timeline: { instruction: '', chunk: '', aggregate: '' },
    } }))
    await mount(); await act(async () => button('提示词 · 未保存').props.onClick())
    expect(input('日总结主要提示词').props.value).toBe('保留这个关注点')
    expect(input('日总结分段整理指令').props.value).toBe('保留分段证据')
    expect(button('更新回顾').props.disabled).toBe(true)
    await act(async () => button('保存配置').props.onClick())
    expect(button('更新回顾').props.disabled).toBe(false)
  })
  it('warns when browser persistence fails, rather than claiming a durable save', async () => {
    window.localStorage.setItem = () => { throw new Error('quota') }
    await mount(); await act(async () => button('提示词').props.onClick()); await edit('日总结主要提示词', '当前页内容')
    await act(async () => button('保存配置').props.onClick())
    expect(content()).toContain('配置仅保留在当前页面')
    expect(input('日总结主要提示词').props.value).toBe('当前页内容')
  })
  it('rejects oversized or incomplete generation configs but permits an explicitly local incomplete draft', () => {
    expect(() => parseReviewPromptConfig({ ...defaults, summary: { ...defaults.summary, instruction: '' } })).toThrow()
    expect(() => parseReviewPromptConfig({ ...defaults, summary: { ...defaults.summary, instruction: 'x'.repeat(20001) } })).toThrow()
    expect(() => parseReviewPromptSnapshot({ ...defaults, constraints: '' })).toThrow()
    expect(parseReviewPromptConfig({ ...defaults, baseVersion: '' }, true).baseVersion).toBe('')
  })
})
