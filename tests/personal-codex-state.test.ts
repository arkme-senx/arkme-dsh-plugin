import { expect, it, vi } from 'vitest'
import { codexTaskViewKey, readPersonalCodexState } from '../src/client/redesign/contacts/personal-codex-state.js'
import type { TeamCodexState, TeamCodexTask } from '../src/team-codex-contract.js'
const teams = [{teamRef:'a',name:'A',jotmoId:'a'},{teamRef:'b',name:'B',jotmoId:'b'}]
const self = {userRef:'self',displayName:'Me',role:'member' as const,joinedAtMillis:1}
const task:TeamCodexTask = {id:'same-id',title:'Task',status:'active',state:'finished',updatedAt:1,eventCount:1,member:self}
const local:TeamCodexState = {localOnly:true,self,tasks:[task],installations:[]}
const remote = (ownerRef:string):TeamCodexTask => ({...task,cloud:{ownerRef,taskId:'remote',sourceId:'source',sourceName:'Laptop',remote:true}})
const cloud = {status:'ready' as const,pending:0,blocked:0,page:1,hasMore:false}
it('keeps only own canonical cloud rows and resolved local identities, with separate team routing',async()=>{
  const read=vi.fn(async(teamRef:string)=>teamRef==='a'?{...local,tasks:[task,{...task,id:'unknown',member:{...self,userRef:'someone'}}]}:
    {...local,localOnly:false,cloud,tasks:[remote('11'),{...remote('22'),id:'other'}]})
  const result=await readPersonalCodexState(teams,'11',1,read,new AbortController().signal)
  expect(result.state.tasks.map(t=>[t.id,t.viewTeam?.teamRef])).toEqual([['same-id','a'],['same-id','b']])
  expect(new Set(result.state.tasks.map(codexTaskViewKey)).size).toBe(2)
  expect(result.unavailable).toEqual([])
})
it('does not label local fallback or failed cloud reads as complete',async()=>{
  const result=await readPersonalCodexState(teams,'11',1,async ref=>{
    if(ref==='a')throw new Error('permission revoked')
    return {...local,cloud:{...cloud,status:'blocked'},tasks:[task,remote('11')]}
  },new AbortController().signal)
  expect(result.state.tasks).toHaveLength(1)
  expect(result.state.tasks[0]?.cloud).toBeUndefined()
  expect(result.unavailable.sort()).toEqual(['A','B'])
})
it('carries real pagination while not repeating unsupported local rows on later pages',async()=>{
  const result=await readPersonalCodexState(teams,'11',2,async ref=>ref==='a'?local:
    {...local,localOnly:false,cloud:{...cloud,page:2,hasMore:true},tasks:[remote('11')]},new AbortController().signal)
  expect(result.state.tasks.map(t=>t.viewTeam?.teamRef)).toEqual(['b'])
  expect(result.state.cloud?.hasMore).toBe(true)
})
it('aborts without publishing partial old-account results',async()=>{
  const controller=new AbortController()
  await expect(readPersonalCodexState(teams,'11',1,async()=>{controller.abort();return local},controller.signal)).rejects.toThrow()
})
it('limits simultaneous reads to three',async()=>{
  let inFlight=0,max=0
  await readPersonalCodexState(Array.from({length:9},(_,i)=>({...teams[0]!,teamRef:String(i)})),'11',1,async()=>{
    max=Math.max(max,++inFlight);await new Promise(resolve=>setTimeout(resolve,1));inFlight--;return local
  },new AbortController().signal)
  expect(max).toBe(3)
})
