import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ArkmeDayTimeline } from '../src/client/ArkmeDayTimeline.js'
import {
  dayActivityDisplayName, dayActivityInterval, dayActivityTitle, mergeDayActivityItems,
  type DayActivityDetailPage, type DayActivityEntry, type DayActivityPage, type DayActivityQuery, type DayActivityReader,
} from '../src/client/calendar-activity-model.js'

const query: DayActivityQuery = { accountScope: 'account-a', bucketDate: '2026-09-19', timezone: 'Asia/Shanghai',
  mode: 'activities', kind: 'all', includeBackground: false }
const start = Date.parse('2026-09-19T00:00:00+08:00')
const hour = 3_600_000
const entry = (id: string, changes: Partial<DayActivityEntry> = {}): DayActivityEntry => ({ id, kind: 'private_chat',
  startAtMillis: start + 9 * hour, endAtMillis: start + 9.5 * hour, access: 'available', title: '原始昵称标题',
  preview: '本段讨论内容', sourceName: '原始昵称', participant: { name: '昵称', remark: '备注名' }, recordCount: 2,
  participation: 'participated', ...changes })
const page = (items: DayActivityEntry[], changes: Partial<DayActivityPage> = {}): DayActivityPage => ({ query, snapshotId: 'v1',
  items, completeness: 'complete', missingKinds: [], hasMore: false, dayStartMillis: start, dayEndMillis: start + 24 * hour,
  coverage: { state: 'ready', intervals: [] }, ...changes })
const detail = (activityId: string, changes: Partial<DayActivityDetailPage> = {}): DayActivityDetailPage => ({ query,
  snapshotId: 'v1', activityId, access: 'available', hasMore: false, sourceRef: 'opaque-source',
  items: [{ id: 'message-1', occurredAtMillis: start + 9 * hour, author: { name: '用户昵称', remark: '用户备注' }, text: '详情文本' }], ...changes })
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
function content(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (Array.isArray(value)) return value.map(content).join('')
  return value && typeof value === 'object' && 'children' in value ? content(value.children) : ''
}
let renderer: ReactTestRenderer | undefined
const text = () => content(renderer!.toJSON())
const button = (label: string) => renderer!.root.findAllByType('button').find(node => content(node.props.children) === label)!
const activityButton = (id: string) => renderer!.root.findByProps({ 'data-activity-id': id }).findByType('button')
function reader() {
  return { loadDay: vi.fn<DayActivityReader['loadDay']>().mockResolvedValue(page([entry('a')])),
    loadDetail: vi.fn<DayActivityReader['loadDetail']>().mockResolvedValue(detail('a')) }
}
async function mount(source: DayActivityReader | undefined, q = query, navigate = vi.fn(), change = vi.fn()) {
  await act(async () => { renderer = create(<ArkmeDayTimeline query={q} {...(source ? { reader: source } : {})}
    onQueryChange={change} onOpenSource={navigate} />) })
}
afterEach(() => { act(() => { renderer?.unmount() }); renderer = undefined })

