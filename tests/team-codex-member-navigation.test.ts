import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { TeamCodexService } from '../src/team-codex-service.js'
import type { ArkmeTeamMemberPage, ArkmeUserProfileSnapshot } from '../src/types.js'

const teamRef=`team_v1_${'a'.repeat(32)}`
const team={teamRef,name:'即我',jotmoId:'arkme_cn',currentUserRole:'member' as const,createdAtMillis:1,updatedAtMillis:1}
const self={userRef:`usr_v1_${'b'.repeat(32)}`,displayName:'同名',jotmoId:'self_user',identityState:'ready' as const,role:'member' as const,joinedAtMillis:1}
const colleague={...self,userRef:`usr_v1_${'c'.repeat(32)}`,jotmoId:'other_user'}
const cleanups:Array<()=>void>=[]
afterEach(()=>{for(const cleanup of cleanups.splice(0))cleanup()})
function fixture() {
  const root=mkdtempSync(join(tmpdir(),'codex-member-nav-')),codexHome=join(root,'codex')
  mkdirSync(codexHome)
  let user:number|undefined=11
  const members=vi.fn(async():Promise<ArkmeTeamMemberPage>=>({team,items:[self,colleague],totalCount:2,hasMore:false}))
  const post=vi.fn(async(_owner:number,path:string,body:Record<string,unknown>):Promise<unknown>=>{
    if(path.endsWith('list-mine'))return {teams:[{team_id:101,jotmo_id:'arkme_cn'}]}
    if(path.endsWith('/members/list'))return {items:[{user_id:11,jotmo_id:'self_user'},{user_id:22,jotmo_id:'other_user'}],has_more:false}
    return {items:[],page:body.page,has_more:false}
  })
  const service=new TeamCodexService({directory:join(root,'journal'),codexHome,currentUserId:async()=>user,
    profile:async()=>({profile:{userId:user,arkmeId:'self_user'}} as ArkmeUserProfileSnapshot),teams:{listMembers:members},
    cloud:{post:post as never,selectedTeam:async()=>team}})
  cleanups.push(()=>{service.close();rmSync(root,{recursive:true,force:true})})
  return {service,members,post,setUser:(next:number)=>{user=next;service.fence()}}
}
it('maps own directory reference directly to authenticated cloud owner without a member lookup',async()=>{
  const f=fixture()
  await f.service.state(teamRef,1,self.userRef)
  expect(f.post.mock.calls.find(call=>call[1].endsWith('/tasks/list'))?.[2]).toMatchObject({member_ref:'11'})
  expect(f.post.mock.calls.some(call=>call[1].endsWith('/members/list'))).toBe(false)
})
it('maps colleagues through both verified directories and caches only within the account/team',async()=>{
  const f=fixture()
  await f.service.state(teamRef,1,colleague.userRef)
  await f.service.state(teamRef,1,colleague.userRef)
  expect(f.post.mock.calls.filter(call=>call[1].endsWith('/members/list'))).toHaveLength(1)
  expect(f.post.mock.calls.filter(call=>call[1].endsWith('/tasks/list')).every(call=>call[2].member_ref==='22')).toBe(true)
  expect(f.post.mock.calls.some(call=>call[1].endsWith('/sync'))).toBe(false)
})
it('does not widen to all members when identity is missing or unavailable',async()=>{
  const f=fixture()
  f.members.mockResolvedValue({team,items:[self,{...colleague,identityState:'unavailable'}],totalCount:2,hasMore:false})
  await expect(f.service.state(teamRef,1,colleague.userRef)).rejects.toThrow('无法核对')
  expect(f.post).not.toHaveBeenCalled()
})
it('rejects late mapping results after the account switches',async()=>{
  const f=fixture(),original=f.post.getMockImplementation()!
  let finish:(value:unknown)=>void=()=>undefined
  f.post.mockImplementation(async(owner,path,body)=>path.endsWith('/members/list')?new Promise(resolve=>{finish=resolve}):original(owner,path,body))
  const result=f.service.state(teamRef,1,colleague.userRef)
  const rejected=expect(result).rejects.toThrow()
  await vi.waitFor(()=>expect(f.post.mock.calls.some(call=>call[1].endsWith('/members/list'))).toBe(true))
  f.setUser(22);finish({items:[{user_id:22,jotmo_id:'other_user'}],has_more:false})
  await rejected
  expect(f.post.mock.calls.some(call=>call[1].endsWith('/tasks/list'))).toBe(false)
})
