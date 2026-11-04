import {expect,it,vi} from 'vitest'
import {createArkmeSdk} from '../src/sdk/index.js'
import {dispatchArkmeHostOperation} from '../src/host-api.js'
import {createArkmeCoreToolDefinitions,arkmeToolCatalog} from '../src/tools/index.js'
import {configurableReplyScenes} from '../src/arko-reply-contract.js'
const items=configurableReplyScenes.map(scene=>({scene,title:scene,officialBody:'official',officialRevision:'v1',revision:0,userBody:null,effectiveBody:'official',protectedInstructions:'fixed',maxBodyRunes:6000}))
it('SDK probes capability then shares Host query/save/reset owners and cancellation',async()=>{
 const signal=new AbortController().signal
 const owner={arkoReplyPrompts:vi.fn(async()=>({accountScope:'test:11',items})),saveArkoReplyPrompt:vi.fn(async()=>({accountScope:'test:11',conflict:false,current:{...items[0],revision:1,userBody:'exact',effectiveBody:'exact'}})),resetArkoReplyPrompt:vi.fn(async()=>({accountScope:'test:11',conflict:false,current:{...items[0],revision:2}})),arkoRepliesPage:vi.fn(async()=>({accountScope:'test:11',items:[],nextCursor:'opaque'}))}
 const sdk=createArkmeSdk({fetchImpl:async(_url,init)=>{const request=JSON.parse(String(init?.body));const value=request.operation==='provider.capabilities'?{contractVersion:1,features:{arkoReplyManagementV1:true}}:await dispatchArkmeHostOperation(owner as never,request.operation,request.params,undefined,undefined,undefined,undefined,init?.signal??undefined);return new Response(JSON.stringify({ok:true,value}))}})
 expect((await sdk.arkoReplyPrompts(undefined,signal)).items).toHaveLength(7)
 const input={scene:'record_auto' as const,expectedRevision:0,baseOfficialRevision:'v1',body:'exact'}
 await sdk.saveArkoReplyPrompt(input,'test:11',signal);await sdk.resetArkoReplyPrompt({...input,expectedRevision:1},'test:11',signal);await sdk.arkoRepliesPage({scene:'all',cursor:'current'},'test:11',signal)
 expect(owner.saveArkoReplyPrompt).toHaveBeenCalledWith(input,'test:11',signal);expect(owner.resetArkoReplyPrompt).toHaveBeenCalledWith({...input,expectedRevision:1},'test:11',signal)
 expect(owner.arkoRepliesPage).toHaveBeenCalledWith({scene:'all',cursor:'current'},'test:11',signal)
})
it('old providers fail before a setting write or history query',async()=>{
 const fetch=vi.fn(async()=>new Response(JSON.stringify({ok:true,value:{contractVersion:1,features:{}}})));const sdk=createArkmeSdk({fetchImpl:fetch})
 await expect(sdk.arkoRepliesPage({})).rejects.toMatchObject({body:{code:'CAPABILITY_UNSUPPORTED'}})
 await expect(sdk.saveArkoReplyPrompt({scene:'record_auto',expectedRevision:0,baseOfficialRevision:'v1',body:'text'},'scope')).rejects.toMatchObject({body:{code:'CAPABILITY_UNSUPPORTED'}})
 expect(fetch.mock.calls).toHaveLength(2)
})
it('Tools expose bounded reads and a revision-bound explicitly granted write',async()=>{
 const owner={arkoReplyPrompts:vi.fn(async()=>({accountScope:'test:11',items})),saveArkoReplyPrompt:vi.fn(async()=>({accountScope:'test:11',conflict:false,current:{...items[0],revision:1}})),arkoRepliesPage:vi.fn(async()=>({accountScope:'test:11',items:[{key:'one',sourceOrderAtMillis:100,scene:'record_auto',resultKind:'root',source:{sourceRef:'opaque-source'},item:{messageActionRef:'opaque-action',sendAtMillis:100},thought:{content:'字'.repeat(9000)}}],nextCursor:'opaque-next'}))}
 const tools=createArkmeCoreToolDefinitions(owner as never),exec={callId:'one',signal:new AbortController().signal} as never
 const read=tools.find(t=>t.name==='arkme_arko_reply_prompts')!,page=tools.find(t=>t.name==='arkme_arko_replies')!,save=tools.find(t=>t.name==='arkme_set_arko_reply_prompt')!
 const metadata=String(await read.execute({},exec));expect(metadata).toContain('bodyRunes');expect(metadata).not.toContain('effectiveBody')
 expect(String(await read.execute({scene:'record_auto'},exec))).toContain('officialBody')
 const result=String(await page.execute({scene:'all',cursor:'cursor'},exec));expect(result).toContain('"contentTruncated": true');expect(result.length).toBeLessThan(5000);expect(owner.arkoRepliesPage).toHaveBeenCalledWith({scene:'all',cursor:'cursor',limit:10},undefined,expect.any(AbortSignal))
 await save.execute({scene:'record_auto',expected_revision:0,base_official_revision:'v1',body:'complete text'},exec)
 expect(owner.saveArkoReplyPrompt).toHaveBeenCalledWith({scene:'record_auto',expectedRevision:0,baseOfficialRevision:'v1',body:'complete text'},'test:11',expect.any(AbortSignal))
 expect(arkmeToolCatalog.modules.find(m=>m.meta.toolName===save.name)?.meta).toMatchObject({effect:'write',grant:'explicit-user-write'})
 await expect(save.execute({scene:'record_auto',expected_revision:2,base_official_revision:'v1',body:'stale'},exec)).rejects.toThrow('版本已变化');expect(owner.saveArkoReplyPrompt).toHaveBeenCalledOnce()
})
