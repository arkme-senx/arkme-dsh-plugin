import { reactionPreview } from '../src/client/reaction-preview-store.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArkmeDayTimeline } from '../src/client/ArkmeDayTimeline.js'
import type { DayActivityEntry, DayActivityLocationDetail, DayActivityQuery, DayActivityReader } from '../src/client/calendar-activity-model.js'
import type { ArkmeRecordLocationObservation } from '../src/types.js'

import { reactionFixture } from './reaction-fixture.js'
vi.mock('../src/client/api.js', async importOriginal => ({ ...await importOriginal<object>(), callArkme: (operation: string, input: never) => input.accountKey === 'test:42' ? reactionFixture.call(operation, input) : Promise.resolve({items:[],has_more:false}) }))
beforeEach(() => reactionFixture.reset())
function seed(target: {id:string;source?:string;sourceKind?:string;text:string}, label:string, time:number) {
 const previous = reactionFixture.history.filter(item=>item.target_id===target.id && item.expression.text===label).at(-1)
 reactionFixture.history.push({event_uid:String(reactionFixture.history.length),target_id:target.id,expression:{text:label},active:!previous?.active,at:time,restricted:false,text:target.text,source_kind:target.sourceKind??'group_chat'})
}
const query: DayActivityQuery = { accountScope: 'account:42', bucketDate: '2026-09-19', timezone: 'Asia/Shanghai', mode: 'activities', kind: 'all', includeBackground: false }
const at = Date.parse('2026-09-19T10:00:00+08:00')
const point: ArkmeRecordLocationObservation = { source: 'device', latitude: 30.52, longitude: 114.31, label: '办公区附近', deviceLabel: '电脑' }
const entry = (id: string, location?: ArkmeRecordLocationObservation): DayActivityEntry => ({ id, kind: 'note', startAtMillis: at, endAtMillis: at,
  access: 'available', title: `记录${id}`, preview: '正文', sourceName: '发给自己', recordCount: 1, participation: 'self', canLoadLocation: true, ...(location ? { location } : {}) })
function setup(entries = [entry('a')]) {
  const loadLocation = vi.fn<NonNullable<DayActivityReader['loadLocation']>>().mockImplementation(async (query, activityId) => ({ query, activityId, snapshotId: 's', access: 'available', location: point }))
  const reader: DayActivityReader = { capabilities: { kinds: ['note'], modes: ['activities'], notice: '' },
    loadDay: vi.fn(async query => ({ query, snapshotId: 's', items: entries, completeness: 'complete', missingKinds: [], hasMore: false,
      dayStartMillis: at - 10 * 3600000, dayEndMillis: at + 14 * 3600000 })),
    loadDetail: vi.fn(async (query, activityId) => ({ query, activityId, snapshotId: 's', access: 'available', hasMore: false,
      items: [{ id: activityId, text: '详情正文', occurredAtMillis: at, author: { name: '我' } }] })), loadLocation }
  return { reader, loadLocation }
}
let view: ReactTestRenderer
function content(node: unknown): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(content).join('')
  return node && typeof node === 'object' && 'children' in node ? content(node.children) : ''
}
const text = () => content(view.toJSON())
const button = (name: string) => view.root.findAllByType('button').find(node => node.props['aria-label'] === name || content(node.props.children) === name)!
const click = async (name: string) => act(async () => button(name).props.onClick())
const select = async (id: string) => act(async () => view.root.findByProps({ 'data-activity-id': id }).findByProps({ className: 'arkme-day-entry-content' }).props.onClick())
const mount = async (reader: DayActivityReader) => act(async () => { view = create(<ArkmeDayTimeline query={query} reader={reader} onQueryChange={() => {}} />) })
afterEach(() => { act(() => view?.unmount()); reactionPreview.setScope(undefined) })

