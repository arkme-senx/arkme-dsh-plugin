import { expect, it, vi } from 'vitest'
import { createArkmeSdk, ARKME_PROVIDER_CONTRACT_VERSION } from '../src/sdk/index.js'
import { createArkmeCoreToolDefinitions } from '../src/tools/index.js'
const anchor = { version: 1 as const, projection: 'arkme-text-v1' as const, sourceDigest: 'a'.repeat(64), start: 0, end: 2, text: '重点', prefix: '', suffix: '' }
it('discovers Host support and forwards only signed source/message references through the SDK', async () => {
  const requests: Record<string, unknown>[] = []
  const sdk = createArkmeSdk({ fetchImpl: async (_url, init) => {
    const request = JSON.parse(String(init?.body)); requests.push(request)
    return new Response(JSON.stringify({ ok: true, value: request.operation === 'provider.capabilities'
      ? { contractVersion: ARKME_PROVIDER_CONTRACT_VERSION, features: { messageTextAnchorsV1: true } }
      : request.operation === 'source.message-anchor.capture' ? anchor : { supported: true, maxLength: 2000 } }), { headers: { 'content-type': 'application/json' } })
  } })
  await expect(sdk.captureMessageQuote('signed-source', 'signed-message', 0, 2)).resolves.toEqual(anchor)
  await sdk.changeMessageMark('signed-source', 'signed-message', { kind: 'add', operationId: 'stable', anchor })
  expect(requests.at(-1)).toMatchObject({ operation: 'source.message-underline.change', params: { sourceRef: 'signed-source', messageActionRef: 'signed-message', change: { kind: 'add', operationId: 'stable' } } })
  expect(JSON.stringify(requests)).not.toMatch(/actor_user_id|chat_session_uid/)
})
it('rejects old Hosts before attempting a new read or write', async () => {
  const operations: string[]=[]
  const sdk=createArkmeSdk({fetchImpl:async(_url,init)=>{const request=JSON.parse(String(init?.body));operations.push(request.operation);return new Response(JSON.stringify({ok:true,value:{contractVersion:ARKME_PROVIDER_CONTRACT_VERSION,features:{}}}),{headers:{'content-type':'application/json'}})}})
  await expect(sdk.changeMessageMark('s','m',{kind:'remove',operationId:'same',annotationId:'own'})).rejects.toMatchObject({body:{code:'CAPABILITY_UNSUPPORTED'}})
  expect(operations).toEqual(['provider.capabilities'])
})
it('uses the same Host owner from separate read, mark-write and quote-write tools', async () => {
  const sourceUnderlineCapabilities=vi.fn(async()=>({supported:true,maxLength:2000})), sourceUnderlines=vi.fn(async()=>[]), captureSourceMessageAnchor=vi.fn(async()=>anchor), changeSourceUnderline=vi.fn(async()=>({revision:1,accessible:true,items:[]})), extendSourceMessage=vi.fn(async()=>({recordUid:'reply',localState:'synced'}))
  const definitions=createArkmeCoreToolDefinitions({sourceUnderlineCapabilities,sourceUnderlines,captureSourceMessageAnchor,changeSourceUnderline,extendSourceMessage} as never)
  const exec={callId:'stable-call',signal:new AbortController().signal} as never
  await definitions.find(tool=>tool.name==='arkme_message_marks_read')!.execute({source_ref:'s',message_action_ref:'m'},exec)
  expect(changeSourceUnderline).not.toHaveBeenCalled()
  await definitions.find(tool=>tool.name==='arkme_message_mark')!.execute({source_ref:'s',message_action_ref:'m',action:'add',start:0,end:2,operation_uid:'same'},exec)
  expect(changeSourceUnderline).toHaveBeenCalledWith('s','m',{kind:'add',anchor,operationId:'same'},exec.signal)
  await definitions.find(tool=>tool.name==='arkme_message_quote_reply')!.execute({source_ref:'s',message_action_ref:'m',start:0,end:2,text:'body'},exec)
  expect(extendSourceMessage).toHaveBeenCalledWith('s','m','body',expect.any(String),[],expect.objectContaining({quote:anchor,signal:exec.signal}))
})

it('quote reply Tool preserves explicit Team selection and original time on the shared extension owner', async () => {
  const selection={teamRef:'opaque',membershipKind:'member' as const,membershipRevision:3,groupJoinAt:9}
  const extendSourceMessage=vi.fn(async()=>({recordUid:'reply',localState:'synced'}))
  const tool=createArkmeCoreToolDefinitions({captureSourceMessageAnchor:async()=>anchor,extendSourceMessage} as never).find(t=>t.name==='arkme_message_quote_reply')!
  const exec={callId:'stable-call',signal:new AbortController().signal} as never
  await tool.execute({source_ref:'s',message_action_ref:'m',start:0,end:2,text:'body',representation:selection,send_at_millis:123},exec)
  expect(extendSourceMessage).toHaveBeenCalledWith('s','m','body',expect.any(String),[],expect.objectContaining({representation:selection,sendAtMillis:123,quote:anchor}))
  await expect(tool.execute({source_ref:'s',message_action_ref:'m',start:0,end:2,text:'body',representation:{...selection,team_id:'7'}},exec)).rejects.toMatchObject({code:'team-identity-invalid'})
  expect(extendSourceMessage).toHaveBeenCalledTimes(1)
})

it('discovers full summaries, shares the Host read owner and rejects an older provider', async () => {
 const summary = [{actionRef:'m',summary:{accessible:true,complete:true,commentCount:125,quoteCount:125,sourceRecordVersion:1,anchors:[anchor]}}]
 const sourceMessageExtensionSummaries=vi.fn(async()=>summary)
 const tool=createArkmeCoreToolDefinitions({sourceMessageExtensionSummaries} as never).find(t=>t.name==='arkme_message_comments_summary')!
 const signal=new AbortController().signal
 await tool.execute({source_ref:'s',message_action_ref:'m'},{callId:'summary',signal} as never)
 expect(sourceMessageExtensionSummaries).toHaveBeenCalledExactlyOnceWith('s',['m'],signal)
 const requests: Record<string,unknown>[]=[]
 let supported=true
 const sdk=createArkmeSdk({fetchImpl:async(_url,init)=>{
  const request=JSON.parse(String(init?.body)); requests.push(request)
  return new Response(JSON.stringify({ok:true,value:request.operation==='provider.capabilities'?{contractVersion:ARKME_PROVIDER_CONTRACT_VERSION,features:supported?{messageExtensionSummariesV1:true}:{}}:summary}),{headers:{'content-type':'application/json'}})
 }})
 await expect(sdk.sourceMessageExtensionSummaries('s',['m'],signal)).resolves.toEqual(summary)
 expect(requests.at(-1)).toMatchObject({operation:'source.message-extension.summaries',params:{sourceRef:'s',actionRefs:['m']}})
 supported=false;requests.length=0
 await expect(sdk.sourceMessageExtensionSummaries('s',['m'])).rejects.toMatchObject({body:{code:'CAPABILITY_UNSUPPORTED'}})
 expect(requests).toEqual([{operation:'provider.capabilities'}])
})
