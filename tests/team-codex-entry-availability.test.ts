import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { TeamCodexService } from '../src/team-codex-service.js'
import type { TeamCodexCloudPort } from '../src/team-codex-cloud.js'

const cleanup:Array<()=>void>=[]
afterEach(()=>{for(const close of cleanup.splice(0).reverse()) close()})
function fixture() {
  const directory=mkdtempSync(join(tmpdir(),'codex-entry-'))
  cleanup.push(()=>rmSync(directory,{recursive:true,force:true}))
  let user:number|undefined=11,now=1000
  const post=vi.fn<(...args:unknown[])=>Promise<unknown>>(async()=>({items:[],page:1,has_more:false}))
  const options={directory,currentUserId:async()=>user,profile:vi.fn(),teams:{listMembers:vi.fn()},now:()=>now,
    cloud:{post,selectedTeam:vi.fn()} as TeamCodexCloudPort}
  let service=new TeamCodexService(options)
  cleanup.push(()=>service.close())
  return {post,get service(){return service},setUser:(id:number|undefined)=>{user=id;service.fence()},
    advance:()=>{now+=31_000},restart:()=>{service.close();service=new TeamCodexService(options)}}
}
const ownTask={task_id:'22222222-2222-4222-8222-222222222222',source_id:'11111111-1111-4111-8111-111111111111',owner_ref:'11',team_ref:'101'}

it('hides new accounts and throttles cloud checks without enrolling or enabling upload',async()=>{
  const f=fixture()
  expect(await f.service.entryAvailability(11)).toEqual({userId:11,visible:false,checked:true})
  await f.service.entryAvailability(11)
  expect(f.post).toHaveBeenCalledTimes(1)
  f.advance();await f.service.entryAvailability(11)
  expect(f.post).toHaveBeenCalledTimes(2)
  expect(f.post.mock.calls.every(call=>call[1]==='/api/v1/team-codex/tasks/list')).toBe(true)
})
it('remembers verified cloud history across restart and offline without leaking to another account',async()=>{
  const f=fixture();f.post.mockResolvedValue({items:[ownTask],page:1,has_more:false})
  expect((await f.service.entryAvailability(11)).visible).toBe(true)
  f.restart();f.post.mockRejectedValue(new Error('offline'))
  expect((await f.service.entryAvailability(11)).visible).toBe(true)
  expect(f.post).toHaveBeenCalledTimes(1)
  f.setUser(22)
  expect(await f.service.entryAvailability(22)).toEqual({userId:22,visible:false,checked:false})
  f.setUser(undefined);await expect(f.service.entryAvailability(11)).rejects.toThrow('登录')
})
it('ignores another member or malformed responses as binding evidence',async()=>{
  const f=fixture();f.post.mockResolvedValue({items:[{...ownTask,owner_ref:'22'}],page:1,has_more:false})
  expect(await f.service.entryAvailability(11)).toEqual({userId:11,visible:false,checked:false})
  f.advance();f.post.mockResolvedValue({items:[],page:1,has_more:false})
  expect(await f.service.entryAvailability(11)).toEqual({userId:11,visible:false,checked:true})
})
it('rejects a delayed response after an account switch, including switch away and back',async()=>{
  const f=fixture();let resolve!:(value:unknown)=>void
  f.post.mockImplementation(()=>new Promise(done=>{resolve=done}))
  const result=f.service.entryAvailability(11),rejected=expect(result).rejects.toThrow()
  await vi.waitFor(()=>expect(f.post).toHaveBeenCalledTimes(1))
  f.setUser(22);f.setUser(11);resolve({items:[ownTask],page:1,has_more:false});await rejected
  f.post.mockResolvedValue({items:[],page:1,has_more:false})
  expect((await f.service.entryAvailability(11)).visible).toBe(false)
})
