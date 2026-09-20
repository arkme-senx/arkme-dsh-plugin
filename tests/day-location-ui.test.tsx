import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ArkmeDayTimeline } from '../src/client/ArkmeDayTimeline.js'
import type { DayActivityEntry, DayActivityLocationDetail, DayActivityQuery, DayActivityReader } from '../src/client/calendar-activity-model.js'
import type { ArkmeRecordLocationObservation } from '../src/types.js'

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
afterEach(() => act(() => view?.unmount()))

describe('day location presentation', () => {
  it('shows a location summary without requiring coordinates or fetching a location', async () => {
    const { reader, loadLocation } = setup([{ ...entry('summary'), canLoadLocation: false,
      locationSummary: { label: '办公室', capturedAtMillis: at } }])
    await mount(reader)
    expect(button('查看地点：办公室')).toBeDefined()
    await click('查看地点：办公室')
    expect(text()).toContain('办公室')
    expect(text()).toContain('已显示记录返回的位置摘要')
    expect(loadLocation).not.toHaveBeenCalled()
    expect(view.root.findAllByType('dl')).toHaveLength(0)
  })
  it('can automatically enrich a bounded visible window without navigation or loading message details', async () => {
    const { reader, loadLocation } = setup([entry('a'), entry('b')])
    reader.capabilities = { kinds: ['note'], modes: ['activities'], notice: '', autoLocationLimit: 1 }
    await mount(reader)
    expect(loadLocation).toHaveBeenCalledTimes(1)
    expect(loadLocation.mock.calls[0]?.[1]).toBe('a')
    expect(reader.loadDetail).not.toHaveBeenCalled()
    expect(button('查看地点：办公区附近')).toBeDefined()
    await click('地点')
    expect(view.root.findAllByProps({ 'data-activity-id': 'b' })).toHaveLength(0)
    expect(text()).toContain('没有地点标签不代表当时没有位置')
  })
  it('does not fan out on day load or activity selection; enriches the tag after explicit detail read', async () => {
    const { reader, loadLocation } = setup()
    await mount(reader); await select('a')
    expect(loadLocation).not.toHaveBeenCalled()
    await click('查看地点')
    expect(loadLocation).toHaveBeenCalledTimes(1)
    expect(button('查看地点：办公区附近')).toBeDefined()
    expect(text()).toContain('采集时间未知')
    expect(text()).toContain('电脑')
    expect(text()).toContain('不是全天完整轨迹')
    expect(text()).not.toContain('停留了')
  })
  it('opens a known location with one click and leaves locations on other events untouched', async () => {
    const { reader, loadLocation } = setup([entry('a', point), entry('b')])
    await mount(reader)
    expect(loadLocation).not.toHaveBeenCalled()
    await click('查看地点：办公区附近')
    expect(text()).toContain('坐标')
    expect(view.root.findByProps({ 'data-activity-id': 'b' }).findAllByProps({ className: 'arkme-day-location-tag' })).toHaveLength(0)
  })
  it('shows upstream failure distinctly from no location and allows retry', async () => {
    const { reader, loadLocation } = setup()
    loadLocation.mockRejectedValueOnce(new Error('地点读取失败'))
    await mount(reader); await select('a'); await click('查看地点')
    expect(text()).toContain('地点读取失败')
    expect(text()).not.toContain('没有可确认')
    await click('重试地点')
    expect(text()).toContain('办公区附近')
    expect(loadLocation).toHaveBeenCalledTimes(2)
  })
  it('removes stale inline places when the source reports no device capture', async () => {
    const { reader, loadLocation } = setup([entry('a', point)])
    loadLocation.mockResolvedValue({ query, activityId: 'a', snapshotId: 's', access: 'available' })
    await mount(reader); await click('查看地点：办公区附近')
    expect(text()).toContain('没有可确认的设备采集位置')
    expect(text()).not.toContain('办公区附近')
  })
  it('removes both text and coordinates when live access is revoked', async () => {
    const { reader, loadLocation } = setup([entry('a', point)])
    loadLocation.mockResolvedValue({ query, activityId: 'a', snapshotId: 's', access: 'restricted', location: point })
    await mount(reader); await click('查看地点：办公区附近')
    expect(text()).toContain('内容已不可访问')
    expect(text()).not.toContain('办公区附近')
    expect(text()).not.toContain('详情正文')
  })
  it.each(['close', 'date', 'account', 'refresh'])('cancels in-flight location and discards late results on %s', async action => {
    const { reader, loadLocation } = setup()
    let resolve!: (value: DayActivityLocationDetail) => void
    loadLocation.mockReturnValue(new Promise(done => { resolve = done }))
    await mount(reader); await select('a'); await click('查看地点')
    const signal = loadLocation.mock.calls[0]![2].signal
    if (action === 'close') await click('关闭活动详情')
    else if (action === 'refresh') await click('刷新当天活动')
    else await act(async () => view.update(<ArkmeDayTimeline query={{ ...query, ...(action === 'date' ? { bucketDate: '2026-09-18' } : { accountScope: 'account:43' }) }} reader={reader} onQueryChange={() => {}} />))
    expect(signal.aborted).toBe(true)
    await act(async () => resolve({ query, activityId: 'a', snapshotId: 's', access: 'available', location: point }))
    expect(text()).not.toContain('办公区附近')
  })
  it('rejects a location result from a mismatched activity', async () => {
    const { reader, loadLocation } = setup()
    loadLocation.mockResolvedValue({ query, activityId: 'b', snapshotId: 's', access: 'available', location: point })
    await mount(reader); await select('a'); await click('查看地点')
    expect(text()).toContain('地点结果已变化')
    expect(text()).not.toContain('办公区附近')
  })
})
