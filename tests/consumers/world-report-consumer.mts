import { createArkmeSdk, type WorldReportRequest, type WorldReportResult } from '@senguoyun/dsh-arkme/sdk'
function assert(v:unknown,message:string):asserts v {if(!v)throw new Error(message)}
const calls:{operation:string;params:Record<string,unknown>}[]=[],lifetime=new AbortController()
let enabled=true
const sdk=createArkmeSdk({fetchImpl:async(_url,init)=>{
 init?.signal?.throwIfAborted()
 const call=JSON.parse(String(init?.body));calls.push(call)
 const value=call.operation==='provider.capabilities'?{contractVersion:1,features:{worldReportsV1:enabled}}:call.params.action==='pending'?{pending:{requestUid:'persisted-report-request',reportType:6,reason:'原说明'}}:call.params.action==='acknowledge'?{}:{submitted:true}
 return Response.json({ok:true,value})
}})
const request:WorldReportRequest={action:'submit',recordRef:'opaque-public-record',expectedUserId:42,requestUid:'persisted-report-request',reportType:6,reason:'原说明',confirmed:true}
const accepted:WorldReportResult=await sdk.worldReport(request,lifetime.signal)
assert(accepted.submitted===true,'typed report receipt')
const pending=await sdk.worldReport({action:'pending',recordRef:request.recordRef,expectedUserId:42},lifetime.signal)
assert(pending.pending?.requestUid===request.requestUid,'typed original recovery identity')
await sdk.worldReport({action:'acknowledge',recordRef:request.recordRef,expectedUserId:42,requestUid:request.requestUid},lifetime.signal)
assert(calls.some(c=>c.operation==='world.report'&&c.params.confirmed===true&&c.params.recordRef==='opaque-public-record'),'public SDK routes to shared Host owner')
enabled=false
let rejected=false;try{await sdk.worldReport(request)}catch{rejected=true}
assert(rejected,'unsupported provider must fail explicitly')
lifetime.abort();rejected=false;try{await sdk.worldReport(request,lifetime.signal)}catch{rejected=true}
assert(rejected,'consumer lifetime cancellation')
sdk.dispose();const before=calls.length;rejected=false;try{await sdk.worldReport(request)}catch{rejected=true}
assert(rejected&&calls.length===before,'disposed SDK must reject before dispatch')
console.log('external World report SDK: typed exports, capability, original recovery identity, acknowledgement, cancellation and dispose PASS')
