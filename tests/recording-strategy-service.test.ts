import { expect, it, vi } from 'vitest'
import { RecordingStrategyService } from '../src/services/recording-strategy-service.js'
import type { ServiceRuntime } from '../src/services/service.js'
import { createArkmeSdk } from '../src/sdk/index.js'
import { dispatchArkmeHostOperation } from '../src/host-api.js'
import type { ArkmeService } from '../src/arkme-service.js'
import { recordingStrategyTools } from '../src/tools/business/recordings/strategies.js'

const id='0123456789abcdef01234567', other='abcdef0123456789abcdef01'
function fixture(){
 let userId=7
 const post=vi.fn(async (path:string)=>{
  if(path.endsWith('/sources')) return {items:[{id,file_name:'meeting.wav',start_at:1000}]}
  if(path.endsWith('/options')) return {strategies:[{id:'system-sd-asr/v1',name:'当前方案'},{id:'baseline-sd-asr/20261026',name:'基线方案'}],official_strategy:'system-sd-asr/v1',expires_at:2000,can_start:false,results:[{strategy:'baseline-sd-asr/20261026',complete:true}]}
  if(path.endsWith('/page')) return {items:[{result_id:other,ordinal:0,media_source:'comparison',start_at:1000,end_at:1800,speaker:2,text:'您好'}],complete:true}
  return {}
 })
 const refs=new Map<string,Record<string,unknown>>()
 const playback=vi.fn(async()=> 'opaque-playback')
 const service=new RecordingStrategyService({requireSession:async()=>({userId}), authenticatedAudioPost:post} as unknown as ServiceRuntime,{
  openSession:async()=>({sessionId:id}),seal:async payload=>{const ref=`opaque-${refs.size}`;refs.set(ref,payload);return ref},
  open:async ref=>{const value=refs.get(ref);if(!value||value.viewerUserId!==userId)throw new Error('wrong owner');return value},playback,
 })
 return {service,post,refs,playback,setUser:(id:number)=>{userId=id}}
}
it('reads completed comparison after expiry and issues only an opaque playback capability',async()=>{
 const f=fixture()
 const sources=await f.service.request({action:'sources',sessionRef:'session'}) as any
 const sourceRef=sources.items[0].sourceRef
 expect(JSON.stringify(sources)).not.toContain(id)
 const options=await f.service.request({action:'options',sourceRef}) as any
 expect(options.canStart).toBe(false);expect(options.results[0].complete).toBe(true)
 const page=await f.service.request({action:'page',sourceRef,strategy:'baseline-sd-asr/20261026'}) as any
 expect(page.items[0].text).toBe('您好');expect(JSON.stringify(page)).not.toContain(other)
 expect(await f.service.request({action:'playback',itemRef:page.items[0].itemRef})).toMatchObject({playbackRef:'opaque-playback',endOffsetMillis:800})
 expect(f.playback).toHaveBeenCalledWith(7,{child_id:other,source:'comparison',ordinal:0},undefined)
 f.setUser(8)
 await expect(f.service.request({action:'page',sourceRef,strategy:'baseline-sd-asr/20261026'})).rejects.toThrow('wrong owner')
})
it('rejects missing strategy, foreign cursors and identity changes before exposing data',async()=>{
 const f=fixture();const sourceRef=((await f.service.request({action:'sources',sessionRef:'session'})) as any).items[0].sourceRef
 await expect(f.service.request({action:'start',sourceRef})).rejects.toThrow()
 f.refs.set('cursor',{version:1,viewerUserId:7,kind:'page',sourceId:other,strategy:'baseline-sd-asr/20261026',part:0,offset:0})
 await expect(f.service.request({action:'page',sourceRef,strategy:'baseline-sd-asr/20261026',cursor:'cursor'})).rejects.toThrow()
 f.post.mockImplementationOnce(async()=>{f.setUser(8);return {items:[],complete:true}})
 await expect(f.service.request({action:'page',sourceRef,strategy:'baseline-sd-asr/20261026'})).rejects.toThrow()
 expect(f.post.mock.calls.filter(([path])=>path.endsWith('/start'))).toHaveLength(0)
})
it('shares Host owner while keeping read and start grants distinct',async()=>{
 const recordingStrategies=vi.fn(async()=>({accepted:true}));const service={recordingStrategies} as unknown as ArkmeService
 await expect(dispatchArkmeHostOperation(service,'recordings.strategies',{action:'start'})).rejects.toThrow()
 await dispatchArkmeHostOperation(service,'recordings.strategies.start',{sourceRef:'source',strategy:'baseline-sd-asr/20261026'})
 expect(recordingStrategies).toHaveBeenCalledWith({action:'start',sourceRef:'source',strategy:'baseline-sd-asr/20261026'},undefined)
 expect(recordingStrategyTools.map(tool=>tool.meta)).toMatchObject([{effect:'read'},{effect:'write',grant:'explicit-user-write'}])
})
it('SDK preserves initial choice and refuses an older Host rather than silently using default',async()=>{
 const calls:any[]=[]
 let capable=true
 const sdk=createArkmeSdk({fetchImpl:async(_url,init)=>{const b=JSON.parse(String(init?.body));calls.push(b);return new Response(JSON.stringify({ok:true,value:b.operation==='provider.capabilities'?{contractVersion:1,features:{recordingStrategiesV1:capable,recordingFileImport:true}}:{accepted:true}}),{headers:{'Content-Type':'application/json'}})}})
 const input={fileRef:'arkme-file-v1.12345678-1234-1234-1234-123456789012',startAtMillis:Date.now()-1000,ownership:'self' as const,strategy:'baseline-sd-asr/20261026' as const}
 await sdk.importRecordingFile(input)
 expect(calls.at(-1).params.strategy).toBe(input.strategy)
 await sdk.recordingStrategies({action:'start',sourceRef:'opaque',strategy:input.strategy})
 expect(calls.at(-1).operation).toBe('recordings.strategies.start')
 capable=false
 const old=createArkmeSdk({fetchImpl:async()=>new Response(JSON.stringify({ok:true,value:{contractVersion:1,features:{}}}),{headers:{'Content-Type':'application/json'}})})
 await expect(old.recordingStrategies({action:'catalog'})).rejects.toThrow('不支持')
})
