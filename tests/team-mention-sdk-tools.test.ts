import {expect,it,vi} from 'vitest'
import {ArkmeSdk} from '../src/sdk/index.js'
import {ArkmeService} from '../src/arkme-service.js'
import {dispatchArkmeHostOperation} from '../src/host-api.js'
import {teamMessageTools} from '../src/tools/business/conversation/team-messages.js'
const page={items:[{personRef:'person',personKey:'person-key',nickname:'Member',imageRef:'team-app-image.signed',imageKey:'avatar-key'}],hasMore:true,nextCursor:'cursor'}
it('SDK/Host route exact TeamApp context, bounded options and cancellation through the typed port',async()=>{
 const read=vi.fn(async()=>page),signal=new AbortController().signal
 const service={providerCapabilities:()=>({contractVersion:1,features:{teamMentionCandidates:1}}),readTeamMentionCandidates:read}
 const fetchImpl=vi.fn(async(_url:unknown,init?:RequestInit)=>{const {operation,params}=JSON.parse(String(init?.body));return new Response(JSON.stringify({ok:true,value:await dispatchArkmeHostOperation(service as never,operation,params,undefined,undefined,undefined,undefined,init?.signal??undefined)}))}) as typeof fetch
 expect(await new ArkmeSdk({fetchImpl}).readTeamMentionCandidates('conversation','team',{cursor:'previous',limit:20},signal)).toEqual(page)
 expect(read).toHaveBeenCalledWith('conversation','team',{cursor:'previous',limit:20},signal)
})
it('rejects older providers before invoking an unsupported candidate read',async()=>{
 const fetchImpl=vi.fn(async()=>new Response(JSON.stringify({ok:true,value:{contractVersion:1,features:{teamPersonMentions:1}}}))) as typeof fetch
 await expect(new ArkmeSdk({fetchImpl}).readTeamMentionCandidates('conversation','team')).rejects.toThrow('不支持')
 expect(fetchImpl).toHaveBeenCalledOnce()
})
it('delegates the bounded candidate projection to the same TeamApp membership owner',async()=>{
 const execute=vi.fn(async()=>page)
 expect(await ArkmeService.prototype.readTeamMentionCandidates.call({executeTeamApp:execute} as never,'conversation','team',{limit:10})).toEqual(page)
 expect(execute).toHaveBeenCalledWith('team.app.members',{conversationRef:'conversation',teamRef:'team',limit:10,pageCursor:undefined,mentionCandidates:true},undefined)
 await expect(ArkmeService.prototype.readTeamMentionCandidates.call({executeTeamApp:execute} as never,'','team')).rejects.toThrow()
})
it('keeps the existing read Tool grant/schema and shares the typed candidate owner',async()=>{
 const module=teamMessageTools.find(value=>value.meta.toolName==='arkme_team_messages')!
 expect(module.meta).toMatchObject({kind:'business',effect:'read',profiles:['business','hybrid']});expect(module.meta).not.toHaveProperty('grant','explicit-user-write')
 const read=vi.fn(async()=>page),tool=module.create({readTeamMentionCandidates:read} as never),signal=new AbortController().signal
 expect(tool.parameters.properties?.mention_candidates).toMatchObject({type:'boolean'});expect(tool.parameters.properties?.team_ref).toMatchObject({type:'string'})
 const result=await tool.execute({mention_candidates:true,team_ref:'team',conversation_ref:'conversation',cursor:'previous',limit:20} as never,{signal} as never)
 expect(read).toHaveBeenCalledWith('conversation','team',{cursor:'previous',limit:20},signal);expect(result).toContain('person-key');expect(result).toContain('team-app-image.signed');expect(result).toContain('avatar-key')
})
it.each([{mention_candidates:true},{mention_candidates:true,team_ref:'team'},{mention_candidates:true,team_ref:'team',conversation_ref:'conversation',tasks:true}])('rejects malformed/mixed tool read modes %j',async args=>{
 const read=vi.fn(),tool=teamMessageTools.find(value=>value.meta.toolName==='arkme_team_messages')!.create({readTeamMentionCandidates:read} as never)
 await expect(tool.execute(args as never,{} as never)).rejects.toThrow();expect(read).not.toHaveBeenCalled()
})
