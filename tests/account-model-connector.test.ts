import {expect,it,vi,afterEach} from 'vitest'
import {ArkmeAccountSessionOwner} from '../src/account-session-owner.js'
import type {ArkmeSessionCredentials} from '../src/keychain-store.js'
import {AccountModelConnector} from '../src/account-model-connector.js'
const scope=async()=> 'prod:11'
afterEach(()=>vi.unstubAllGlobals())
it('acknowledges durable start before native provider IO and reports disjoint native cache usage once',async()=>{
 const order:string[]=[],finished:any[]=[]
 vi.stubGlobal('fetch',vi.fn(async(url:string,init:any)=>{const path=url.split('/').at(-1)!;order.push(path);if(path==='finish')finished.push(JSON.parse(init.body));return new Response(JSON.stringify({code:200,data:{}}))}))
 const ctx={get:()=>undefined,llm:{prepareCall:async()=>({config:{provider:'native',model:'owned'},stream:async function*(){order.push('provider');yield{type:'text-delta',text:'reply'};yield{type:'usage',usage:{inputTokens:3,outputTokens:2,cacheReadTokens:1}};yield{type:'finish',reason:{kind:'stop'},replayState:{opaque:'preserved'}}}})}}
 const connector=new AccountModelConnector(ctx as never,{resolveManagedAccessCredential:async()=>({reveal:()=> 'arkme-session'})} as never,'https://isolated.example',{} as never,'/tmp/not-used',scope)
 await (connector as any).execute('prod:11',{id:'host',secret:'isolated-not-real'},{id:'job',lease:'lease',deadline:Date.now()+10000,provider:'native',model:'owned',request:Buffer.from(JSON.stringify({messages:[{role:'user',content:'private-input-not-in-usage'}]})).toString('base64')},new AbortController().signal)
 expect(order.slice(0,3)).toEqual(['start','provider','finish']);expect(finished).toHaveLength(1);const reply=JSON.parse(Buffer.from(finished[0].reply,'base64').toString());expect(reply.usage).toEqual({prompt_tokens:4,completion_tokens:2,prompt_tokens_details:{cached_tokens:1}});expect(reply.choices[0].message.provider_state.replay).toEqual({opaque:'preserved'});expect(JSON.stringify(finished)).not.toContain('private-input-not-in-usage')
})
it('reports preparation failure without dispatching a native or point model',async()=>{
 const paths:string[]=[];vi.stubGlobal('fetch',vi.fn(async(url:string)=>{paths.push(url.split('/').at(-1)!);return new Response(JSON.stringify({code:200,data:{}}))}));const ctx={get:()=>undefined,llm:{prepareCall:async()=>{throw new Error('isolated preparation failed')}}};const connector=new AccountModelConnector(ctx as never,{resolveManagedAccessCredential:async()=>({reveal:()=> 'arkme-session'})} as never,'https://isolated.example',{} as never,'/tmp/not-used',scope);await(connector as any).execute('prod:11',{id:'host',secret:'isolated'},{id:'job',lease:'lease',deadline:Date.now()+10000,provider:'native',model:'owned',request:Buffer.from('{"messages":[]}').toString('base64')},new AbortController().signal);expect(paths).toEqual(['finish'])
})
it('re-enrolls an explicitly revoked Host without exposing the new secret through the browser projection',async()=>{
 let secret=JSON.stringify({id:'old',secret:'old-key'});const settings={accountScope:'prod:11',revision:2,enabled:true,models:[],scenes:[],preferences:{default_route:'',scenes:{},points_fallback:false},connectors:[{uid:'old',name:'Host',revoked:true}]};const service={accountModels:vi.fn(async()=>settings),accountModelHostRequest:vi.fn(async()=>({id:'new',secret:'host-only-secret'}))};const store={read:async()=>secret,write:async(_k:string,value:string)=>{secret=value}};const connector=new AccountModelConnector({}as never,service as never,'https://isolated.example',store as never,'/tmp/not-used',scope);const result=await connector.enroll('prod:11');expect(service.accountModelHostRequest).toHaveBeenCalledOnce();expect(JSON.parse(secret).id).toBe('new');expect(JSON.stringify(result)).not.toContain('host-only-secret')
})
it('starts native model IO even when scope/settings never resolve and execution readiness is off',async()=>{
 const settings=vi.fn(()=>new Promise(()=>{})),ctx={logger:{warn:vi.fn()}}
 const connector=new AccountModelConnector(ctx as never,{accountModels:settings} as never,'https://unused',{}as never,'/tmp/not-used',()=>new Promise(()=>{}))
 let calls=0
 const options={provider:'native',model:'local',messages:[]} as never
 const iterator=connector.observe(options,async function*(){calls++;yield{type:'finish',reason:{kind:'stop'}}as never})[Symbol.asyncIterator]()
 const first=await Promise.race([iterator.next(),new Promise<never>((_,reject)=>setTimeout(()=>reject(new Error('observer blocked native IO')),1000))])
 expect(first.done).toBe(false);expect(calls).toBe(1);expect(settings).not.toHaveBeenCalled();await iterator.return?.()
})
it('records unknown native usage independently of cloud readiness and without prompting a second model call',async()=>{
 const settings=vi.fn(async()=>({enabled:false})),connector=new AccountModelConnector({logger:{warn:vi.fn()}}as never,{accountModels:settings}as never,'https://unused',{}as never,'/tmp/not-used',scope)
 const events:any[]=[];(connector as any).enqueue=async(s:string,event:unknown)=>{events.push({scope:s,event})}
 for await(const _ of connector.observe({provider:'native',model:'local',messages:[]}as never,async function*(){yield{type:'finish',reason:{kind:'stop'}}as never})){}
 await new Promise(resolve=>setTimeout(resolve,0))
 expect(events).toHaveLength(1);expect(events[0].scope).toBe('prod:11');expect(events[0].event.usage_field_mask).toBe(0);expect(settings).not.toHaveBeenCalled()
})

it('keeps a native call on its originally attested account when the account switches during IO',async()=>{
 let value:ArkmeSessionCredentials|undefined={userId:11,accessToken:'test-a',refreshToken:'test-a'}
 const owner=new ArkmeAccountSessionOwner({read:async()=>value,write:async next=>{value=next},delete:async()=>{value=undefined}});await owner.start()
 const snapshot=async()=>{const user=owner.readyAccountUserId();if(user===undefined)throw new Error('not attested');return `prod:${user}`}
 const connector=new AccountModelConnector({logger:{warn:vi.fn()}}as never,{}as never,'https://unused',{}as never,'/tmp/not-used',snapshot),events:any[]=[]
 ;(connector as any).enqueue=async(scope:string,event:unknown)=>{events.push({scope,event})}
 for await(const _ of connector.observe({provider:'native',model:'local',messages:[]}as never,async function*(){await owner.write({userId:22,accessToken:'test-b',refreshToken:'test-b'});yield{type:'finish',reason:{kind:'stop'}}as never})){}
 await new Promise(resolve=>setTimeout(resolve,0));expect(owner.readyAccountUserId()).toBe(22);expect(events).toHaveLength(1);expect(events[0].scope).toBe('prod:11')
})
