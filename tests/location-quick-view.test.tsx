// @vitest-environment jsdom
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArkmeLocationQuickView } from '../src/client/ArkmeLocationQuickView.js'
import { ArkmeLocationSearchMap } from '../src/client/ArkmeLocationSearchMap.js'
import { locationSearchCache } from '../src/client/location-search-cache.js'
const mocks = vi.hoisted(() => ({ call: vi.fn(), auth: {auth:{status:'authenticated',userId:42,environment:'test'},config:{baiduMapBrowserAk:'test-ak'}} }))
vi.mock('../src/client/api.js',()=>({callArkme:mocks.call}))
vi.mock('../src/client/auth-store.js',()=>({arkmeAuthStore:{subscribe:()=>()=>{},getSnapshot:()=>mocks.auth}}))
vi.mock('../src/client/ArkmeLocationSearchMap.js',()=>({ArkmeLocationSearchMap:()=> <div data-map />}))
const text = (node: any): string => typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join('') : node ? text(node.children ?? node.props?.children) : ''
const marker = (key: string, source='quick_note') => ({key,source,latitude:39,longitude:116,count:4,label:key,preview:''})
const row = (key: string) => ({key,label:key,address:'地址',latitude:39,longitude:116,source:'quick_note',record:{recordUid:key,textContent:key,sendAtMillis:1791800000000}})
const page = (items: any[], extra={}) => ({items,hasMore:false,truncated:false,nextOffset:0,...extra})
let renderer: ReactTestRenderer
beforeEach(()=>{
  mocks.call.mockReset()
  mocks.auth = {auth:{status:'authenticated',userId:Math.random(),environment:'test'},config:{baiduMapBrowserAk:'test-ak'}}
  locationSearchCache.activate(`test:${mocks.auth.auth.userId}`)
  vi.stubGlobal('requestAnimationFrame', () => 0)
  mocks.call.mockImplementation(async (_op,query)=>query.mode==='viewport' ? {markers:[marker('one'),marker('two','received_group')],truncated:false} : page([row('recent')]))
})
afterEach(()=>{ if(renderer) act(()=>renderer.unmount()); vi.unstubAllGlobals() })
describe('location quick view',()=>{
  it('never replaces a wide empty viewport with the latest local location',async()=>{
    mocks.call.mockResolvedValue({markers:[],truncated:false})
    await act(async()=>{renderer=create(<ArkmeLocationQuickView onOpenRecord={()=>{}} />)})
    const initial = renderer.root.findByType(ArkmeLocationSearchMap).props.initialViewport
    const wide = {bounds:{swLat:0,swLon:-180,neLat:70,neLon:180},zoom:3}
    await act(async()=>renderer.root.findByType(ArkmeLocationSearchMap).props.onViewport(wide))
    expect(mocks.call.mock.calls.map(call=>call[1])).toEqual([
      {mode:'viewport',...initial},{mode:'viewport',...wide},
    ])
    expect(renderer.root.findByType(ArkmeLocationSearchMap).props.initialViewport).toBe(initial)
    expect(text(renderer.toJSON())).toContain('此范围暂无位置记录')
  })
  it('keeps old pins with an updating notice and ignores an obsolete viewport response',async()=>{
    await act(async()=>{renderer=create(<ArkmeLocationQuickView onOpenRecord={()=>{}} />)})
    const initial = renderer.root.findByType(ArkmeLocationSearchMap).props.initialViewport
    let resolveOld!: (value:unknown)=>void
    mocks.call.mockImplementation((_op,query)=>query.zoom===4 ? new Promise(resolve=>{resolveOld=resolve})
      : Promise.resolve({markers:[marker('current')],truncated:false}))
    await act(async()=>renderer.root.findByType(ArkmeLocationSearchMap).props.onViewport({...initial,zoom:4}))
    expect(text(renderer.toJSON())).toContain('正在更新位置…')
    expect(text(renderer.toJSON())).not.toContain('当前范围 2')
    expect(renderer.root.findByType(ArkmeLocationSearchMap).props.markers).toHaveLength(2)
    await act(async()=>renderer.root.findByType(ArkmeLocationSearchMap).props.onViewport({...initial,zoom:5}))
    await act(async()=>resolveOld({markers:[],truncated:false}))
    expect(renderer.root.findByType(ArkmeLocationSearchMap).props.markers[0].key).toBe('current')
    expect(renderer.root.findByType(ArkmeLocationSearchMap).props.initialViewport).toBe(initial)
  })
  it('reads partitioned clusters with their producing bounds and original server key on every page',async()=>{
    const part = {bounds:{swLat:-20,swLon:100,neLat:50,neLon:180},zoom:3}
    const pin = {...marker('display-key'),clusterQuery:{...part,key:'server-key'}}
    mocks.call.mockImplementation(async (_op,query)=>query.mode==='viewport'
      ? {markers:[pin],truncated:false} : page([row(`page-${query.offset}`)],{hasMore:query.offset===0,nextOffset:query.offset+6}))
    await act(async()=>{renderer=create(<ArkmeLocationQuickView onOpenRecord={()=>{}} />)})
    await act(async()=>renderer.root.findByType(ArkmeLocationSearchMap).props.onSelect(pin))
    expect(mocks.call.mock.calls.at(-1)?.[1]).toEqual({mode:'cluster',...part,clusterKeys:['server-key'],offset:0,limit:6})
    await act(async()=>renderer.root.findByProps({className:'arkme-location-more'}).props.onClick())
    expect(mocks.call.mock.calls.at(-1)?.[1]).toEqual({mode:'cluster',...part,clusterKeys:['server-key'],offset:6,limit:20})
  })
  it('starts with only the map, expands four source filters and loads records only on selection',async()=>{
    const open = vi.fn()
    await act(async()=>{renderer=create(<ArkmeLocationQuickView onOpenRecord={open} />)})
    expect(renderer.root.findByType(ArkmeLocationSearchMap).props.markers).toHaveLength(2)
    expect(renderer.root.findAllByProps({className:'arkme-location-records'})).toHaveLength(0)
    expect(mocks.call.mock.calls.every(call=>call[1].mode==='viewport')).toBe(true)
    expect(renderer.root.findAllByProps({className:'arkme-location-filters'})).toHaveLength(0)
    act(()=>renderer.root.findByProps({'aria-label':'位置来源'}).props.onClick())
    const filters = renderer.root.findByProps({'aria-label':'位置来源筛选'}).findAllByType('button')
    expect(filters).toHaveLength(4)
    expect(filters.every(button=>button.props['aria-pressed'])).toBe(true)
    const calls = mocks.call.mock.calls.length
    act(()=>filters[3]!.props.onClick())
    expect(renderer.root.findByType(ArkmeLocationSearchMap).props.markers).toHaveLength(1)
    expect(mocks.call).toHaveBeenCalledTimes(calls)
    await act(async()=>renderer.root.findByType(ArkmeLocationSearchMap).props.onSelect(marker('one')))
    expect(renderer.root.findAllByProps({className:'arkme-location-records'})).toHaveLength(1)
    act(()=>renderer.root.findByProps({className:'arkme-location-record'}).props.onClick())
    expect(open).toHaveBeenCalledWith(expect.objectContaining({recordUid:'recent'}))
    const map = renderer.root.findByType(ArkmeLocationSearchMap)
    act(()=>renderer.root.findByProps({'aria-label':'关闭地点记录'}).props.onClick())
    expect(renderer.root.findByType(ArkmeLocationSearchMap)).toBe(map)
    expect(renderer.root.findAllByProps({className:'arkme-location-records'})).toHaveLength(0)
  })
  it('discards late responses from previous selections and keeps the selected cluster viewport for pagination',async()=>{
    let resolveOld!: (value: unknown)=>void
    const original = mocks.call.getMockImplementation()!
    mocks.call.mockImplementation((op,query,signal)=>{
      if(query.mode !== 'cluster') return original(op,query,signal)
      if(query.clusterKeys[0] === 'old') return new Promise(resolve=>{resolveOld=resolve})
      return Promise.resolve(query.offset ? page([row('next')]) : page([row('current')],{hasMore:true,nextOffset:50}))
    })
    await act(async()=>{renderer=create(<ArkmeLocationQuickView onOpenRecord={()=>{}} />)})
    const map = ()=>renderer.root.findByType(ArkmeLocationSearchMap)
    await act(async()=>map().props.onSelect(marker('old')))
    await act(async()=>map().props.onSelect(marker('current')))
    await act(async()=>resolveOld(page([row('outdated')])) )
    expect(text(renderer.toJSON())).not.toContain('outdated')
    expect(text(renderer.toJSON())).toContain('current')
    await act(async()=>map().props.onViewport({bounds:{swLat:10,swLon:20,neLat:30,neLon:40},zoom:9}))
    await act(async()=>renderer.root.findByProps({className:'arkme-location-more'}).props.onClick())
    expect(mocks.call.mock.calls.at(-1)?.[1]).toMatchObject({mode:'cluster',clusterKeys:['current'],zoom:3,offset:50})
    expect(text(renderer.toJSON())).toContain('next')
    expect(text(renderer.toJSON())).toContain('current')
  })
  it('keeps the map mounted and existing records visible when loading another page fails',async()=>{
    mocks.call.mockImplementation(async (_op,query)=>{
      if(query.mode==='viewport')return {markers:[marker('one')],truncated:false}
      if(query.offset)throw new Error('暂时离线')
      return page([row('existing')],{hasMore:true,nextOffset:20})
    })
    await act(async()=>{renderer=create(<ArkmeLocationQuickView onOpenRecord={()=>{}} />)})
    const map = renderer.root.findByType(ArkmeLocationSearchMap)
    await act(async()=>map.props.onSelect(marker('one')))
    await act(async()=>renderer.root.findByProps({className:'arkme-location-more'}).props.onClick())
    expect(renderer.root.findByType(ArkmeLocationSearchMap)).toBe(map)
    expect(text(renderer.toJSON())).toContain('existing')
    expect(text(renderer.toJSON())).toContain('暂时离线')
  })
  it('restores the selected location and records on reopening without another request',async()=>{
    await act(async()=>{renderer=create(<ArkmeLocationQuickView onOpenRecord={()=>{}} />)})
    await act(async()=>renderer.root.findByType(ArkmeLocationSearchMap).props.onSelect(marker('one')))
    const calls = mocks.call.mock.calls.length
    act(()=>renderer.unmount())
    await act(async()=>{renderer=create(<ArkmeLocationQuickView onOpenRecord={()=>{}} />)})
    expect(renderer.root.findByType(ArkmeLocationSearchMap).props.selectedKey).toBe('one')
    expect(text(renderer.toJSON())).toContain('recent')
    expect(mocks.call).toHaveBeenCalledTimes(calls)
  })
  it('clears the selected records immediately on a hard privacy/deletion invalidation',async()=>{
    await act(async()=>{renderer=create(<ArkmeLocationQuickView onOpenRecord={()=>{}} />)})
    await act(async()=>renderer.root.findByType(ArkmeLocationSearchMap).props.onSelect(marker('one')))
    mocks.call.mockImplementation(()=>new Promise(()=>{}))
    act(()=>locationSearchCache.invalidate(true))
    expect(text(renderer.toJSON())).not.toContain('recent')
    expect(renderer.root.findAllByProps({className:'arkme-location-records'})).toHaveLength(0)
    act(()=>locationSearchCache.activate(undefined))
  })
})
