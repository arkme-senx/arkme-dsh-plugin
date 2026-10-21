import {expect,it,vi} from 'vitest'
import {ExploreService} from '../src/services/explore-service.js'
import {ArkmePluginError,type ServiceRuntime} from '../src/services/service.js'
import {createArkmeSdk} from '../src/sdk/index.js'
import {createArkmeCoreToolDefinitions,type ArkmeCoreToolPorts} from '../src/tools/index.js'

function fixture(){
 let userId=42,changed=()=>{}
 const locked=new Set<string>()
 const post=vi.fn(async(path:string,body:Record<string,unknown>)=>{
  if(path.endsWith('/entities/list'))return {protocol_version:2,snapshot:100,has_more:!body.cursor,next_cursor:body.cursor?'':'owner-cursor',entities:body.cursor?[{entity_id:'private-id-2',name:'第二人',type:1}]:[{entity_id:'private-id',name:'王明',type:1}]}
  if(path.endsWith('/entities/summary'))return {protocol_version:2,snapshot:100,total:2,type_counts:{1:2}}
  if(path.endsWith('/records/page'))return {protocol_version:2,snapshot:200,has_more:false,records:[{source_identity:{provider:'core_record',record_uid:'private-uid'},record_uid:'private-uid',content_status:'available',content:'王明和他',person_reference_status:'complete',person_references:[{start_position:3,end_position:4,text:'他',status:'resolved',target_name:'王明',confidence:.95}],mentions:[{start_position:0,end_position:2,mention_text:'王明'},{start_position:3,end_position:4,mention_text:'他'}]},{source_identity:{provider:'third_party_record',record_uid:'private-uid'},record_uid:'private-uid',content_status:'unavailable',content:'',mentions:[]}]}
  return {}
 })
 const get=vi.fn(async()=>({entities:[]}))
 const runtime={config:{environment:'test'},stateStore:{uniqueCode:async()=>'unit-only'},requireSession:async()=>({userId,refreshToken:'unit'}),subscribeAccountScope:(fn:()=>void)=>{changed=fn;return()=>{}},authenticatedRelationPost:post,authenticatedRelationGet:get} as unknown as ServiceRuntime
 const service=new ExploreService(runtime,{} as never,{} as never,{privateRemarksByUserIds:vi.fn()} as never,{lockedRecordUids:async()=>locked} as never)
 return {service,post,get,locked,switch:()=>{userId++;changed()}}
}
it('preserves the legacy directory and count contract when the owner has no paging protocol',async()=>{
 const f=fixture()
 f.post.mockResolvedValue({} as never)
 const entities=Array.from({length:60},(_,i)=>({entity_id:`legacy-${i}`,name:`person-${i}`,type:1,aliases:[]}))
 f.get.mockResolvedValue({entities} as never)
 try{
  const page=await f.service.page({module:'relations'})
  expect(page.total).toBe(60);expect(page.items).toHaveLength(50);expect(page.nextCursor).toBeDefined()
  const restored=await f.service.page({module:'relations',limit:60})
  expect(restored.items).toHaveLength(60)
  const directory=await f.service.personEntries()
  expect(directory).toHaveLength(60)
  const search=await f.service.page({module:'relations',query:'person-59'})
  expect(search.items.map(x=>x.title)).toEqual(['person-59'])
  expect(f.post.mock.calls.every(([path])=>path.endsWith('/entities/list'))).toBe(true)
  expect(f.get).toHaveBeenCalledOnce()
 }finally{f.service.dispose()}
})
it('connects the existing page to server cursors, global counts and bounded restoration without a full directory read',async()=>{
 const f=fixture(), calls:Array<Record<string,unknown>>=[]
 const rows=Array.from({length:251},(_,i)=>({entity_id:`e${i}`,name:`人物${i}`,type:i===250?2:1,aliases:i===249?['最后别名']:[]}))
 f.post.mockImplementation(async(path,body)=>{
  if(path.endsWith('/summary'))return {protocol_version:2,snapshot:100,total:body.query?1:251,type_counts:{1:250,2:1}} as never
  calls.push(body)
  const matching=body.query?rows.filter(x=>x.aliases.includes(String(body.query))):rows
  const offset=Number(body.cursor??0),limit=Number(body.limit),end=offset+limit
  return {protocol_version:2,snapshot:100,entities:matching.slice(offset,end),has_more:end<matching.length,next_cursor:end<matching.length?String(end):''} as never
 })
 try {
  const first=await f.service.page({module:'relations'})
  expect(first.items).toHaveLength(50);expect(first.total).toBe(251);expect(first.totalKnown).toBe(true)
  expect(first.filters).toEqual([{key:'',label:'全部',count:251},{key:'1',label:'人物',count:250},{key:'2',label:'组织',count:1}])
  expect(calls).toHaveLength(1);expect(calls[0]!.limit).toBe(50)
  const next=await f.service.page({module:'relations',cursor:first.nextCursor})
  expect(next.items).toHaveLength(50);expect(next.items[0]!.title).toBe('人物50');expect(next.total).toBe(251)
  expect(f.post.mock.calls.filter(([path])=>path.endsWith('/summary'))).toHaveLength(1)
  const restored=await f.service.page({module:'relations',limit:250})
  expect(restored.items).toHaveLength(250);expect(restored.nextCursor).toBeDefined()
  expect(calls.slice(-3).map(x=>x.limit)).toEqual([100,100,50])
  const search=await f.service.page({module:'relations',query:'最后别名'})
  expect(search.total).toBe(1);expect(search.items.map(x=>x.title)).toEqual(['人物249'])
  expect(f.get).not.toHaveBeenCalled()
 }finally{f.service.dispose()}
})
it('continues empty owner search windows and rejects repeated cursors, snapshot drift and cancelled restoration',async()=>{
 const f=fixture()
 try {
  f.post.mockImplementation(async(path,body)=>{
   if(path.endsWith('/summary'))return {protocol_version:2,snapshot:100,total:1,type_counts:{1:2000}} as never
   return {protocol_version:2,snapshot:100,entities:body.cursor?[{entity_id:'far',name:'远处备注',type:1}]:[],has_more:!body.cursor,search_pending:!body.cursor,next_cursor:body.cursor?'':'scan-next'} as never
  })
  expect((await f.service.page({module:'relations',query:'远处备注'})).items[0]!.title).toBe('远处备注')
  f.post.mockResolvedValue({protocol_version:2,snapshot:100,entities:[],has_more:true,search_pending:true,next_cursor:'same'} as never)
  await expect(f.service.relationPage({query:'x'})).rejects.toThrow()
  f.post.mockResolvedValueOnce({protocol_version:2,snapshot:100,entities:[],has_more:true,search_pending:true,next_cursor:'next'} as never)
  f.post.mockResolvedValueOnce({protocol_version:2,snapshot:101,entities:[],has_more:false} as never)
  await expect(f.service.relationPage({query:'x'})).rejects.toThrow()
  const c=new AbortController()
  f.post.mockImplementationOnce(async()=>{c.abort();return {protocol_version:2,snapshot:100,entities:[],has_more:true,search_pending:true,next_cursor:'next'} as never})
  await expect(f.service.relationPage({query:'x'},c.signal)).rejects.toThrow()
 }finally{f.service.dispose()}
})
it('does not replace a failed or malformed count with a page-sized total; old owners remain compatible',async()=>{
 const f=fixture()
 try {
  f.post.mockResolvedValueOnce({protocol_version:2,snapshot:100,entities:[],has_more:false} as never)
  f.post.mockRejectedValueOnce(new ArkmePluginError('upstream','counts offline',true,503))
  await expect(f.service.page({module:'relations'})).rejects.toThrow('counts offline')
  expect(f.get).not.toHaveBeenCalled()
  f.post.mockResolvedValueOnce({protocol_version:2,snapshot:100,entities:[],has_more:false} as never)
  f.post.mockRejectedValueOnce(new ArkmePluginError('unsupported','old owner',false,404))
  await f.service.page({module:'relations'})
  expect(f.get).toHaveBeenCalledOnce()
 }finally{f.service.dispose()}
})
it('uses bounded owner pages, opaque scoped cursors and grouped positions without directory downloads',async()=>{
 const f=fixture()
 try{
  const first=await f.service.relationPage({query:'备注',limit:10000})
  expect(first.totalKnown).toBe(false);expect(f.get).not.toHaveBeenCalled()
  expect(f.post.mock.calls[0]![1]).toMatchObject({limit:100,protocol_version:2,query:'备注'})
  expect(JSON.stringify(first)).not.toContain('owner-cursor');expect(JSON.stringify(first)).not.toContain('private-id')
  await expect(f.service.relationPage({query:'不同',cursor:first.nextCursor!})).rejects.toThrow()
  const second=await f.service.relationPage({query:'备注',cursor:first.nextCursor!})
  expect(second.items[0]!.title).toBe('第二人');expect(f.post.mock.calls.at(-1)![1].cursor).toBe('owner-cursor')
  const records=await f.service.relationRecordsPage(first.items[0]!.ref)
  expect(records.evidence[0]!.personReferences).toEqual([{start:3,end:4,text:'他',status:'resolved',targetName:'王明'}]);expect(records.evidence[1]!.personReferences).toEqual([]);
  expect(records.evidence).toHaveLength(2);expect(records.evidence[0]!.mentions).toHaveLength(2)
  expect(records.evidence[0]!.key).not.toBe(records.evidence[1]!.key);expect(records.evidence[1]!.ref).toBeUndefined()
  f.switch();await expect(f.service.relationPage({query:'备注',cursor:first.nextCursor!})).rejects.toThrow()
 }finally{f.service.dispose()}
})
it('falls back only for unsupported protocols; owner failures remain failures',async()=>{
 const f=fixture()
 try{
  f.post.mockRejectedValueOnce(new ArkmePluginError('upstream','offline',true,503))
  await expect(f.service.relationPage({})).rejects.toThrow('offline');expect(f.get).not.toHaveBeenCalled()
  f.post.mockRejectedValueOnce(new ArkmePluginError('unsupported','old server',false,404))
  await f.service.relationPage({});expect(f.get).toHaveBeenCalledOnce()
 }finally{f.service.dispose()}
})
it('SDK and read-only Tool expose the same cancellable methods with capability negotiation',async()=>{
 const calls:unknown[]=[]
 const sdk=createArkmeSdk({fetchImpl:async(_url,init)=>{const request=JSON.parse(String(init?.body));calls.push(request);return new Response(JSON.stringify({ok:true,value:request.operation==='provider.capabilities'?{contractVersion:1,features:{relationPages:true}}:{items:[],evidence:[]}}))}})
 await sdk.relationPage({query:'王明',includeCounts:true});await sdk.relationRecords({ref:'opaque',cursor:'next'})
 expect(calls).toContainEqual({operation:'relations.list',params:{query:'王明',includeCounts:true}})
 expect(calls).toContainEqual({operation:'relations.records',params:{ref:'opaque',cursor:'next'}})
 const ports={relationPage:vi.fn(async()=>({items:[]})),relationRecords:vi.fn(async()=>({evidence:[]}))}
 const tool=createArkmeCoreToolDefinitions(ports as unknown as ArkmeCoreToolPorts).find(x=>x.name==='arkme_relation_pages')!
 const signal=new AbortController().signal
 await tool.execute({action:'list',query:'王明',include_counts:true},{signal} as never)
 expect(ports.relationPage).toHaveBeenCalledWith({query:'王明',includeCounts:true},signal)
 await tool.execute({action:'records',ref:'opaque',cursor:'next'},{signal} as never)
 expect(ports.relationRecords).toHaveBeenCalledWith({ref:'opaque',cursor:'next'},signal)
 await expect(tool.execute({action:'records',ref:'opaque',query:'bad'},{signal} as never)).rejects.toThrow()
 const unsupported=createArkmeSdk({fetchImpl:async()=>new Response(JSON.stringify({ok:true,value:{contractVersion:1,features:{}}}))})
 await expect(unsupported.relationPage()).rejects.toThrow('不支持')
})


