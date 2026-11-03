import { ArkmeClientError, createArkmeSdk, type PublicSocialReadResult, type PublicSocialWriteResult } from '@senguoyun/dsh-arkme/sdk'
function assert(value:unknown):asserts value {if(!value)throw new Error('Public social consumer assertion failed')}
const signal=new AbortController().signal
const calls:string[]=[]
const page:PublicSocialReadResult={operation:'requests',accountScope:'test:1',items:[{requestRef:'opaque',displayName:'公开昵称',status:1,requestAt:1}],hasMore:false}
const result:PublicSocialWriteResult={operation:'resolve',requestRef:'opaque',status:2}
const sdk=createArkmeSdk({fetchImpl:async(_url,init)=>{
 assert(init?.signal===signal)
 const request=JSON.parse(String(init?.body));calls.push(request.operation)
 return new Response(JSON.stringify({ok:true,value:request.operation==='provider.capabilities'?{contractVersion:1,features:{publicSocialV1:true}}:request.operation==='social.read'?page:result}))
}})
const read=await sdk.publicSocialRead({operation:'requests',accountScope:'test:1',reference:'group-source'},signal)
assert(read.operation==='requests');assert(read.items[0]?.requestRef==='opaque')
const write=await sdk.publicSocialWrite({operation:'resolve',accountScope:read.accountScope,reference:'group-source',requestRef:read.items[0]!.requestRef,enabled:true},signal)
assert(write.operation==='resolve'&&write.status===2)
const old=createArkmeSdk({fetchImpl:async()=>new Response(JSON.stringify({ok:true,value:{contractVersion:1,features:{}}}))})
try {await old.publicSocialRead({operation:'people'});throw new Error('unsupported provider must reject')}
catch(e){assert(e instanceof ArkmeClientError&&e.body.code==='CAPABILITY_UNSUPPORTED')}
assert(calls.includes('social.read')&&calls.includes('social.write'))
console.log('External packed SDK public social consumer: passed')
