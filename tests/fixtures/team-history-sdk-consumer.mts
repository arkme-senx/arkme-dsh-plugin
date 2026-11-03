// Compile and execute outside the plugin source against the packed public SDK.
import { ArkmeSdk, type TeamHistoryOptions, type TeamHistoryResponse, type TeamHistoryExportChunk } from '@senguoyun/dsh-arkme/sdk'
const operations:string[]=[]
const empty:TeamHistoryResponse={state:'ready',messages:[],words:[],days:[],participants:[],hasMore:false}
const chunk:TeamHistoryExportChunk={chunkBase64:'',chunkSha256:'a'.repeat(64),bytes:0,sha256:'a'.repeat(64),offset:0,complete:true,fileName:'团队对话.md'}
const sdk=new ArkmeSdk({fetchImpl:async(_input,init)=>{
 init?.signal?.throwIfAborted()
 const request=JSON.parse(String(init?.body));operations.push(request.operation)
 const value=request.operation==='provider.capabilities'?{contractVersion:1,features:{teamHistoryV1:true}}:request.operation==='team.history.export-chunk'?chunk:empty
 return new Response(JSON.stringify({ok:true,value}))
}})
const options:TeamHistoryOptions={sender:'self',timezone:'Asia/Shanghai',requestId:'stable-request',analysisKind:'words'}
if((await sdk.teamHistory('opaque-conversation','analysis/create',options)).state!=='ready')throw new Error('history failed')
if(!(await sdk.readTeamHistoryExportChunk('opaque-result','resume')).complete)throw new Error('chunk failed')
const controller=new AbortController();controller.abort()
try{await sdk.teamHistory('opaque','query',{},controller.signal);throw new Error('abort was ignored')}catch(error){if(error instanceof Error&&error.message==='abort was ignored')throw error}
let unsupportedCalls=0
const old=new ArkmeSdk({fetchImpl:async()=>{unsupportedCalls++;return new Response(JSON.stringify({ok:true,value:{contractVersion:1,features:{}}}))}})
try{await old.teamHistory('opaque','query');throw new Error('old provider accepted')}catch(error){if(error instanceof Error&&error.message==='old provider accepted')throw error}
if(unsupportedCalls!==1)throw new Error('old provider reached history')
console.log(JSON.stringify({publicSdkConsumer:true,operations,cancellation:true,unsupportedProviderRejected:true}))