it('does not open a different provider through the core-record detail route even when UIDs match',async()=>{
 const f=fixture()
 try {
  const page=await f.service.relationPage({})
  f.post.mockResolvedValueOnce({protocol_version:2,snapshot:200,has_more:false,records:[{source_identity:{provider:'third_party_record',record_uid:'private-uid'},record_uid:'private-uid',content_status:'available',content:'独立第三方原文',mentions:[]}] } as never)
  const detail=await f.service.relationRecordsPage(page.items[0]!.ref)
  expect(detail.evidence[0]).toMatchObject({text:'独立第三方原文',unavailableReason:'此来源暂不支持打开详情'})
  expect(detail.evidence[0]!.ref).toBeUndefined()
 }finally{f.service.dispose()}
})

it('privacy lock removes original text, inferred names and every reference before any adapter reads it',async()=>{
 const f=fixture()
 try{
  const page=await f.service.relationPage({})
  f.locked.add('private-uid')
  const detail=await f.service.relationRecordsPage(page.items[0]!.ref)
  for(const source of detail.evidence){expect(source.text).toBe('');expect(source.ref).toBeUndefined();expect(source.personReferences).toEqual([]);expect(source.personReferenceStatus).toBe('unavailable')}
  expect(JSON.stringify(detail.evidence)).not.toContain('王明')
 }finally{f.service.dispose()}
})
