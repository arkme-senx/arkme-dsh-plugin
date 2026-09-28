import { createArkmeSdk, type ArkmeRecordingSpeakerPresence, type ArkmeRecordingSpeakerMembers } from '@senguoyun/dsh-arkme/sdk'
const lifecycle=new AbortController()
let supported=true
const sdk=createArkmeSdk({fetchImpl:async(_url,init)=>{
 init?.signal?.throwIfAborted()
 const {operation}=JSON.parse(String(init?.body))
 const value=operation==='provider.capabilities'?{contractVersion:1,features:supported?{speakerPresence:true}:{}}:{state:'fresh',scope:'all-history',version:'v1',items:[],dayCount:0,lastSeenAt:0}
 return new Response(JSON.stringify({ok:true,value}),{headers:{'content-type':'application/json'}})
}})
const list:ArkmeRecordingSpeakerPresence=await sdk.recordingSpeakerPresence(lifecycle.signal)
const detail:ArkmeRecordingSpeakerMembers=await sdk.recordingSpeakerMembers('opaque',{...(list.version ? {expectedVersion:list.version} : {}),signal:lifecycle.signal})
if(detail.state!=='fresh')throw new Error('contract mismatch')
supported=false
let rejected=false;try{await sdk.recordingSpeakerPresence()}catch{rejected=true};if(!rejected)throw new Error('missing capability guard')
lifecycle.abort();rejected=false;try{await sdk.recordingSpeakerPresence(lifecycle.signal)}catch{rejected=true};if(!rejected)throw new Error('cancellation ignored')
console.log('external speaker presence SDK consumer: passed')
