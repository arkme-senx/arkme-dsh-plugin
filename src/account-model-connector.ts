import { AsyncLocalStorage } from 'node:async_hooks'
import type { Context } from '@deepseek-ai/cordis'
import { createMessage, ToolCallId, type GenerateOptions, type RequestMessage, type ContentBlock, type TokenUsage, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { createHash, randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as pause } from 'node:timers/promises'
import type { ArkmeSecureValueStore } from './keychain-store.js'
import type { ArkmeService } from './arkme-service.js'
import { ACCOUNT_MODEL_PROVIDER } from './account-model-adapter.js'

interface Enrollment { id: string; secret: string }
interface Work { id: string; lease: string; deadline: number; provider: string; model: string; request: string }
interface CanonicalMessage { role: string; content: string | { type: string; text?: string; image_url?: {url:string} }[] | null; tool_call_id?: string; tool_calls?: {id:string;function:{name:string;arguments:string}}[]; provider_state?: {protocol:string;replay?:unknown} }
interface CanonicalRequest { messages: CanonicalMessage[]; tools?: {type:string;function:{name:string;description:string;parameters:Record<string,unknown>}}[];max_tokens?:number;temperature?:number }
type UsageEvent = Record<string, unknown> & { event_uid: string }
function idFor(scope: string) { return createHash('sha256').update(scope).digest('hex') }
async function modelMessages(input: CanonicalMessage[], provider: string, model: string, ctx:Context): Promise<RequestMessage[]> {
 const messages:RequestMessage[]=[]
 for(const message of input){
  const blocks:ContentBlock[]=[]
  if(typeof message.content==='string')blocks.push({type:'text',text:message.content})
  else for(const part of message.content??[]){
   if(part.type==='text'){blocks.push({type:'text',text:part.text??''});continue}
   if(part.type!=='image_url'||!part.image_url)throw new Error('Unsupported connector content')
   const match=/^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(part.image_url.url)
   const attachments=ctx.get('attachments');if(!match||!attachments)throw new Error('Connector image unavailable')
   const data=Buffer.from(match[2]!,'base64');if(data.byteLength>4<<20)throw new Error('Connector image too large')
   const refs=await attachments.saveImages([{data,mediaType:match[1] as 'image/png'|'image/jpeg'|'image/webp'|'image/gif'}]);for(const attachment of refs)blocks.push({type:'image',attachment})
  }
  for(const call of message.tool_calls??[])blocks.push({type:'tool-call',id:ToolCallId(call.id),name:call.function.name,arguments:call.function.arguments})
  if(message.role==='assistant')messages.push(createMessage({role:'assistant',content:blocks,source:{kind:'model',provider,model,...(message.provider_state?.protocol==='dsh-native'?{replayState:message.provider_state.replay}:{})}}))
  else if(message.role==='tool'){const callId=ToolCallId(message.tool_call_id??'');messages.push(createMessage({role:'tool',toolCallId:callId,content:blocks,source:{kind:'tool',callId}}))}
  else if(message.role==='system'||message.role==='developer')messages.push(createMessage({role:'system',content:blocks,source:{kind:'system-prompt'}}))
  else if(message.role==='user')messages.push({role:'user',content:blocks})
  else throw new Error('Unsupported connector role')
 }
 return messages
}

function usageWire(usage?: TokenUsage): Record<string, unknown> | undefined {
  if(!usage)return undefined
  const input=usage.inputTokens+(usage.cacheReadTokens??0)+(usage.cacheWriteTokens??0)
  if(![input,usage.outputTokens,usage.cacheReadTokens??0,usage.cacheWriteTokens??0].every(value=>Number.isSafeInteger(value)&&value>=0&&value<=1e9))return undefined
  return {prompt_tokens:input,completion_tokens:usage.outputTokens,...(usage.cacheReadTokens===undefined?{}:{prompt_tokens_details:{cached_tokens:usage.cacheReadTokens}}),...(usage.cacheWriteTokens===undefined?{}:{cache_creation_input_tokens:usage.cacheWriteTokens})}
}
export class AccountModelConnector {
  private stopped=false
  private lifetime=new AbortController()
  private serial:Promise<void>=Promise.resolve()
  private pending=new Map<string,UsageEvent[]>()
  constructor(private readonly ctx:Context,private readonly service:ArkmeService,private readonly baseUrl:string,private readonly secrets:ArkmeSecureValueStore,private readonly stateDirectory:string,private readonly scope:()=>Promise<string>){ }
  async enroll(scope:string){
    if(await this.scope()!==scope)throw new Error('账号已切换，请重新打开模型设置')
    const existing=await this.secrets.read(idFor(scope)), settings=await this.service.accountModels(scope)
    if(existing && settings.connectors.some(item=>item.uid===(JSON.parse(existing) as Enrollment).id&&!item.revoked))return settings
    const result=await this.service.accountModelHostRequest<{id:string;secret:string}>(scope,'connector/enroll',{expected_revision:settings.revision,name:hostname()})
    if(await this.scope()!==scope)throw new Error('账号已切换，请重试')
    await this.secrets.write(idFor(scope),JSON.stringify({id:result.id,secret:result.secret}));this.lifetime.abort();this.lifetime=new AbortController()
    return await this.service.accountModels(scope)
  }
  start():()=>void{
    const detach=this.service.attachModelConnectorEnroller(scope=>this.enroll(scope))
    const unsubscribe=this.service.accountScope.subscribe(()=>{this.lifetime.abort();this.lifetime=new AbortController()})
    void this.loop()
    return ()=>{this.stopped=true;this.lifetime.abort();detach();unsubscribe()}
  }
  private async post<T>(scope:string,enrollment:Enrollment,path:string,body:unknown,signal:AbortSignal):Promise<T>{
    if(await this.scope()!==scope)throw new Error('Account changed')
    const token=(await this.service.resolveManagedAccessCredential()).reveal()
    const response=await fetch(`${this.baseUrl.replace(/\/+$/,'')}/api/v1/user-models/connector/${path}`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','X-Arkme-Connector-ID':enrollment.id,'X-Arkme-Connector-Secret':enrollment.secret},body:JSON.stringify(body),signal:AbortSignal.any([signal,AbortSignal.timeout(25000)]),redirect:'error'})
    const reader=response.body?.getReader();if(!reader)throw new Error('Connector response missing')
    const chunks:Uint8Array[]=[];let size=0
    for(;;){const item=await reader.read();if(item.done)break;size+=item.value.byteLength;if(size>12<<20){await reader.cancel();throw new Error('Connector response too large')};chunks.push(item.value)}
    const value=JSON.parse(Buffer.concat(chunks).toString('utf8')) as {code:number;data:T}
    if(response.status!==200 || value.code!==200 || await this.scope()!==scope)throw new Error('Connector request failed')
    return value.data
  }
  private async loop(){
    while(!this.stopped){
      const signal=this.lifetime.signal
      try{
        const scope=await this.scope();void this.flush(scope).catch(()=>{})
        const raw=await this.secrets.read(idFor(scope))
        if(!raw){await pause(2000,undefined,{signal});continue}
        const enrollment=JSON.parse(raw) as Enrollment
        const value=await this.post<{work:Work|null}>(scope,enrollment,'poll',{},signal)
        if(value.work)await this.execute(scope,enrollment,value.work,signal)
      }catch{if(!this.stopped && !signal.aborted)await pause(2000).catch(()=>{})}
    }
  }
  private async execute(scope:string,enrollment:Enrollment,work:Work,parent:AbortSignal){
    if(work.provider==='arkme-managed'||work.provider.startsWith('arkme-user-'))return
    const controller=new AbortController(),signal=AbortSignal.any([parent,controller.signal,AbortSignal.timeout(Math.max(1,work.deadline-Date.now()))])
    let finished=false,usage:TokenUsage|undefined,finish:Extract<StreamChunk,{type:'finish'}>|undefined
    let bytes=0
    const text:string[]=[],tools=new Map<number,{id:string;name:string;arguments:string}>()
    const heartbeat=async()=>{while(!finished&&!signal.aborted){await pause(2000,undefined,{signal}).catch(()=>{});if(finished||signal.aborted)return;try{if(!(await this.post<{active:boolean}>(scope,enrollment,'status',{id:work.id},signal)).active)controller.abort()}catch{controller.abort()}}}
    try{
      const body=JSON.parse(Buffer.from(work.request,'base64').toString('utf8')) as CanonicalRequest
      const prepared=await this.ctx.llm.prepareCall({provider:work.provider,model:work.model,...(body.max_tokens?{maxTokens:body.max_tokens}:{}),...(body.temperature===undefined?{}:{temperature:body.temperature})},signal)
      // Acknowledged durable start precedes the only provider dispatch. An
      // uncertain start response cannot be replayed into a second provider call.
      await this.post(scope,enrollment,'start',{id:work.id,lease:work.lease},signal);void heartbeat()
      const options:GenerateOptions={...prepared.config,messages:await modelMessages(body.messages,work.provider,work.model,this.ctx),...(body.tools?.length?{tools:body.tools.map(tool=>tool.function)}:{}),signal}
      await this.connectorCalls.run(true,async()=>{
      for await(const chunk of prepared.stream(options)){
        if(chunk.type==='text-delta'){bytes+=Buffer.byteLength(chunk.text);text.push(chunk.text)}
        else if(chunk.type==='tool-call-delta'){bytes+=Buffer.byteLength(chunk.argumentsDelta);const previous=tools.get(chunk.index)??{id:chunk.id,name:chunk.name??'',arguments:''};previous.arguments+=chunk.argumentsDelta;if(chunk.name)previous.name=chunk.name;tools.set(chunk.index,previous)}
        else if(chunk.type==='usage')usage=chunk.usage
        else if(chunk.type==='finish')finish=chunk
        if(bytes>6<<20||tools.size>128)throw new Error('Connector response too large')
      }
      })
      const failed=!finish||finish.reason.kind==='error'||finish.reason.kind==='aborted'
      const reply={id:work.id,model:work.model,choices:[{index:0,finish_reason:tools.size?'tool_calls':finish?.reason.kind==='max-tokens'?'length':'stop',message:{role:'assistant',content:text.join(''),...(tools.size?{tool_calls:[...tools.values()].map(call=>({id:call.id,type:'function',function:{name:call.name,arguments:call.arguments}}))}:{}),...(finish?.replayState?{provider_state:{protocol:'dsh-native',replay:finish.replayState}}:{})}}],...(usageWire(usage)?{usage:usageWire(usage)}:{})}
      await this.post(scope,enrollment,'finish',{id:work.id,lease:work.lease,reply:Buffer.from(JSON.stringify(reply)).toString('base64'),error:failed?'failed':''},parent)
    }catch{
      if(!parent.aborted)await this.post(scope,enrollment,'finish',{id:work.id,lease:work.lease,reply:Buffer.from(JSON.stringify({usage:usageWire(usage)})).toString('base64'),error:signal.aborted?'canceled':'failed'},parent).catch(()=>{})
    }finally{finished=true;controller.abort()}
  }
  observe(options:GenerateOptions,next:()=>AsyncIterable<StreamChunk>):AsyncIterable<StreamChunk>{
    const owner=this
    return(async function*(){
      if(owner.connectorCalls.getStore()||options.provider==='arkme-managed'||options.provider===ACCOUNT_MODEL_PROVIDER){yield*next();return}
      // Capture ownership concurrently. Observation never gates native model IO.
      const began=Date.now()
      let usage:TokenUsage|undefined,finish:Extract<StreamChunk,{type:'finish'}>|undefined
      const capturedScope=owner.scope().catch(()=>undefined)
      try{for await(const chunk of next()){if(chunk.type==='usage')usage=chunk.usage;if(chunk.type==='finish')finish=chunk;yield chunk}}
      finally{
        const wire=usageWire(usage),input=wire?.prompt_tokens as number|undefined,output=wire?.completion_tokens as number|undefined
        const cached=usage?.cacheReadTokens,creation=usage?.cacheWriteTokens
        const key=createHash('sha256').update(JSON.stringify([options.provider,options.model])).digest('hex')
        const userMessage=[...options.messages].reverse().find(message=>message.role==='user')
        const operation=userMessage&&'id'in userMessage?String(userMessage.id):randomUUID()
        const event:UsageEvent={event_uid:randomUUID(),schema_version:1,source_service:'dsh-host/reported',account_model_uid:key,model_source:'host-local',scene_key:'dsh',trigger_kind:'manual',operation_uid:operation,provider:options.provider,model_key:options.model,model_display_name:options.model,call_mode:2,call_status:finish?.reason.kind==='aborted'?4:!finish||finish.reason.kind==='error'?2:1,usage_field_mask:wire?3|(cached===undefined?0:4)|(creation===undefined?0:16):0,prompt_tokens:input??0,completion_tokens:output??0,cached_tokens:cached??0,cache_creation_input_tokens:creation??0,duration_ms:Date.now()-began,created_at:Date.now(),error_type:!finish?'outcome_unknown':finish.reason.kind==='aborted'?'canceled':finish.reason.kind==='error'?'failed':''}
        // Connector executions are already recorded by the durable gateway.
        if(!owner.connectorCalls.getStore())void capturedScope.then(scope=>scope?owner.enqueue(scope,event):undefined).catch(()=>owner.ctx.logger.warn('Arkme model usage outbox could not be persisted'))
      }
    })()
  }
  private readonly connectorCalls=new AsyncLocalStorage<boolean>()
  private path(scope:string){return join(this.stateDirectory,`model-usage-${idFor(scope)}.json`)}
  private async entries(scope:string){let entries=this.pending.get(scope);if(entries)return entries;try{const raw=await readFile(this.path(scope),'utf8');if(raw.length>8<<20)throw new Error('Usage outbox too large');entries=JSON.parse(raw) as UsageEvent[]}catch(error){if((error as {code?:string}).code!=='ENOENT')throw error;entries=[]};this.pending.set(scope,entries);return entries}
  private async persist(scope:string,entries:UsageEvent[]){await mkdir(this.stateDirectory,{recursive:true,mode:0o700});const target=this.path(scope),temporary=`${target}.${randomUUID()}.tmp`;await writeFile(temporary,JSON.stringify(entries),{mode:0o600});await rename(temporary,target)}
  private async enqueue(scope:string,event:UsageEvent){const action=async()=>{const entries=await this.entries(scope);if(entries.length>=5000)throw new Error('Model usage outbox is full');entries.push(event);await this.persist(scope,entries)};this.serial=this.serial.then(action,action);await this.serial;void this.flush(scope).catch(()=>{})}
  private flushing=false
  private async flush(scope:string){if(this.flushing)return;this.flushing=true;try{await this.serial;const entries=await this.entries(scope),batch=entries.slice(0,50);if(!batch.length)return;await this.service.accountModelHostRequest(scope,'host-usage/report',{events:batch},this.lifetime.signal);const ids=new Set(batch.map(event=>event.event_uid));const action=async()=>{const current=await this.entries(scope);const remaining=current.filter(event=>!ids.has(event.event_uid));await this.persist(scope,remaining);this.pending.set(scope,remaining)};this.serial=this.serial.then(action,action);await this.serial}finally{this.flushing=false}}
}
