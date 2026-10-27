import { Context } from '@deepseek-ai/cordis'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SessionStore from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { expect, it, vi } from 'vitest'
import { createArkmeSdk } from '../src/sdk/index.js'
import { dispatchArkmeHostOperation } from '../src/host-api.js'
import { registerArkmeTools } from '../src/tools/registry/registrar.js'

it('exposes article and person reads through the same Host, public SDK and official DSH session',async()=>{
 const articles={items:[],sourceAggregates:[],hasMore:true,nextCursor:'article-cursor',appliedArticleScope:'shared_with_me',queryGuard:{state:'ok'}}
 const people={version:1,supported:true,items:[],hasMore:false,removedEventRefs:[],coverage:'current_chat_relations'}
 const owner={providerCapabilities:()=>({contractVersion:1,features:{articleLibraryV1:true,personRecordsV1:true}}),searchScene:vi.fn(async()=>articles),personRecordsPage:vi.fn(async()=>people)}
 const sdk=createArkmeSdk({fetchImpl:async(_url,init)=>{const q=JSON.parse(String(init?.body));const value=q.operation==='provider.capabilities'?owner.providerCapabilities():await dispatchArkmeHostOperation(owner as never,q.operation,q.params,undefined,undefined,undefined,undefined,init?.signal??undefined);return new Response(JSON.stringify({ok:true,value}))}})
 const controller=new AbortController()
 expect(await sdk.listArticles({scope:'shared_with_me',signal:controller.signal})).toEqual(articles)
 expect(await sdk.personRecordsPage('source','member',{signal:controller.signal})).toEqual(people)
 const ctx=new Context();await ctx.plugin(SessionStore);await ctx.plugin(SystemPrompt);await ctx.plugin(ToolRuntime)
 try {
  const session=ctx.sessions.create();const agent={id:session.id,session}
  const fiber=await ctx.plugin(Object.assign((toolCtx:Context)=>{registerArkmeTools(toolCtx,owner as never,'business')},{inject:['tools','systemPrompt']}))
  expect(ctx.tools.schemas(agent as never).map(tool=>tool.name)).toEqual(expect.arrayContaining(['arkme_articles_list','arkme_person_records']))
  for(const [name,args] of [['arkme_articles_list',{scope:'shared_with_me'}],['arkme_person_records',{source_ref:'source',member_ref:'member'}]] as const){
   const result=await ctx.tools.execute({callId:ToolCallId(name),name,agent:agent as never,arguments:args,signal:controller.signal})
   expect(result.isError).toBe(false)
  }
  expect(owner.searchScene).toHaveBeenCalledWith(expect.objectContaining({scene:'long_article',articleScope:'shared_with_me',signal:expect.any(AbortSignal)}))
  expect(owner.personRecordsPage).toHaveBeenCalledWith('source','member',expect.objectContaining({signal:expect.any(AbortSignal)}))
  await fiber.dispose();expect(ctx.tools.schemas(agent as never).map(tool=>tool.name)).not.toContain('arkme_person_records')
 } finally {await ctx.fiber.dispose()}
})
it('does not call unsupported SDK providers or accept a mismatched sharing receipt',async()=>{
 const calls:string[]=[]
 const unsupported=createArkmeSdk({fetchImpl:async(_u,i)=>{calls.push(JSON.parse(String(i?.body)).operation);return new Response(JSON.stringify({ok:true,value:{contractVersion:1,features:{}}}))}})
 await expect(unsupported.listArticles({scope:'shared_by_me'})).rejects.toThrow('Unsupported');await expect(unsupported.personRecordsPage('s','m')).rejects.toThrow('Unsupported')
 expect(calls.every(operation=>operation==='provider.capabilities')).toBe(true)
})
