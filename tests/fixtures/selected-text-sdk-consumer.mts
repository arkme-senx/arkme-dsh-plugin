import {createArkmeSdk,type SelectedTextForwardInput,type SelectedTextNoteQuote} from '@senguoyun/dsh-arkme/sdk'
function assert(value:unknown):asserts value {if(!value)throw new Error('Selected text SDK contract failed')}
const quote:SelectedTextNoteQuote={version:1,sourceLabel:'私聊',senderName:'作者',sourceAtMillis:1,text:'选中文字'}
const command:SelectedTextForwardInput={expectedAccountKey:'test:11',targetSourceRef:'opaque-target',recordUid:'record',relationUid:'relation',sendAtMillis:1000,commentText:'',quote}
const calls:string[]=[]
const sdk=createArkmeSdk({fetchImpl:async(_url,init)=>{init?.signal?.throwIfAborted();const r=JSON.parse(String(init?.body));calls.push(r.operation);return new Response(JSON.stringify({ok:true,value:r.operation==='provider.capabilities'?{contractVersion:1,features:{selectedTextForwardV1:true}}:r.operation==='selected-text.prepare'?quote:r.operation==='selected-text.forward'?{sourceRef:'opaque-target',itemUid:'record',status:1,localState:'synced'}:{title:'原文',text:'选中文字',selection:{start:0,end:5}}}))}})
assert((await sdk.prepareSelectedText({expectedAccountKey:command.expectedAccountKey,quote})).text===quote.text)
assert((await sdk.forwardSelectedText(command)).itemUid==='record')
assert((await sdk.excerptOriginal('record',{sourceRef:'opaque-target',messageActionRef:'opaque-action'})).selection?.start===0)
sdk.dispose();let disposed=false;try{await sdk.forwardSelectedText(command)}catch{disposed=true}assert(disposed)
const legacy=createArkmeSdk({fetchImpl:async()=>new Response(JSON.stringify({ok:true,value:{contractVersion:1,features:{}}}))});let unsupported=false;try{await legacy.forwardSelectedText(command)}catch(e){unsupported=(e as {body:{code:string}}).body.code==='CAPABILITY_UNSUPPORTED'}finally{legacy.dispose()}assert(unsupported)
assert(calls.includes('selected-text.prepare')&&calls.includes('selected-text.forward')&&calls.includes('excerpt.original'))
console.log('PASS: external selected-text SDK types, capabilities, commands, original, dispose and unsupported provider')
