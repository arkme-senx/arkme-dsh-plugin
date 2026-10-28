import { describe, expect, it, vi } from 'vitest'
import { SearchService } from '../../src/services/search-service.js'
import type { ServiceRuntime } from '../../src/services/service.js'
import { worldLocationViewport, type LocationRecords, type LocationMarkers } from '../../src/location-search.js'

const projection = (uid: string, extra = {}) => ({ record_uid: uid, record_owner_user_id: '6690025278483443577', lat: 39.9, lon: 116.4,
  poi_name: '测试地点', address: '测试地址', send_at: 1791800000000, record_core: { text_content: '相关内容' }, ...extra })
function setup(data: unknown, locked: string[] = []) {
  const post = vi.fn(async () => data)
  const runtime = { requireSession: async () => ({ userId: 42 }), authenticatedPost: post } as unknown as ServiceRuntime
  return { post, service: new SearchService(runtime, {} as never, {} as never, undefined, { lockedRecordUids: async () => new Set(locked) } as never) }
}
describe('location search mobile API contract', () => {
  it('supports a bounded list read without hydrating more records than requested', async () => {
    const { post, service } = setup({ items: [projection('anchor')], has_more: false })
    const result = await service.searchLocations({ mode: 'list', limit: 1 }) as LocationRecords
    expect(post.mock.calls[0]).toContainEqual({ limit: 1 })
    expect(result.items).toHaveLength(1)
    await expect(service.searchLocations({ mode: 'list', limit: 0 })).rejects.toThrow('位置查询范围无效')
    await expect(service.searchLocations({ mode: 'list', limit: 21 })).rejects.toThrow('位置查询范围无效')
  })
  it('hydrates thin owner projections and resolves a matching capture address without exposing protected records', async () => {
    const { post, service } = setup({})
    post.mockImplementation(async (path: string, body: any) => {
      if (path.endsWith('location/query')) return { items: ['ok', 'private', 'mismatch'].map(record_uid => ({record_uid, lat:39.9,lon:116.4})), has_more:false }
      if (path.endsWith('records/detail')) return {record_core:{record_uid:body.record_uid,owner_user_id:42,status:1,
        content_access_state:body.record_uid==='private'?2:1,origin_kind:3,text_content:'真实正文',location:{source_kind:1,lat:39.9,lon:116.4}}}
      return {record_uid:body.record_uid,location:{source_kind:1,lat:body.record_uid==='mismatch'?40:39.9,lon:116.4},position_detail:{poi:'记录时的地点'}}
    })
    const result = await service.searchLocations({mode:'list'}) as LocationRecords
    expect(result.items).toHaveLength(2)
    expect(result.items[0]).toMatchObject({label:'记录时的地点',record:{recordUid:'ok',recordOwnerUserId:42,textContent:'真实正文',routeTargetKind:'record_detail'}})
    expect(result.items[1]?.label).toBe('未命名地点')
    expect(post.mock.calls.filter(call=>call[0].endsWith('context/get'))).toHaveLength(2)
  })
  it('does not hydrate another owner through the personal detail endpoint', async () => {
    const { post, service } = setup({records:[projection('received',{poi_name:'',address:'',chat_session_uid:'chat'})],has_more:false})
    const result = await service.searchLocations({mode:'cluster',...worldLocationViewport,clusterKeys:['key']}) as LocationRecords
    expect(result.items).toHaveLength(1)
    expect(post).toHaveBeenCalledTimes(1)
    expect(result.items[0]?.record.sourceUid).toBe('chat')
  })
  it('preserves large owner IDs and list pagination while removing private records and invalid coordinates', async () => {
    const { post, service } = setup({ items: [projection('ok'), projection('locked'), projection('protected', { content_access_state: 2 }), projection('invalid', {lat:null})], has_more: true, next_cursor_send_at: 20, next_cursor_record_uid: 'next' }, ['locked'])
    const signal = new AbortController().signal
    const result = await service.searchLocations({ mode:'list', cursor:{sendAt:30,recordUid:'previous'} }, signal) as LocationRecords
    expect(post).toHaveBeenCalledWith('/api/v1/records/location/query', {limit:20,cursor_send_at:30,cursor_record_uid:'previous'}, {userId:42}, signal, {lane:'interactive-read'})
    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({ label:'测试地点',address:'测试地址',record:{recordUid:'ok',recordOwnerUserId:'6690025278483443577',textContent:'相关内容'} })
    expect(result.nextCursor).toEqual({sendAt:20,recordUid:'next'})
  })
  it('uses WGS84 bounds, carries source groups, and suppresses locked marker samples', async () => {
    const marker = {cluster_key:'key',center_lat:39,center_lon:116,count:4,source_type:'received_group'}
    const { post, service } = setup({ markers:[marker,{...marker,cluster_key:'locked',sample_record_uids:['secret']},{...marker,cluster_key:'bad',center_lat:Infinity}],truncated:true }, ['secret'])
    const result = await service.searchLocations({mode:'viewport',...worldLocationViewport}) as LocationMarkers
    expect(result.markers).toEqual([expect.objectContaining({source:'received_group',count:4,clusterQuery:{bounds:{swLat:-85,swLon:0,neLat:85,neLon:180},zoom:3,key:'key'}})])
    expect(result.truncated).toBe(true)
    expect(post.mock.calls).toHaveLength(2)
    expect(post.mock.calls[0]).toContainEqual({bounds:{sw_lat:-85,sw_lon:-180,ne_lat:85,ne_lon:-Number.MIN_VALUE},zoom:3,limit_hint:80})
    expect(post.mock.calls[1]).toContainEqual({bounds:{sw_lat:-85,sw_lon:0,ne_lat:85,ne_lon:180},zoom:3,limit_hint:80})
  })
  it('combines wide-view regions, preserves independent cluster identities and makes no record reads', async()=>{
    const {post,service}=setup({})
    post.mockImplementation(async (_path:string,body:any)=>({markers:[{
      cluster_key:'same-key',center_lat:20,center_lon:body.bounds.sw_lon<0?-100:135,count:body.bounds.sw_lon<0?7:42,source_type:'quick_note',
    }],truncated:false}))
    const result=await service.searchLocations({mode:'viewport',...worldLocationViewport}) as LocationMarkers
    expect(result.markers.map(marker=>marker.count)).toEqual([7,42])
    expect(new Set(result.markers.map(marker=>marker.key)).size).toBe(2)
    expect(result.markers.every(marker=>marker.clusterQuery?.key==='same-key')).toBe(true)
    expect(post.mock.calls.every(call=>call[0].endsWith('viewport-clusters/query'))).toBe(true)
  })
  it('bounds partition concurrency and rejects partial failures instead of claiming empty or complete data', async()=>{
    const {post,service}=setup({})
    let active=0,maximum=0
    post.mockImplementation(async()=>{
      active++;maximum=Math.max(active,maximum)
      await new Promise(resolve=>setTimeout(resolve,0));active--
      return {markers:[],truncated:false}
    })
    await service.searchLocations({mode:'viewport',bounds:{swLat:-20,neLat:30,swLon:10,neLon:5},zoom:4})
    expect(post).toHaveBeenCalledTimes(3);expect(maximum).toBe(2)
    post.mockRejectedValueOnce(new Error('暂时离线'))
    await expect(service.searchLocations({mode:'viewport',...worldLocationViewport})).rejects.toThrow('暂时离线')
  })
  it('keeps cluster identity and the original viewport across paginated detail reads', async () => {
    const { post, service } = setup({records:[projection('chat',{chat_session_uid:'chat-uid'})],has_more:true,next_offset:100})
    const result = await service.searchLocations({mode:'cluster',...worldLocationViewport,clusterKeys:['server-key'],offset:50}) as LocationRecords
    expect(post.mock.calls[0]?.[0]).toBe('/api/v1/records/location/clusters/records/query')
    expect(post.mock.calls[0]).toContainEqual({bounds:{sw_lat:-85,sw_lon:-180,ne_lat:85,ne_lon:180},zoom:3,cluster_keys:['server-key'],offset:50,limit:20})
    expect(result.items[0]?.record).toMatchObject({sourceKind:3,sourceUid:'chat-uid',recordOwnerUserId:'6690025278483443577'})
    await service.searchLocations({mode:'cluster',...worldLocationViewport,clusterKeys:['server-key'],limit:6})
    expect(post.mock.calls.at(-1)).toContainEqual({bounds:{sw_lat:-85,sw_lon:-180,ne_lat:85,ne_lon:180},zoom:3,cluster_keys:['server-key'],offset:0,limit:6})
  })
  it.each([undefined, {mode:'other'}, {mode:'viewport'}, {mode:'viewport',...worldLocationViewport,zoom:NaN}, {mode:'cluster',...worldLocationViewport,clusterKeys:[]}, {mode:'list',bounds:{swLat:40,neLat:20,swLon:0,neLon:10}}])('rejects malformed requests before contacting the server: %j', async input => {
    const { post, service } = setup({})
    await expect(service.searchLocations(input as never)).rejects.toThrow('位置查询范围无效')
    expect(post).not.toHaveBeenCalled()
  })
  it('rejects stalled pagination and malformed success payloads', async () => {
    const { service } = setup({items:[],has_more:true,next_cursor_send_at:3,next_cursor_record_uid:'same'})
    await expect(service.searchLocations({mode:'list',cursor:{sendAt:3,recordUid:'same'}})).rejects.toThrow('位置分页信息不完整')
    await expect(setup({}).service.searchLocations({mode:'list'})).rejects.toThrow('位置记录格式不完整')
  })
})
