import { expect,it,vi } from 'vitest'
import { createArkmeSdk } from '../src/sdk/index.js'
import { dispatchArkmeHostOperation } from '../src/host-api.js'
import { createArkmeCoreToolDefinitions,arkmeToolCatalog,type ArkmeCoreToolPorts } from '../src/tools/index.js'

it('SDK uses the same account-scoped Host owner for all voice operations',async()=>{
 const owner={recordingVoiceTriggers:vi.fn(async()=>({ok:true}))}
 const sdk=createArkmeSdk({fetchImpl:async(_,init)=>{
  const body=JSON.parse(String(init?.body));const value=body.operation==='provider.capabilities'?{contractVersion:1,features:{recordingVoiceTriggersV2:true}}:await dispatchArkmeHostOperation(owner as never,body.operation,body.params)
  return new Response(JSON.stringify({ok:true,value}))
 }})
 await sdk.voiceTriggerSettings('prod:7');await sdk.voiceTriggerPage('prod:7','opaque-page');await sdk.voiceTriggerDetail('prod:7','opaque-candidate')
 await sdk.setVoiceTriggerRules('prod:7',{rules:[],revision:2,localRevision:0});await sdk.decideVoiceTrigger('prod:7',{candidateRef:'opaque-candidate',decision:'save',confirmedRange:true})
 expect(owner.recordingVoiceTriggers.mock.calls.map(c=>c[0])).toEqual(['settings','page','detail','save','decide'])
 expect(owner.recordingVoiceTriggers.mock.calls.every(c=>(c[1] as any).accountKey==='prod:7')).toBe(true)
})
it('SDK refuses unsupported providers before sending writes',async()=>{
 const fetchImpl=vi.fn(async()=>new Response(JSON.stringify({ok:true,value:{contractVersion:1,features:{}}})))
 await expect(createArkmeSdk({fetchImpl}).decideVoiceTrigger('prod:7',{candidateRef:'x',decision:'save'})).rejects.toThrow('不支持')
 expect(fetchImpl).toHaveBeenCalledOnce()
})
it('Tools register read and confirmed write grants and share the Host port',async()=>{
 const ports={automaticCapabilities:vi.fn(async()=>({accountScope:'prod:7'})),recordingVoiceTriggers:vi.fn(async(action:string)=>action==='settings'?{accountKey:'prod:7',revision:1,draft:{revision:0}}:{items:[]})}
 const definitions=createArkmeCoreToolDefinitions(ports as unknown as ArkmeCoreToolPorts)
 const read=definitions.find(t=>t.name==='arkme_recording_voice_triggers')!
 const write=definitions.find(t=>t.name==='arkme_recording_voice_trigger_command')!
 expect(read).toBeDefined();expect(write).toBeDefined()
 expect(arkmeToolCatalog.modulesFor('business').find(m=>m.meta.toolName===write.name)?.meta).toMatchObject({effect:'write',grant:'explicit-user-write'})
 await read.execute({action:'page'},{signal:new AbortController().signal} as never)
 expect(ports.recordingVoiceTriggers).toHaveBeenLastCalledWith('page',expect.objectContaining({accountKey:'prod:7'}),expect.any(AbortSignal))
 await expect(read.execute({action:'decide'} as never,{} as never)).rejects.toThrow()
 expect(ports.recordingVoiceTriggers).toHaveBeenCalledTimes(2)
 expect(ports.automaticCapabilities).not.toHaveBeenCalled()
})
