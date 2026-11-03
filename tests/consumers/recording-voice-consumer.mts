import { createArkmeSdk, type RecordingVoiceSettings, type RecordingVoiceCandidate, type RecordingVoiceRule } from '@senguoyun/dsh-arkme/sdk'
function check(value:unknown):asserts value {if(!value)throw new Error('Public consumer assertion failed')}
async function rejects(promise:Promise<unknown>){try{await promise}catch{return}throw new Error('Expected rejection')}
const rules:RecordingVoiceRule[]=[{id:'note',phrase:'帮我记一下',aliases:[],enabled:true,autoSaveSelf:true,action:'save-self'}]
const settings:RecordingVoiceSettings={accountKey:'prod:7',available:true,revision:2,rules,draft:{revision:0,rules:[]}}
const candidate:RecordingVoiceCandidate={candidateKey:'opaque-key',candidateRef:'opaque-ref',revision:3,phrase:rules[0]!.phrase,text:'明天回电。',startAtMillis:1700000000000,endAtMillis:1700000001000,speaker:'unknown',speakerLabel:'未识别说话人',status:'saved',boundary:'complete',recordUID:'native-record',evidence:{kind:'transcript',model:'deepseek-v4.1-flash',match:'literal'}}
const calls:Array<{operation:string;params:Record<string,unknown>}>=[]
const sdk=createArkmeSdk({fetchImpl:async(_,init)=>{
 if(init?.signal?.aborted)throw new DOMException('Aborted','AbortError')
 const request=JSON.parse(String(init?.body));calls.push(request)
 const value=request.operation==='provider.capabilities'?{contractVersion:1,features:{recordingVoiceTriggersV2:true}}:request.operation==='recordings.voice-triggers.decide'?candidate:request.operation==='recordings.voice-triggers.rules.set'?settings:request.params.action==='page'?{items:[candidate]}:request.params.action==='detail'?{items:[]}:settings
 return new Response(JSON.stringify({ok:true,value}))
}})
const initial = await sdk.voiceTriggerSettings('prod:7')
check(initial.available && initial.rules[0]?.enabled === true)
check(calls.every(call => call.operation !== 'recordings.voice-triggers.rules.set' && call.operation !== 'account.capabilities.update'))
check((await sdk.voiceTriggerPage('prod:7')).items[0]?.recordUID==='native-record')
await sdk.voiceTriggerDetail('prod:7','opaque-ref')
await sdk.setVoiceTriggerRules('prod:7',{rules,revision:2,localRevision:0})
check((await sdk.decideVoiceTrigger('prod:7',{candidateRef:'opaque-ref',decision:'save',confirmedRange:true})).status==='saved')
check(calls.filter(x=>x.operation!=='provider.capabilities').every(x=>x.params.accountKey==='prod:7'))
check(calls.at(-1)?.params.confirmedRange===true)
let writes=0
const unsupported=createArkmeSdk({fetchImpl:async(_,init)=>{
 if(JSON.parse(String(init?.body)).operation!=='provider.capabilities')writes++
 return new Response(JSON.stringify({ok:true,value:{contractVersion:1,features:{}}}))
}})
await rejects(unsupported.decideVoiceTrigger('prod:7',{candidateRef:'opaque-ref',decision:'save'}));check(writes===0)
const controller=new AbortController();controller.abort();await rejects(sdk.voiceTriggerPage('prod:7',undefined,controller.signal))
sdk.dispose();sdk.dispose();unsupported.dispose()
console.log('External immutable public SDK voice consumer passed: types, discovery, scoped five operations, uncertain confirmation, durable receipt, unsupported, abort, idempotent dispose')
