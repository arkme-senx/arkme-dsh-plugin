// @vitest-environment jsdom
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArkmeConversationLocationView } from '../src/client/ArkmeConversationLocationView.js'
import { ArkmeLocationSearchMap } from '../src/client/ArkmeLocationSearchMap.js'
import { conversationLocationCache } from '../src/client/conversation-location-cache.js'
import type { ArkmeSourceItem } from '../src/types.js'
const mocks = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.call }))
vi.mock('../src/client/ArkmeLocationSearchMap.js', () => ({ ArkmeLocationSearchMap: () => <div data-map/> }))
let renderer: ReactTestRenderer, account: string
const source: ArkmeSourceItem = { kind: 'group_chat', sourceRef: 'chat', displayName: '当前群聊' }
const ownRecord = { recordUid: 'mine', sendAtMillis: Date.parse('2026-11-01T23:00:00Z'), sourceKind: 3,
  routeTargetKind: 'chat_timeline', title: '', textContent: '', snippet: '自己的消息', sourceTitle: '当前群聊', targetSource: source, media: [], files: [] }
const items = [
  { key: 'own', latitude: 30, longitude: 114, source: 'my_sent', locationKind: 'snapshot', label: '记录地点', address: '', record: ownRecord },
  { key: 'received', latitude: 30, longitude: 114, source: 'received_group', locationKind: 'message', label: '收到地点', address: '', record: { ...ownRecord, recordUid: 'received', snippet: '收到的消息', sendAtMillis: Date.parse('2026-11-01T05:00:00Z') } },
]
beforeEach(() => {
  account = String(Math.random()); conversationLocationCache.activate(account)
  mocks.call.mockReset(); mocks.call.mockResolvedValue({ items, scanned: 30, hasMore: false })
  vi.stubGlobal('requestAnimationFrame', () => 0)
})
afterEach(() => { if (renderer) act(() => renderer.unmount()); conversationLocationCache.activate(undefined); vi.unstubAllGlobals() })
describe('scoped location map interactions', () => {
  const view = (date = '', open = vi.fn()) => <ArkmeConversationLocationView account={account} browserAk="test" source={source}
    date={date} timezone="Asia/Shanghai" toolbar={<span>日期筛选</span>} onOpenRecord={open}/>
  it('defaults to sent locations, allows received places and opens the original chat projection', async () => {
    const open = vi.fn()
    await act(async () => { renderer = create(view('', open)) })
    const map = () => renderer.root.findByType(ArkmeLocationSearchMap)
    expect(map().props.markers.map((item: any) => item.source)).toEqual(['my_sent'])
    act(() => renderer.root.findByProps({ 'aria-label': '位置来源' }).props.onClick())
    const filters = renderer.root.findByProps({ 'aria-label': '位置来源筛选' }).findAllByType('button')
    expect(filters).toHaveLength(2)
    act(() => filters[1]!.props.onClick())
    expect(map().props.markers).toHaveLength(2)
    act(() => map().props.onSelect(map().props.markers.find((item: any) => item.source === 'received_group')))
    act(() => renderer.root.findByProps({ className: 'arkme-location-record' }).props.onClick())
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ recordUid: 'received', targetSource: source }))
  })
  it('keeps source selection across date changes and filters the full snapshot by local message date', async () => {
    await act(async () => { renderer = create(view()) })
    act(() => renderer.root.findByProps({ 'aria-label': '位置来源' }).props.onClick())
    act(() => renderer.root.findByProps({ 'aria-label': '位置来源筛选' }).findAllByType('button')[1]!.props.onClick())
    await act(async () => renderer.update(view('2026-11-01')))
    const map = renderer.root.findByType(ArkmeLocationSearchMap)
    expect(map.props.markers.map((item: any) => item.source)).toEqual(['received_group'])
    expect(mocks.call).toHaveBeenCalledTimes(1)
    await act(async () => renderer.update(view('2026-11-02')))
    expect(renderer.root.findByType(ArkmeLocationSearchMap).props.markers.map((item: any) => item.source)).toEqual(['my_sent'])
    expect(mocks.call).toHaveBeenCalledTimes(1)
  })
  it('keeps a selected cluster tied to its records while the map viewport changes', async () => {
    await act(async () => { renderer = create(view()) })
    const map = () => renderer.root.findByType(ArkmeLocationSearchMap)
    act(() => map().props.onSelect(map().props.markers[0]))
    act(() => map().props.onViewport({ bounds: { swLat: -10, neLat: 10, swLon: -10, neLon: 10 }, zoom: 5 }))
    expect(renderer.root.findAllByProps({ className: 'arkme-location-record' })).toHaveLength(1)
    expect(map().props.fitBounds).toEqual({ swLat: 30, neLat: 30, swLon: 114, neLon: 114 })
  })
  it('adds historical records to an already open cluster while reading continues', async () => {
    let resolve!: (value: unknown) => void
    mocks.call.mockImplementation(async (_operation, params) => params.cursor ? await new Promise(done => { resolve = done })
      : { items: [items[0]], scanned: 20, hasMore: true, nextCursor: 'older' })
    await act(async () => { renderer = create(view()) })
    const map = renderer.root.findByType(ArkmeLocationSearchMap)
    act(() => map.props.onSelect(map.props.markers[0]))
    await act(async () => resolve({ items: [{ ...items[0], key: 'older-position', locationKind: 'message' }], scanned: 4, hasMore: false }))
    expect(renderer.root.findAllByProps({ className: 'arkme-location-record' })).toHaveLength(2)
    expect(renderer.root.findByType(ArkmeLocationSearchMap).props.markers[0].count).toBe(2)
  })
})
