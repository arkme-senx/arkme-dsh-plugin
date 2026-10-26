import { expect, it, vi } from 'vitest'
import { codexTaskViewKey, readPersonalCodexState } from '../src/client/redesign/contacts/personal-codex-state.js'
import type { TeamCodexState, TeamCodexTask } from '../src/team-codex-contract.js'
const self = {userRef:'self',displayName:'Me',role:'member' as const,joinedAtMillis:1}
const task:TeamCodexTask = {id:'same-id',title:'Task',status:'active',state:'finished',updatedAt:1,eventCount:1,member:self}
const local:TeamCodexState = {localOnly:true,self,tasks:[task],installations:[]}
const remote = (ownerRef:string,id=ownerRef):TeamCodexTask => ({...task,id,cloud:{ownerRef,taskId:id,sourceId:'source',sourceName:'Laptop',remote:true}})
const cloud = {status:'ready' as const,pending:0,blocked:0,page:1,hasMore:false}
const signal=()=>new AbortController().signal
it('uses one account read without requiring a current team and rejects foreign local/cloud identities',async()=>{
  const read=vi.fn(async()=>({...local,localOnly:false,cloud,tasks:[task,{...task,id:'foreign-local',member:{...self,userRef:'someone'}},remote('11'),remote('22')]}))
  const result=await readPersonalCodexState('11',read,signal())
  expect(read.mock.calls).toEqual([['self']])
  expect(result.state.tasks.map(t=>[t.id,t.viewTeam?.teamRef])).toEqual([['same-id','self'],['11','self']])
  expect(new Set(result.state.tasks.map(codexTaskViewKey)).size).toBe(2)
  expect(result.unavailable).toEqual([])
})
it('carries the account endpoint pagination without multiplying requests by team membership',async()=>{
  const result=await readPersonalCodexState('11',async()=>({...local,localOnly:false,cloud:{...cloud,page:2,hasMore:true},tasks:[remote('11')]}),signal())
  expect(result.state.cloud).toMatchObject({page:2,hasMore:true})
})
it('aborts without publishing old-account results',async()=>{
  const controller=new AbortController()
  await expect(readPersonalCodexState('11',async()=>{controller.abort();return local},controller.signal)).rejects.toThrow()
})
it('preserves only own stale mirrors offline and clears mirrors after explicit denial',async()=>{
  for(const status of ['offline','blocked'] as const) {
    const result=await readPersonalCodexState('11',async()=>({...local,cloud:{...cloud,status},tasks:[task,remote('11'),remote('22')]}),signal())
    expect(result.state.tasks.map(t=>t.id)).toEqual(status==='offline'?['same-id','11']:['same-id'])
    expect(result.unavailable).toEqual(['云端暂不可用'])
  }
})
it('does not reinterpret a failed account read as an empty history',async()=>{
  await expect(readPersonalCodexState('11',async()=>{throw Error('offline')},signal())).rejects.toThrow('offline')
})
