import {expect,it,vi} from 'vitest'
import {TeamAppService} from '../src/services/team-app-service.js'
import {ServiceRuntime,type ArkmeServiceConfig,type StateStore} from '../src/services/service.js'
import type {ArkmeSessionStore} from '../src/keychain-store.js'
import type {TeamMembers,TeamOpen} from '../src/team-app-contract.js'
import {parseOwnerJson,stringifyOwnerJson} from '../src/record-owner-id.js'
const channel={team_id:'17',name:'Team',jotmo_id:'team',public_ref:'a'.repeat(32),enabled:true,revision:1}
const current={conversation_uid:'conversation',side:'team',channel,external_user_id:12,visitor:{kind:'person',account_state:'active',nickname:'Visitor'}}
function fixture(avatarUrl?:string){
 let imageReads=0,actor=90, raw={...current}, afterRead:(()=>void)|undefined
 const requests:{path:string;body:Record<string,unknown>}[]=[]
 const runtime=new ServiceRuntime({environment:'test',teamBaseUrl:'https://team.test',routePath:'/api',requestTimeoutMs:5000} as ArkmeServiceConfig,{} as ArkmeSessionStore,{uniqueCode:async()=> 'machine'} as StateStore,(async(input,init)=>{
  if (!init?.body) {imageReads++;return new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'image/png'}})}
  const path=new URL(String(input)).pathname,body=parseOwnerJson(String(init?.body)) as Record<string,unknown>;requests.push({path,body})
  const data=path.endsWith('/open')?{channel,conversation:raw}:path.endsWith('/timeline/page')?{conversation:raw,messages:[]}:path.endsWith('/list-mine')?{teams:[{...channel,role:1}]}:{member_count:2,membership_revision:1,can_add_members:false,has_more:!body.cursor,next_cursor:body.cursor?undefined:'next',items:[{user_id:11,display_name:'Member',...(avatarUrl?{avatar_url:avatarUrl}:{}),identity_state:'ready',role:2,joined_at:1}]}
  if(path.endsWith('/members/snapshot'))afterRead?.()
  return new Response(stringifyOwnerJson({code:200,data}))
 }) as typeof fetch)
 vi.spyOn(runtime,'requireSession').mockImplementation(async()=>({userId:actor,accessToken:'token',refreshToken:'refresh'}))
 vi.spyOn(runtime,'accountScopedSession').mockImplementation(async()=>({userId:actor,accessToken:'token',refreshToken:'refresh'}))
 const service=new TeamAppService(runtime,{publicAvatarPresentationsByArkmeIds:vi.fn(async()=>new Map())})
 const open=async()=> (await service.execute('team.app.open',{publicRef:channel.public_ref}) as TeamOpen).conversation!
 return {service,requests,open,imageReads:()=>imageReads,setRaw:(value:typeof raw)=>{raw=value},afterRead:(fn:()=>void)=>{afterRead=fn},switchAccount:()=>{actor=91}}
}
it('signs current full-directory members and visitor for this conversation without avatar or historical-author reads',async()=>{
 const f=fixture(),c=await f.open()
 const page=await f.service.execute('team.app.members',{teamRef:c.channel.teamRef,conversationRef:c.ref,avatarMode:'deferred',limit:25}) as TeamMembers & {visitor:{personRef:string;personKey:string}}
 expect(page.items[0]).toMatchObject({displayName:'Member',personRef:expect.any(String),personKey:expect.any(String),isMe:false})
 expect(page.visitor).toMatchObject({nickname:'Visitor',personRef:expect.any(String)})
 expect(page.items[0]!.userRef).not.toBe((page.items[0] as any).personRef)
 expect(JSON.stringify(page)).not.toMatch(/conversation_uid|user_id/)
 expect(f.requests.map(r=>r.path)).toEqual(['/api/v1/team/conversations/open','/api/v1/team/conversations/timeline/page','/api/v1/team/members/snapshot','/api/v1/team/list-mine'])
 expect(f.requests[2]!.body.limit).toBe(25)
})
it('preserves old unscoped directory reads without person handles or additional conversation reads',async()=>{
 const f=fixture(),c=await f.open()
 const page=await f.service.execute('team.app.members',{teamRef:c.channel.teamRef,avatarMode:'deferred'}) as TeamMembers
 expect(page.items[0]).not.toHaveProperty('personRef');expect(page).not.toHaveProperty('visitor')
 expect(f.requests.some(r=>r.path.endsWith('/timeline/page'))).toBe(false)
})
it.each(['external','wrong-team'])('rejects %s before disclosing members',async kind=>{
 const f=fixture();if(kind==='external')f.setRaw({...current,side:'external'})
 const c=await f.open();if(kind==='wrong-team')f.setRaw({...current,channel:{...channel,team_id:'18'}})
 await expect(f.service.execute('team.app.members',{teamRef:c.channel.teamRef,conversationRef:c.ref,avatarMode:'deferred'})).rejects.toThrow()
 expect(f.requests.some(r=>r.path.endsWith('/members/snapshot'))).toBe(false)
})
it('binds continuation cursors to the exact conversation and keeps read limits bounded',async()=>{
 const f=fixture(),c=await f.open(),params={teamRef:c.channel.teamRef,conversationRef:c.ref,avatarMode:'deferred'}
 const page=await f.service.execute('team.app.members',params) as TeamMembers
 f.setRaw({...current,conversation_uid:'other'});const other=await f.open()
 await expect(f.service.execute('team.app.members',{...params,conversationRef:other.ref,pageCursor:page.nextPageCursor})).rejects.toThrow()
 await expect(f.service.execute('team.app.members',{...params,limit:101})).rejects.toThrow()
})
it.each(['account','abort'])('rejects a late %s result',async kind=>{
 const f=fixture(),c=await f.open(),controller=new AbortController()
 f.afterRead(()=>kind==='account'?f.switchAccount():controller.abort())
 await expect(f.service.execute('team.app.members',{teamRef:c.channel.teamRef,conversationRef:c.ref,avatarMode:'deferred'},controller.signal)).rejects.toThrow()
})
it('projects candidates without management handles and keeps visitor membership deduplication',async()=>{
 const f=fixture();f.setRaw({...current,external_user_id:11});const c=await f.open()
 const page=await f.service.execute('team.app.members',{teamRef:c.channel.teamRef,conversationRef:c.ref,mentionCandidates:true}) as import('../src/team-message-contract.js').TeamMentionCandidatePage
 expect(page.items).toHaveLength(1);expect(page.items[0]).toMatchObject({nickname:'Member',personRef:expect.any(String),personKey:expect.any(String)})
 expect(page).not.toHaveProperty('team');expect(page.items[0]).not.toHaveProperty('userRef');expect(f.requests.some(v=>v.path.endsWith('/list-mine'))).toBe(false)
 const next=await f.service.execute('team.app.members',{teamRef:c.channel.teamRef,conversationRef:c.ref,mentionCandidates:true,pageCursor:page.nextCursor}) as typeof page
 expect(next.items).toHaveLength(1);expect(next.hasMore).toBe(false)
})
it.each(['external','wrong-team','revoked','account','abort','cursor'])('preserves %s rejection with overlapping candidate reads',async kind=>{
 const f=fixture(),controller=new AbortController();if(kind==='external')f.setRaw({...current,side:'external'})
 const c=await f.open();const params={teamRef:c.channel.teamRef,conversationRef:c.ref,mentionCandidates:true}
 let cursor:string|undefined
 if(kind==='cursor'){
  cursor=(await f.service.execute('team.app.members',params) as {nextCursor:string}).nextCursor
  f.setRaw({...current,conversation_uid:'another'});params.conversationRef=(await f.open()).ref
 }
 if(kind==='wrong-team')f.setRaw({...current,channel:{...channel,team_id:'18'}})
 if(kind==='revoked')f.afterRead(()=>{throw new Error('membership revoked')})
 if(kind==='account')f.afterRead(()=>f.switchAccount())
 if(kind==='abort')f.afterRead(()=>controller.abort())
 await expect(f.service.execute('team.app.members',{...params,...(cursor?{pageCursor:cursor}:{})},controller.signal)).rejects.toThrow()
})