describe('reaction events in the existing day timeline', () => {
  it('uses the original compact time style without extra message metadata and reuses the source button', async () => {
    arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 42 })
    seed({ id: 'old', text: '昨天的消息' }, '收到', at)
    const originalMessage = { source: { sourceRef: 'signed', kind: 'group_chat', displayName: '项目群', activeAtMillis: 0, unreadCount: 0 }, itemUid: 'old-record', recordOwnerUserId: 7, sendAtMillis: at - 86400000 }
    Object.assign(reactionFixture.history[0]!, { originalMessage, authorName: '张三' })
    const open = vi.fn()
    await act(async () => { view = create(<ArkmeDayTimeline query={query} reader={setup([]).reader} onQueryChange={() => {}} onOpenReactionSource={open} />) })
    expect(text()).not.toContain('原消息 ·')
    expect(text()).not.toContain('2026-09-18')
    const row = view.root.findByProps({ 'aria-label': '表态动态' })
    await act(async () => row.findByType('button').props.onClick())
    const detail = view.root.findByProps({ className: 'arkme-day-detail' })
    expect(content(detail.children)).toContain('张三 · 10:00')
    expect(content(detail.children)).toContain('我 · 10:00')
    expect(content(detail.children)).not.toMatch(/2026|原消息 ·/)
    expect(button('前往原始来源').props.className).toBe('arkme-day-source')
    await click('前往原始来源')
    expect(open).toHaveBeenCalledExactlyOnceWith(originalMessage, { text: '收到' })
  })
  it('never shows source time or navigation for a restricted original message', async () => {
    arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 42 })
    seed({ id: 'restricted', text: '不可泄露' }, '收到', at)
    Object.assign(reactionFixture.history[0]!, { restricted: true, originalMessage: { sendAtMillis: at - 86400000 } })
    await act(async () => { view = create(<ArkmeDayTimeline query={query} reader={setup([]).reader} onQueryChange={() => {}} onOpenReactionSource={vi.fn()} />) })
    await act(async () => view.root.findByProps({ 'aria-label': '表态动态' }).findByType('button').props.onClick())
    expect(text()).toContain('原消息已不可访问')
    expect(text()).not.toContain('不可泄露')
    expect(text()).not.toContain('2026-09-18')
    expect(button('前往原始来源')).toBeUndefined()
  })
  it('keeps midnight operations in their local day, excluding adjacent days', async () => {
    arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 42 })
    const start = at - 10 * 3600000, end = start + 86400000
    for (const [id, timestamp] of [['previous', start - 1], ['first', start], ['last', end - 1], ['next', end]] as const) {
      seed({ id, sourceKind: 'group_chat', text: id }, '收到', timestamp)
    }
    await mount(setup([]).reader)
    const rows = view.root.findAllByProps({ 'aria-label': '表态动态' })
    expect(rows).toHaveLength(2)
    expect(content(rows[0]!.children)).toContain('23:59')
    expect(content(rows[1]!.children)).toContain('00:00')
    expect(text()).not.toContain('previous')
    expect(text()).not.toContain('next')
  })
  it('counts a reaction-only day in the existing overview and hides it from unrelated filters', async () => {
    arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 42 })
    seed({ id: 'chat', sourceKind: 'group_chat', text: '消息' }, '收到', at)
    await mount(setup([]).reader)
    expect(content(view.root.findByProps({ className: 'arkme-day-overview' }).children)).toBe('已加载：1 次表态操作')
    expect(text()).not.toContain('暂无可显示的活动')
    await click('地点')
    expect(content(view.root.findByProps({ className: 'arkme-day-overview' }).children)).not.toContain('表态操作')
  })
  it('does not announce an empty day while reaction history is still loading', async () => {
    arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 42 })
    let complete!: (value: unknown) => void
    const original = reactionFixture.call
    const pending = vi.spyOn(reactionFixture, 'call').mockImplementation(() => new Promise(resolve => { complete = resolve }) as never)
    try {
      await mount(setup([]).reader)
      expect(text()).not.toContain('这一天暂无匹配内容')
      expect(text()).toContain('正在加载表态记录')
      await act(async () => complete({items:[],has_more:false}))
      expect(text()).toContain('这一天暂无匹配内容')
    } finally { pending.mockRestore(); reactionFixture.call = original }
  })
  it('uses the existing card and sender line for authorized reaction context', async () => {
    arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 42 })
    seed({ id: 'chat', sourceKind: 'group_chat', text: '[图片]' }, '收到', at)
    Object.assign(reactionFixture.history[0]!, { sourceName: '项目讨论群', authorName: '张三' })
    await mount(setup().reader)
    const row = view.root.findByProps({ 'aria-label': '表态动态' })
    expect(content(row.children)).toContain('项目讨论群')
    expect(content(row.children)).toContain('张三：[图片]')
    expect(content(row.children)).not.toContain('原消息：')
    expect(row.findAllByProps({ className: 'arkme-day-entry-content' })).toHaveLength(1)
    await act(async () => row.findByType('button').props.onClick())
    expect(content(view.root.findByProps({ className: 'arkme-day-detail' }).children)).toContain('张三')
  })
  it.each(['activities', 'records'] as const)('keeps source categories in %s mode', async mode => {
    arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 42 })
    reactionPreview.setScope('test:42')
    seed({ id: 'chat', source: '群', sourceKind: 'group_chat', text: '聊天原文' }, '收到', at)
    seed({ id: 'note', source: '我', sourceKind: 'send_to_self', text: '个人原文' }, '完成', at)
    const { reader } = setup()
    for (const [kind, expected] of [['all', 2], ['conversation', 1], ['note', 1], ['call', 0], ['recording', 0]] as const) {
      await act(async () => { view = create(<ArkmeDayTimeline query={{ ...query, kind, mode }} reader={reader} onQueryChange={() => {}} />) })
      const rows = view.root.findAllByProps({ 'aria-label': '表态动态' })
      expect(rows).toHaveLength(expected)
      if (kind === 'conversation') expect(content(rows[0]!.children)).toContain('收到')
      if (kind === 'note') expect(content(rows[0]!.children)).toContain('完成')
      await act(async () => view.unmount())
    }
  })
  it('keeps every reaction separate in both modes and shows the loaded day history', async () => {
    arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 42 })
    reactionPreview.setScope('test:42')
    const target = { id: 'm', source: '群', sourceKind: 'group_chat' as const, text: '需要核对的原消息' }
    seed(target, '收到', at + 60000)
    seed(target, '收到', at + 120000)
    seed(target, '完成', at + 180000)
    const { reader } = setup()
    await mount(reader)
    let rows = view.root.findAllByProps({ 'aria-label': '表态动态' })
    expect(rows).toHaveLength(3)
    expect(content(rows[0]!.children)).toContain(target.text)
    expect(content(rows[0]!.children)).toContain('10:03')
    expect(content(rows[0]!.children)).toContain('表态「完成」')
    expect(content(rows[0]!.children)).not.toContain('次表态操作')
    await act(async () => rows[0]!.findByType('button').props.onClick())
    const detailPanel = view.root.findByProps({ className: 'arkme-day-detail' })
    expect(detailPanel.findAllByType('time')).toHaveLength(3)
    const detailText = content(detailPanel.children)
    expect(detailText.indexOf('原消息')).toBeLessThan(detailText.indexOf('表态「完成」'))
    expect(content(detailPanel.children)).toContain('取消表态「收到」')
    await act(async () => view.update(<ArkmeDayTimeline query={{ ...query, mode: 'records' }} reader={reader} onQueryChange={() => {}} />))
    rows = view.root.findAllByProps({ 'aria-label': '表态动态' })
    expect(rows).toHaveLength(3)
    expect(reactionFixture.history).toHaveLength(3)
  })
  it('interleaves additions and cancellations by time and respects filters and account', async () => {
    arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 42 })
    reactionPreview.setScope('test:42')
    const target = { id: 'message', source: '项目群', text: '核对报价单'.repeat(100) }
    seed(target, '已完成', at - 60000)
    seed(target, '已完成', at + 60000)
    seed(target, '收到', at - 86400000)
    const { reader } = setup()
    await mount(reader)
    const list = view.root.findByProps({ className: 'arkme-day-list' })
    const rows = list.findAllByType('article')
    expect(rows).toHaveLength(3)
    expect(content(rows[0]!.findByProps({ className: 'arkme-day-entry-meta' }).children)).toBe('10:01展开')
    expect(content(rows[2]!.findByProps({ className: 'arkme-day-entry-meta' }).children)).toBe('09:59展开')
    expect(text()).not.toContain('1 条相关内容')
    expect(rows.map(row => content(row.findAllByType('time')[0]!.children))).toEqual(['10:01', '10:00', '09:59'])
    expect(rows[0]!.findAllByType('time')[0]!.props.dateTime).toBe(new Date(at + 60000).toISOString())
    expect(rows[0]!.findByProps({ className: 'arkme-day-identity-icon' })).toBeDefined()
    expect(rows[0]!.findByProps({ className: 'arkme-day-excerpts' })).toBeDefined()
    expect(rows[0]!.findAllByType('details')).toHaveLength(0)
    const expand = rows[0]!.findByProps({ className: 'arkme-day-entry-content' })
    expect(expand.props['aria-expanded']).toBe(false)
    await act(async () => expand.props.onClick())
    const detailPanel = view.root.findByProps({ className: 'arkme-day-detail' })
    expect(content(detailPanel.children)).toContain(target.text)
    expect(content(detailPanel.children)).toContain('取消表态「已完成」')
    expect(content(detailPanel.children)).toContain('原消息')
    expect(detailPanel.findAllByType('time')).toHaveLength(2)
    const currentOperation = detailPanel.findByProps({ 'aria-current': 'true' })
    expect(content(currentOperation.children)).toContain('我 · 10:01')
    expect(content(currentOperation.children)).not.toContain('2026-09-19')
    expect(content(detailPanel.children)).not.toContain('本次操作')
    expect(content(detailPanel.children)).not.toContain('2026-09-18')
    await act(async () => rows[1]!.findByProps({ className: 'arkme-day-entry-content' }).props.onClick())
    expect(view.root.findAllByProps({ className: 'arkme-day-detail' })).toHaveLength(1)
    expect(rows[0]!.findByProps({ className: 'arkme-day-entry-content' }).props['aria-expanded']).toBe(false)
    await click('关闭活动详情')
    expect(view.root.findAllByProps({ className: 'arkme-day-detail' })).toHaveLength(0)
    expect(text()).not.toContain('仅本机')
    expect(content(rows[0]!.children)).toContain('取消表态')
    expect(content(rows[0]!.findByType('del').children)).toContain('已完成')
    expect(rows[2]!.findAllByType('del')).toHaveLength(0)
    expect(rows[1]!.props['data-activity-id']).toBe('a')
    expect(content(rows[2]!.children)).toContain('我：表态「已完成」')
    expect(text()).not.toContain('表态 · 本机体验记录')
    await click('地点')
    expect(view.root.findAllByProps({ 'aria-label': '表态动态' })).toHaveLength(0)
    await click('地点')
    await act(async () => { arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 43 }) })
    expect(view.root.findAllByProps({ 'aria-label': '表态动态' })).toHaveLength(0)
  })
})
