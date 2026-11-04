const assert = Object.assign((condition:unknown,message?:string)=>{if(!condition)throw Error(message??'Assertion failed')},{equal:(actual:unknown,expected:unknown)=>{if(actual!==expected)throw Error('Unexpected consumer result')},rejects:async(promise:Promise<unknown>,pattern?:RegExp)=>{try{await promise}catch(error){if(pattern && !pattern.test(String(error)))throw error;return}throw Error('Expected rejection')}})
import {createArkmeSdk,type ArkoReplyPromptBook,type ArkoReplyHistoryPage,type ArkoReplyPromptWrite} from '@senguoyun/dsh-arkme/sdk'
const operations:string[]=[]
const sdk=createArkmeSdk({fetchImpl:async(_url,init)=>{
 init?.signal?.throwIfAborted();const request=JSON.parse(String(init?.body));operations.push(request.operation)
 const value=request.operation==='provider.capabilities'?{contractVersion:1,features:{arkoReplyManagementV1:true}}:request.operation==='arko.reply-prompts.get'?{accountScope:'test:11',items:[]}:request.operation==='arko.replies.page'?{accountScope:'test:11',items:[],nextCursor:'opaque'}:{accountScope:'test:11',conflict:false,current:{revision:1}}
 return new Response(JSON.stringify({ok:true,value}))
}})
const life=new AbortController()
const book:ArkoReplyPromptBook=await sdk.arkoReplyPrompts(undefined,life.signal);assert.equal(book.accountScope,'test:11')
const input:ArkoReplyPromptWrite={scene:'record_auto',expectedRevision:0,baseOfficialRevision:'v1',body:'100%\n完整🐱'}
await sdk.saveArkoReplyPrompt(input,'test:11',life.signal);await sdk.resetArkoReplyPrompt({...input,expectedRevision:1},'test:11',life.signal)
const page:ArkoReplyHistoryPage=await sdk.arkoRepliesPage({scene:'all',cursor:'opaque'},'test:11',life.signal);assert.equal(page.nextCursor,'opaque')
life.abort();await assert.rejects(sdk.arkoRepliesPage({},undefined,life.signal))
const old=createArkmeSdk({fetchImpl:async()=>new Response(JSON.stringify({ok:true,value:{contractVersion:1,features:{}}}))})
await assert.rejects(old.arkoRepliesPage({}),/不支持/)
for(const op of ['arko.reply-prompts.get','arko.reply-prompts.save','arko.reply-prompts.reset','arko.replies.page'])assert(operations.includes(op),op)
console.log('Packed public Arko reply management SDK consumer passed')