describe('day activity read model', () => {
  it('prefers remarks, distinguishes received messages, and hides restricted titles', () => {
    expect(dayActivityTitle(entry('a'))).toBe('与 备注名 的私聊')
    expect(dayActivityTitle(entry('a', { participation: 'received' }))).toBe('收到 备注名 的消息')
    expect(dayActivityTitle(entry('a', { access: 'restricted' }))).toBe('内容已不可访问')
    expect(dayActivityDisplayName({ name: '昵称', remark: '  ' })).toBe('昵称')
    expect(dayActivityDisplayName({ name: '' })).toBe('未命名用户')
  })
  it('deduplicates explicit IDs only, updates revoked entries and preserves overlapping independent activities', () => {
    const result = mergeDayActivityItems([entry('a'), entry('b')], [entry('a', { access: 'restricted' }), entry('c')])
    expect(result.map(item => item.id)).toEqual(['a', 'b', 'c'])
    expect(result[0]!.access).toBe('restricted')
  })
  it('clips cross-day audio and supports non-24-hour days without inventing gaps', () => {
    expect(dayActivityInterval({ startAtMillis: start - hour, endAtMillis: start + hour }, start, start + 23 * hour))
      .toEqual({ left: '0%', width: `${100 / 23}%` })
    const clipped = dayActivityInterval({ startAtMillis: 8, endAtMillis: 10 }, 0, 24)!
    expect(parseFloat(clipped.left)).toBeCloseTo(100 / 3)
    expect(parseFloat(clipped.width)).toBeCloseTo(100 / 12)
    expect(dayActivityInterval({ startAtMillis: 12, endAtMillis: 14 }, 0, 24)?.left).toBe('50%')
    expect(dayActivityInterval({ startAtMillis: NaN, endAtMillis: 5 }, 0, 24)).toBeUndefined()
    expect(dayActivityInterval({ startAtMillis: 30, endAtMillis: 31 }, 0, 24)).toBeUndefined()
  })
})