it('keeps snapshot avatars as account-bound Team image handles without another profile request',async()=>{
 const url='https://jotmo-userfiles.senguo.me/avatar/member.png',f=fixture(url),c=await f.open()
 const page=await f.service.execute('team.app.members',{teamRef:c.channel.teamRef,conversationRef:c.ref,mentionCandidates:true}) as import('../src/team-message-contract.js').TeamMentionCandidatePage
 expect(page.items[0]).toMatchObject({nickname:'Member',imageRef:expect.stringMatching(/^team-app-image\./),imageKey:expect.any(String)})
 expect(JSON.stringify(page)).not.toContain(url)
 expect(f.requests.map(v=>v.path)).toEqual(['/api/v1/team/conversations/open','/api/v1/team/members/snapshot','/api/v1/team/conversations/timeline/page'])
 expect(f.imageReads()).toBe(0)
 await expect(f.service.execute('team.app.image',{imageRef:page.items[0]!.imageRef})).resolves.toEqual({base64:'AQID',mimeType:'image/png'})
 expect(f.imageReads()).toBe(1)
 f.switchAccount()
 await expect(f.service.execute('team.app.image',{imageRef:page.items[0]!.imageRef})).rejects.toThrow()
 expect(f.requests).toHaveLength(3);expect(f.imageReads()).toBe(1)
})
it('keeps old snapshot rows with no avatar compatible',async()=>{
 const f=fixture(),c=await f.open()
 const page=await f.service.execute('team.app.members',{teamRef:c.channel.teamRef,conversationRef:c.ref,mentionCandidates:true}) as import('../src/team-message-contract.js').TeamMentionCandidatePage
 expect(page.items[0]).not.toHaveProperty('imageRef');expect(page.items[0]).not.toHaveProperty('imageKey')
})
