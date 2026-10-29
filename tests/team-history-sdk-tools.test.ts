import { Context } from '@deepseek-ai/cordis'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SessionStore from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { expect,it,vi } from 'vitest'
import { ArkmeSdk } from '../src/sdk/index.js'
import { dispatchArkmeHostOperation } from '../src/host-api.js'
import { registerArkmeTools } from '../src/tools/registry/registrar.js'

it('shares the history owner across the public SDK and a real official DSH Tool session',async()=>{
 const result={state:'ready',resultRef:'opaque-result',messages:[],words:[],days:[],participants:[],hasMore:false}
 const owner={providerCapabilities:()=>({contractVersion:1,features:{teamHistoryV1:true}}),teamHistory:vi.fn(async()=>result),readTeamHistoryExportChunk:vi.fn(async()=>({chunkBase64:'',chunkSha256:'a'.repeat(64),sha256:'a'.repeat(64),offset:0,bytes:0,complete:true,fileName:'团队对话.md'}))}
 const sdk=new ArkmeSdk({fetchImpl:async(_u,init)=>{const q=JSON.parse(String(init?.body));return new Response(JSON.stringify({ok:true,value:await dispatchArkmeHostOperation(owner as never,q.operation,q.params,undefined,undefined,undefined,undefined,init?.signal??undefined)}))}})
 const signal=new AbortController().signal
 expect(await sdk.teamHistory('conversation','query',{keyword:'中文',sender:'self',cursor:'frozen'},signal)).toEqual(result)
 expect(owner.teamHistory).toHaveBeenLastCalledWith('conversation','query',{keyword:'中文',sender:'self',cursor:'frozen'},signal)
 await sdk.readTeamHistoryExportChunk('opaque-result','resume',signal)
 expect(owner.readTeamHistoryExportChunk).toHaveBeenCalledWith('opaque-result','resume',signal)
 const ctx=new Context();await ctx.plugin(SessionStore);await ctx.plugin(SystemPrompt);await ctx.plugin(ToolRuntime)
 try{
   const session=ctx.sessions.create(),agent={id:session.id,session}
   const fiber=await ctx.plugin(Object.assign((toolCtx:Context)=>registerArkmeTools(toolCtx,owner as never,'business'),{inject:['tools','systemPrompt']}))
   expect(ctx.tools.schemas(agent as never).map(t=>t.name)).toContain('arkme_team_history')
   for(const action of ['query','dates','analysis/create','analysis/words','analysis/sources','exports/create','exports/link']){
     const response=await ctx.tools.execute({callId:ToolCallId(`history-${action}`),name:'arkme_team_history',agent:agent as never,arguments:{conversation_ref:'conversation',action,keyword:'中文',analysis_kind:'words',source_ref:'selection',result_ref:'opaque-result'},signal})
     expect(response.isError).toBe(false)
     expect(owner.teamHistory).toHaveBeenLastCalledWith('conversation',action,expect.objectContaining({keyword:'中文',analysisKind:'words',sourceRef:'selection',resultRef:'opaque-result',requestId:expect.any(String)}),expect.any(AbortSignal))
   }
   await fiber.dispose();expect(ctx.tools.schemas(agent as never).map(t=>t.name)).not.toContain('arkme_team_history')
 }finally{await ctx.fiber.dispose()}
})
it('rejects an unsupported SDK provider before any history read',async()=>{
 const fetchImpl=vi.fn(async()=>new Response(JSON.stringify({ok:true,value:{contractVersion:1,features:{}}})))
 await expect(new ArkmeSdk({fetchImpl}).teamHistory('c','query')).rejects.toThrow('不支持')
 expect(fetchImpl).toHaveBeenCalledOnce()
})
