import { EncryptedReferenceCodec } from '../encrypted-reference.js'
import type { WorldSoundRequest, WorldSoundExcerpt, WorldSoundOwnerSelection } from '../world-sound-contract.js'
import { ArkmePluginError, objectValue as obj, type ServiceRuntime } from './service.js'
const invalid = () => new ArkmePluginError('world-sound-invalid','声音摘录已变化或账号已切换，请重新选择',false,409)
export function worldSoundProjection(value: unknown): WorldSoundExcerpt {
  const v=obj(value)
  if (!['recording','call'].includes(String(v.source)) || typeof v.revision!=='string' || !/^[a-f0-9]{64}$/.test(v.revision) || !Number.isSafeInteger(v.duration_ms) || Number(v.duration_ms)<=0 || Number(v.duration_ms)>600_000 || !Array.isArray(v.segments) || !v.segments.length || v.segments.length>150) throw invalid()
  let offset=0,textBytes=0
  const segments=v.segments.map(raw=>{
    const s=obj(raw)
    if(typeof s.text!=='string'||!s.text.trim()||typeof s.speaker!=='string'||s.speaker.length>80||s.offset_ms!==offset||!Number.isSafeInteger(s.duration_ms)||Number(s.duration_ms)<=0||typeof s.omitted_before!=='boolean')throw invalid()
    offset+=Number(s.duration_ms);textBytes+=new TextEncoder().encode(s.text).length
    if(offset>600_000||textBytes>60_000)throw invalid()
    return {text:s.text,speaker:s.speaker,offsetMillis:Number(s.offset_ms),durationMillis:Number(s.duration_ms),omittedBefore:s.omitted_before}
  })
  if(offset!==v.duration_ms)throw invalid()
  return {source:v.source as 'recording'|'call',revision:v.revision,durationMillis:offset,segments}
}
interface Ports {
  recording(refs: string[]): Promise<WorldSoundOwnerSelection>
  call(ref: string, ids: string[]): Promise<WorldSoundOwnerSelection>
  team(ref:string,actor:number):Promise<string|number>
  recordUID(ref:string):Promise<string>
  recordRef(uid:string):Promise<string>
}
/** One account-bound business owner shared by UI, Tools and public SDK. */
export class WorldSoundService {
  private readonly codec: EncryptedReferenceCodec
  constructor(private runtime:ServiceRuntime,private ports:Ports){this.codec=new EncryptedReferenceCodec(()=>runtime.stateStore.uniqueCode(),invalid)}
  async execute(input:WorldSoundRequest,signal?:AbortSignal):Promise<unknown>{
    const session=await this.runtime.requireSession(),account=`${this.runtime.config.environment}:${session.userId}`
    if(!input||input.accountKey!==account)throw invalid()
    const post=async(path:string,body:Record<string,unknown>,write=false)=>{
      try{return obj(await this.runtime.authenticatedWorldPost(`/api/v1/world/sound-excerpts/${path}`,body,session,signal,{lane:write?'write':'interactive-read',bypassCache:true,cacheMs:0,...(write?{requestTimeoutMs:160_000}:{})}))}
      catch(error){
        if(error instanceof ArkmePluginError&&[404,501,503].includes(error.upstreamStatus??error.httpStatus)){
          if(path==='capabilities')return {version:1,recording:false,call:false}
          throw new ArkmePluginError('world-sound-server-upgrade-required',write?'暂未确认公开操作结果，请重试核对本次操作':'声音分享服务尚未接通，请稍后再试',true,503,{cause:error})
        }
        throw error
      }
    }
    let result:unknown
    if(input.action==='capabilities'){
      const v=await post('capabilities',{});if(v.version!==1||typeof v.recording!=='boolean'||typeof v.call!=='boolean')throw invalid();result={version:1,recording:v.recording,call:v.call}
    }else if(input.action==='prepare'){
      const s=input.selection;if(!s||!['recording','call'].includes(s.kind))throw invalid()
      const capability=await post('capabilities',{})
      if(capability.version!==1||typeof capability.recording!=='boolean'||typeof capability.call!=='boolean')throw invalid()
      if(capability[s.kind]!==true)throw new ArkmePluginError('world-sound-server-upgrade-required','声音分享服务尚未接通，内容尚未发布。请稍后再试',true,503)
      const selection=s.kind==='recording'?await this.ports.recording(s.itemRefs):await this.ports.call(s.callRef,s.segmentIds)
      const data=await post('preview',selection as unknown as Record<string,unknown>),excerpt=worldSoundProjection(data)
      if(excerpt.source!==s.kind)throw invalid()
      result={draftRef:await this.codec.seal('world-sound-draft',{account,selection,revision:excerpt.revision,expires:Date.now()+86400_000}),excerpt}
    }else if(input.action==='publish'){
      if(input.confirmed!==true||typeof input.requestUid!=='string'||!/^[A-Za-z0-9_-]{16,128}$/.test(input.requestUid))throw invalid()
      const draft=await this.codec.open('world-sound-draft',input.draftRef)
      if(draft.account!==account||typeof draft.expires!=='number'||draft.expires<Date.now())throw invalid()
      const team=input.teamRef?await this.ports.team(input.teamRef,session.userId):0
      const value=await post('publish',{selection:draft.selection,revision:draft.revision,request_uid:input.requestUid,team_id:String(team)},true)
      result=await this.receipt(value)
    }else if(input.action==='management'){
      const uid=await this.ports.recordUID(input.recordRef)
      result=await this.receipt(await post('management',{record_uid:uid,withdraw:input.withdraw===true},input.withdraw===true))
    }else throw invalid()
    signal?.throwIfAborted();const current=await this.runtime.requireSession();if(current.userId!==session.userId)throw invalid();return result
  }
  private async receipt(v:Record<string,unknown>){if(typeof v.record_uid!=='string'||!/^world-sound-[a-f0-9]{64}$/.test(v.record_uid)||![1,2,3,4].includes(Number(v.check_status))||typeof v.public_requested!=='boolean')throw invalid();return {recordRef:await this.ports.recordRef(v.record_uid),checkStatus:Number(v.check_status),publicRequested:v.public_requested}}
}
