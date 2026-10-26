import { createArkmeSdk, ARKME_PROVIDER_CONTRACT_VERSION, type ArkmeMessageQuote, type MessageUnderlineChange } from '@senguoyun/dsh-arkme/sdk'
const anchor: ArkmeMessageQuote = {version:1,projection:'arkme-text-v1',sourceDigest:'a'.repeat(64),start:0,end:2,text:'重点',prefix:'',suffix:''}
const operations: string[] = []
const sdk = createArkmeSdk({fetchImpl: async (_url,init) => {
  const request = JSON.parse(String(init?.body)); operations.push(request.operation)
  return new Response(JSON.stringify({ok:true,value:request.operation==='provider.capabilities' ? {contractVersion:ARKME_PROVIDER_CONTRACT_VERSION,features:{messageTextAnchorsV1:true}} : request.operation==='source.message-anchor.capture' ? anchor : {revision:2,accessible:true,items:[]}}),{headers:{'content-type':'application/json'}})
}})
const lifecycle = new AbortController()
const captured=await sdk.captureMessageQuote('signed-source','signed-action',0,2,lifecycle.signal)
const command: MessageUnderlineChange={kind:'add',operationId:'stable-operation',anchor:captured}
await sdk.changeMessageMark('signed-source','signed-action',command,lifecycle.signal)
if(!operations.includes('source.message-underline.change'))throw new Error('SDK did not use the public Host owner')
lifecycle.abort()
console.log('Public message anchor SDK consumer passed')