describe('day timeline integration boundary', () => {
  it('does not fake an empty complete day when no adapter is installed', async () => {
    await mount(undefined)
    expect(text()).toContain('多维活动数据尚未接入')
    expect(text()).not.toContain('这一天暂无匹配内容')
  })
  it('does not read while account identity is unavailable', async () => {
    const source = reader()
    await mount(source, { ...query, accountScope: '' })
    expect(source.loadDay).not.toHaveBeenCalled()
    expect(text()).toContain('账号范围尚未确认')
  })
  it('loads one page, uses remark names and does not auto-load details, navigate or mark read', async () => {
    const source = reader(); const navigate = vi.fn()
    await mount(source, query, navigate)
    expect(source.loadDay).toHaveBeenCalledExactlyOnceWith(query, { signal: expect.any(AbortSignal) })
    expect(text()).toContain('与 备注名 的私聊')
    expect(text()).not.toContain('原始昵称')
    expect(source.loadDetail).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
    await act(async () => { activityButton('a').props.onClick() })
    expect(source.loadDetail).toHaveBeenCalledExactlyOnceWith(query, 'a', { signal: expect.any(AbortSignal), snapshotId: 'v1' })
    expect(text()).toContain('用户备注')
    expect(text()).not.toContain('用户昵称')
    expect(navigate).not.toHaveBeenCalled()
    act(() => { button('前往原始来源').props.onClick() })
    expect(navigate).toHaveBeenCalledExactlyOnceWith('opaque-source')
  })
  it('passes mode/filter choices to the adapter query instead of pretending loaded records are the whole day', async () => {
    const change = vi.fn(); const source = reader()
    await mount(source, query, vi.fn(), change)
    act(() => { button('原始明细').props.onClick() })
    expect(change).toHaveBeenLastCalledWith({ ...query, mode: 'records', includeBackground: true })
    act(() => { button('录音').props.onClick() })
    expect(change).toHaveBeenLastCalledWith({ ...query, kind: 'recording' })
    act(() => { button('对话').props.onClick() })
    expect(change).toHaveBeenLastCalledWith({ ...query, kind: 'conversation' })
    act(() => { renderer!.root.findByType('input').props.onChange({ target: { checked: true } }) })
    expect(change).toHaveBeenLastCalledWith({ ...query, includeBackground: true })
  })
  it('combines five source tabs into conversations while preserving the source labels and details', async () => {
    const q: DayActivityQuery = { ...query, kind: 'conversation' }
    const source = reader()
    source.loadDay.mockResolvedValue(page((['private_chat', 'group_chat', 'arko', 'bot', 'dsh', 'note', 'call', 'recording'] as const)
      .map(kind => entry(kind, { kind })), { query: q }))
    source.loadDetail.mockResolvedValue(detail('arko', { query: q }))
    await mount(source, q)
    const filters = renderer!.root.findByProps({ 'aria-label': '活动类型' }).findAllByType('button')
    expect(filters.map(node => content(node.props.children))).toEqual(['全部', '个人记录', '对话', '通话', '录音'])
    expect(button('对话').props['aria-pressed']).toBe(true)
    expect(renderer!.root.findAllByType('article').filter(node => node.props['data-activity-id'])
      .map(node => node.props['data-activity-id']).sort()).toEqual(['arko', 'bot', 'dsh', 'group_chat', 'private_chat'])
    for (const label of ['私聊', '群聊', 'Arko', 'Bot', 'DSH']) expect(text()).toContain(label)
    await act(async () => { activityButton('arko').props.onClick() })
    expect(source.loadDetail).toHaveBeenCalledWith(q, 'arko', { signal: expect.any(AbortSignal), snapshotId: 'v1' })
    expect(text()).toContain('详情文本')
    expect(renderer!.root.findByType('input')).toBeDefined()
  })
  it.each([
    { kinds: ['arko'] as const, visible: true },
    { kinds: ['note', 'recording'] as const, visible: false },
  ])('shows the conversation tab only for supported conversation sources: $kinds', async ({ kinds, visible }) => {
    const source = { ...reader(), capabilities: { kinds, modes: ['activities'] as const, notice: '' } }
    await mount(source)
    expect(Boolean(button('对话'))).toBe(visible)
  })
  it('distinguishes partial data, complete empty data and failed reads', async () => {
    const source = reader(); source.loadDay.mockResolvedValue(page([], { completeness: 'partial', missingKinds: ['group_chat', 'recording'] }))
    await mount(source)
    expect(text()).toContain('群聊、录音尚未完整覆盖')
    expect(text()).toContain('已加载来源中暂无匹配内容')
    expect(text()).not.toContain('这一天暂无匹配内容')
    source.loadDay.mockRejectedValueOnce(new Error('网络不可用'))
    await act(async () => { renderer!.root.findByProps({ 'aria-label': '刷新当天活动' }).props.onClick() })
    expect(text()).toContain('网络不可用')
    expect(text()).not.toContain('暂无匹配内容')
    source.loadDay.mockResolvedValueOnce(page([]))
    await act(async () => { button('重试').props.onClick() })
    expect(text()).toContain('这一天暂无匹配内容')
  })
  it('keeps a load-more control for a filtered empty page rather than declaring no records', async () => {
    const source = reader(); source.loadDay.mockResolvedValue(page([entry('background', { participation: 'background' })], { hasMore: true, nextCursor: 'next' }))
    await mount(source)
    expect(text()).toContain('本页没有匹配内容，可继续加载')
    expect(button('加载更多')).toBeDefined()
  })
  it.each(['accountScope', 'bucketDate', 'timezone', 'kind'] as const)('does not display a late response after changing %s', async field => {
    const pending = deferred<DayActivityPage>(); const source = reader()
    source.loadDay.mockReturnValueOnce(pending.promise)
    await mount(source)
    const oldSignal = source.loadDay.mock.calls[0]![1].signal
    const next = { ...query, [field]: { accountScope: 'account-b', bucketDate: '2026-09-18', timezone: 'UTC', kind: 'call' }[field] } as DayActivityQuery
    source.loadDay.mockResolvedValueOnce(page([], { query: next }))
    await act(async () => { renderer!.update(<ArkmeDayTimeline query={next} reader={source} onQueryChange={() => {}} />) })
    expect(oldSignal.aborted).toBe(true)
    await act(async () => { pending.resolve(page([entry('old', { preview: '旧账号内容' })])) })
    expect(text()).not.toContain('旧账号内容')
  })
  it('aborts a detail read on close and does not expose its late result', async () => {
    const pending = deferred<DayActivityDetailPage>(); const source = reader(); source.loadDetail.mockReturnValueOnce(pending.promise)
    await mount(source)
    await act(async () => { activityButton('a').props.onClick() })
    const signal = source.loadDetail.mock.calls[0]![2].signal
    await act(async () => { renderer!.root.findByProps({ 'aria-label': '关闭活动详情' }).props.onClick() })
    expect(signal.aborted).toBe(true)
    await act(async () => { pending.resolve(detail('a')) })
    expect(text()).not.toContain('详情文本')
  })
  it('does not accept a detail response belonging to a different activity', async () => {
    const source = reader(); source.loadDetail.mockResolvedValue(detail('other', { items: [
      { id: 'wrong', occurredAtMillis: start, author: { name: 'other' }, text: '错位详情' },
    ] }))
    await mount(source)
    await act(async () => { activityButton('a').props.onClick() })
    expect(text()).not.toContain('错位详情')
    expect(text()).toContain('活动详情已变化')
  })
  it('loads detail pages only on demand and deduplicates explicit source record IDs', async () => {
    const source = reader()
    source.loadDetail.mockResolvedValueOnce(detail('a', { hasMore: true, nextCursor: 'd2' }))
      .mockResolvedValueOnce(detail('a', { items: [...detail('a').items,
        { id: 'message-2', occurredAtMillis: start + 9.2 * hour, author: { name: '我' }, text: '后一条原文' }] }))
    await mount(source)
    await act(async () => { activityButton('a').props.onClick() })
    expect(source.loadDetail).toHaveBeenCalledTimes(1)
    await act(async () => { button('加载更多原始记录').props.onClick(); button('加载更多原始记录').props.onClick() })
    expect(source.loadDetail).toHaveBeenCalledTimes(2)
    expect(renderer!.root.findAllByProps({ className: 'arkme-day-message' })).toHaveLength(2)
    expect(text()).toContain('后一条原文')
  })
  it('deduplicates pagination and prevents concurrent requests', async () => {
    const next = deferred<DayActivityPage>(); const source = reader()
    source.loadDay.mockResolvedValueOnce(page([entry('a')], { hasMore: true, nextCursor: 'p2' })).mockReturnValueOnce(next.promise)
    await mount(source)
    act(() => { const more = button('加载更多'); more.props.onClick(); more.props.onClick() })
    expect(source.loadDay).toHaveBeenCalledTimes(2)
    expect(source.loadDay.mock.calls[1]![1]).toMatchObject({ cursor: 'p2', snapshotId: 'v1' })
    await act(async () => { next.resolve(page([entry('a'), entry('b')])) })
    expect(renderer!.root.findAllByType('article').filter(n => n.props['data-activity-id'])).toHaveLength(2)
  })
  it.each(['query', 'snapshot', 'cursor'])('fails closed for mismatched %s on pagination', async mismatch => {
    const source = reader()
    source.loadDay.mockResolvedValueOnce(page([entry('a')], { hasMore: true, nextCursor: 'p2' }))
    source.loadDay.mockResolvedValueOnce(page([entry('b')], mismatch === 'query' ? { query: { ...query, accountScope: 'other' } }
      : mismatch === 'snapshot' ? { snapshotId: 'v2' } : { hasMore: true, nextCursor: 'p2' }))
    await mount(source)
    await act(async () => { button('加载更多').props.onClick() })
    expect(text()).toMatch(/版本不一致|分页已失效/)
    expect(text()).not.toContain('本段讨论内容')
  })
  it('stops a longer cursor cycle and aborts pending pagination on unmount', async () => {
    const source = reader()
    source.loadDay.mockResolvedValueOnce(page([entry('a')], { hasMore: true, nextCursor: 'p2' }))
      .mockResolvedValueOnce(page([entry('b')], { hasMore: true, nextCursor: 'p3' }))
      .mockResolvedValueOnce(page([entry('c')], { hasMore: true, nextCursor: 'p2' }))
    await mount(source)
    await act(async () => { button('加载更多').props.onClick() })
    await act(async () => { button('加载更多').props.onClick() })
    expect(text()).toContain('分页已失效')
    expect(button('加载更多')).toBeUndefined()
    const pending = deferred<DayActivityPage>()
    source.loadDay.mockResolvedValueOnce(page([entry('a')], { hasMore: true, nextCursor: 'again' })).mockReturnValueOnce(pending.promise)
    await act(async () => { button('重试').props.onClick() })
    act(() => { button('加载更多').props.onClick() })
    const signal = source.loadDay.mock.calls.at(-1)![1].signal
    act(() => { renderer!.unmount() }); renderer = undefined
    expect(signal.aborted).toBe(true)
    await act(async () => { pending.resolve(page([entry('late')])) })
  })
  it('does not retain protected preview text or allow opening a restricted row', async () => {
    const source = reader(); source.loadDay.mockResolvedValue(page([entry('a', { access: 'restricted', preview: '不可泄露' })]))
    await mount(source)
    expect(text()).toContain('内容已不可访问')
    expect(text()).not.toContain('不可泄露')
    expect(activityButton('a').props.disabled).toBe(true)
  })
  it('drops old details and the navigation action if access is revoked while loading more', async () => {
    const source = reader(); source.loadDetail.mockResolvedValueOnce(detail('a', { hasMore: true, nextCursor: 'next' }))
    source.loadDetail.mockResolvedValueOnce(detail('a', { access: 'restricted', items: [], hasMore: true, nextCursor: 'unusable' }))
    await mount(source)
    await act(async () => { activityButton('a').props.onClick() })
    expect(text()).toContain('详情文本')
    await act(async () => { button('加载更多原始记录').props.onClick() })
    expect(text()).not.toContain('详情文本')
    expect(button('前往原始来源')).toBeUndefined()
    expect(button('加载更多原始记录')).toBeUndefined()
    expect(text()).toContain('内容已不可访问')
    expect(text()).not.toContain('本段讨论内容')
  })
  it('keeps audio coverage without transcripts, preserves gaps, and never equates it with silence', async () => {
    const source = reader(); source.loadDay.mockResolvedValue(page([], { coverage: { state: 'ready', intervals: [
      { startAtMillis: start + 8 * hour, endAtMillis: start + 12 * hour, status: 'saved', sourceLabel: '本人录音' },
      { startAtMillis: start + 14 * hour, endAtMillis: start + 20 * hour, status: 'saved', sourceLabel: '本人录音' },
    ] } }))
    await mount(source)
    const segments = renderer!.root.findAllByProps({ className: 'arkme-day-recorded' }).filter(n => n.type === 'span')
    expect(segments).toHaveLength(2)
    expect(parseFloat(segments[0]!.props.style.width)).toBeCloseTo(100 / 6)
    expect(segments[1]!.props.style.width).toBe('25%')
    expect(text()).toContain('已有录音，暂无已识别人声信息；不代表静音')
  })
  it('does not draw recognized speech outside owned physical audio and marks unknown ranges', async () => {
    const source = reader(); source.loadDay.mockResolvedValue(page([], { coverage: { state: 'partial', intervals: [
      { startAtMillis: start + 8 * hour, endAtMillis: start + 10 * hour, status: 'processing', sourceLabel: '本人录音' },
    ] }, speechIntervals: [{ startAtMillis: start + 9 * hour, endAtMillis: start + 11 * hour }] }))
    await mount(source)
    const speech = renderer!.root.findAllByProps({ className: 'arkme-day-speech' }).find(n => n.type === 'span')!
    expect(parseFloat(speech.props.style.width)).toBeCloseTo(100 / 24)
    expect(text()).toContain('未覆盖区间不能断言为无录音')
  })
  it('treats unavailable coverage as unknown, not an empty audio day', async () => {
    const source = reader(); source.loadDay.mockResolvedValue(page([], { coverage: { state: 'error', intervals: [] } }))
    await mount(source)
    expect(text()).toContain('录音覆盖范围暂不可用，不代表当天没有录音')
    expect(renderer!.root.findAllByProps({ className: 'arkme-day-track' })).toHaveLength(0)
  })
})
