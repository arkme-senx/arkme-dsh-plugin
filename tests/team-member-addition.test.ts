import {it,expect,vi} from 'vitest'
import {mkdtemp,readFile,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {ArkmeStateStore} from '../src/state-store.js'
import {TeamMemberAddition} from '../src/services/team-member-addition.js'
it('persists original intent before dispatch, survives lost replies/restarts and isolates accounts',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'team members ')),store=new ArkmeStateStore(dir)
 let accepted=false
 const post=vi.fn(async(path:string,body:any)=>{
  if(path==='members/add-status')return accepted?{team_id:'7',actor_user_id:'11',request_uid:'batch',member_count:2,membership_revision:1,items:[{user_id:'9007199254740993',status:'added'}]}:{state:'not_found'}
  expect(await store.teamMemberAddition('test:11','7')).toMatchObject({requestUid:'batch',userIds:['9007199254740993']})
  accepted=true;throw new Error('reply lost')
 })
 const ports={actor:11,teamId:'7',open:async()=>({team_id:'7',user_id:'9007199254740993',expires:Date.now()+1000}),key:async()=> 'opaque',post,journal:(change?:any)=>store.teamMemberAddition('test:11','7',change)}
 await expect(new TeamMemberAddition(ports).add('batch',['ref'])).rejects.toThrow('reply lost')
 expect(await new ArkmeStateStore(dir).teamMemberAddition('test:12','7')).toBeUndefined()
 const restart=new TeamMemberAddition({...ports,journal:change=>new ArkmeStateStore(dir).teamMemberAddition('test:11','7',change)})
 expect(await restart.recover()).toMatchObject({state:'completed',requestUid:'batch',items:[{status:'added'}]})
 await expect(restart.add('other',['ref'])).rejects.toThrow('原批次')
 expect((await restart.retry()).state).toBe('completed')
 expect(post.mock.calls.filter(([path])=>path==='members/add')).toHaveLength(1)
 await restart.ack('older');expect(await store.teamMemberAddition('test:11','7')).toBeDefined()
 await restart.ack('batch');expect(await new ArkmeStateStore(dir).teamMemberAddition('test:11','7')).toBeUndefined()
})
it('refuses overwriting or discarding unknown attempts and preserves corrupt evidence',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'team members ')),store=new ArkmeStateStore(dir)
 await store.teamMemberAddition('prod:11','7',{put:{requestUid:'a',userIds:['12']}})
 await expect(store.teamMemberAddition('prod:11','7',{put:{requestUid:'b',userIds:['13']}})).rejects.toThrow('原批次')
 const path=join(dir,'state.json'),raw=JSON.parse(await readFile(path,'utf8'));raw.teamMemberAdditions='broken';await writeFile(path,JSON.stringify(raw))
 await expect(new ArkmeStateStore(dir).teamMemberAddition('prod:11','7',{ack:'a'})).rejects.toThrow('损坏')
 expect(JSON.parse(await readFile(path,'utf8')).teamMemberAdditions).toBe('broken')
})
it('keeps uncertain requests immutable and rejects foreign or duplicate receipt rows',async()=>{
 let attempt:any
 const post=vi.fn(async(path:string)=>path==='members/add-status'?{state:'not_found'}:{team_id:'7',actor_user_id:'11',request_uid:'a',member_count:2,membership_revision:1,items:[{user_id:'99',status:'added'}]})
 const owner=new TeamMemberAddition({actor:11,teamId:'7',open:async()=>({team_id:'7',user_id:'12',expires:Date.now()+1000}),key:async()=>'',post,journal:async(change:any)=>{if(change?.put)attempt=change.put;return attempt}})
 await expect(owner.add('a',['ref'])).rejects.toThrow('不完整');expect(attempt.requestUid).toBe('a')
 await expect(owner.ack('a')).rejects.toThrow();expect(attempt).toBeDefined()
 await expect(owner.add('b',['ref'])).rejects.toThrow('原批次')
})
