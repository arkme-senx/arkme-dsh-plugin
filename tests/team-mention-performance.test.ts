import {writeFile} from 'node:fs/promises'
import {performance} from 'node:perf_hooks'
import {expect,it,vi} from 'vitest'
import {ArkmeService} from '../src/arkme-service.js'
import {TeamAppService} from '../src/services/team-app-service.js'
import {ServiceRuntime,type ArkmeServiceConfig,type StateStore} from '../src/services/service.js'
import type {ArkmeSessionStore} from '../src/keychain-store.js'
import type {TeamOpen} from '../src/team-app-contract.js'
import {parseOwnerJson,stringifyOwnerJson} from '../src/record-owner-id.js'

it('reads fifty mention candidates with overlapping current authority reads and no full Team directory projection',async()=>{
 const channel={team_id:'17',name:'Team',jotmo_id:'team',public_ref:'a'.repeat(32),enabled:true,revision:1}
 const conversation={conversation_uid:'conversation',side:'team',channel,external_user_id:12,visitor:{kind:'person',account_state:'active',nickname:'Visitor'}}
 const calls:{path:string;start:number;end:number}[]=[],delay=120
 const runtime=new ServiceRuntime({environment:'test',teamBaseUrl:'https://team.test',routePath:'/api',requestTimeoutMs:5000} as ArkmeServiceConfig,{} as ArkmeSessionStore,{uniqueCode:async()=> 'machine'} as StateStore,(async(input,init)=>{
  const path=new URL(String(input)).pathname,body=parseOwnerJson(String(init?.body)) as Record<string,unknown>
  const timing={path,start:performance.now(),end:0};calls.push(timing)
  if(!path.endsWith('/open'))await new Promise(resolve=>setTimeout(resolve,delay))
  const data=path.endsWith('/open')?{channel,conversation}:path.endsWith('/timeline/page')?{conversation,messages:[]}:path.endsWith('/list-mine')?{teams:[{...channel,role:1}]}:{member_count:50,membership_revision:1,can_add_members:false,has_more:false,items:Array.from({length:50},(_,i)=>({user_id:100+i,display_name:`Member ${i}`,jotmo_id:`member_${i}`,identity_state:'ready',role:2,joined_at:1}))}
  if(path.endsWith('/members/snapshot'))expect(body.limit).toBe(50)
  timing.end=performance.now();return new Response(stringifyOwnerJson({code:200,data}))
 }) as typeof fetch)
 vi.spyOn(runtime,'requireSession').mockResolvedValue({userId:90,accessToken:'token',refreshToken:'refresh'})
 vi.spyOn(runtime,'accountScopedSession').mockResolvedValue({userId:90,accessToken:'token',refreshToken:'refresh'})
 const avatars={publicAvatarPresentationsByArkmeIds:vi.fn(()=>new Promise<Map<string,never>>(()=>{}))},owner=new TeamAppService(runtime,avatars)
 const c=(await owner.execute('team.app.open',{publicRef:channel.public_ref}) as TeamOpen).conversation!
 calls.length=0;const start=performance.now()
 const page=await ArkmeService.prototype.readTeamMentionCandidates.call({executeTeamApp:owner.execute.bind(owner)} as never,c.ref,c.channel.teamRef,{limit:50})
 const metrics={fixture:'50 members + current visitor; fixed 120ms per authorized HTTP read; NOT production latency',elapsed:performance.now()-start,items:page.items.length,calls:calls.map(v=>({...v,start:v.start-start,end:v.end-start}))}
 if(process.env.ARKME_MENTION_METRICS)await writeFile(process.env.ARKME_MENTION_METRICS,JSON.stringify(metrics,null,2))
 expect(page.items).toHaveLength(51);expect(avatars.publicAvatarPresentationsByArkmeIds).not.toHaveBeenCalled()
 expect(calls.map(v=>v.path).sort()).toEqual(['/api/v1/team/conversations/timeline/page','/api/v1/team/members/snapshot'])
 const timeline=calls.find(v=>v.path.endsWith('/timeline/page'))!,members=calls.find(v=>v.path.endsWith('/members/snapshot'))!
 expect(members.start).toBeLessThan(timeline.end)
})
it('cancels the sibling membership read immediately when conversation authorization rejects',async()=>{
 const channel={team_id:'17',name:'Team',jotmo_id:'team',public_ref:'a'.repeat(32),enabled:true,revision:1}
 const conversation={conversation_uid:'conversation',side:'team',channel}
 const session={userId:90,accessToken:'token',refreshToken:'refresh'}
 let memberSignal:AbortSignal|undefined
 const runtime={config:{environment:'test'},stateStore:{uniqueCode:async()=> 'machine'},requireSession:async()=>session,accountScopedSession:async()=>session,
 authenticatedTeamPost:vi.fn(async(path:string,_body:unknown,_session:unknown,signal:AbortSignal)=>{
  if(path.endsWith('/open'))return {channel,conversation}
  if(path.endsWith('/members/snapshot'))return await new Promise((_resolve,reject)=>{memberSignal=signal;signal.addEventListener('abort',()=>reject(signal.reason),{once:true})})
  throw new Error('conversation no longer accessible')
 })} as unknown as ServiceRuntime
 const owner=new TeamAppService(runtime,{publicAvatarPresentationsByArkmeIds:vi.fn(async()=>new Map())})
 const c=(await owner.execute('team.app.open',{publicRef:channel.public_ref}) as TeamOpen).conversation!
 await expect(ArkmeService.prototype.readTeamMentionCandidates.call({executeTeamApp:owner.execute.bind(owner)} as never,c.ref,c.channel.teamRef,{},new AbortController().signal)).rejects.toThrow('no longer accessible')
 expect(memberSignal?.aborted).toBe(true)
})
