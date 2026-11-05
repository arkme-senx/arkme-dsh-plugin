import {it,expect,vi} from 'vitest'
import {mkdtemp,readFile,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {ArkmeStateStore} from '../src/state-store.js'
import {TeamInternalGroups, type InternalGroupPorts} from '../src/services/team-internal-groups.js'
import type {TeamInternalGroupAttempt} from '../src/team-internal-group-contract.js'

const input:TeamInternalGroupAttempt['input']={mode:'create',team_id:'9007199254740993',name:'工程群'}
async function fixture() {
  const dir=await mkdtemp(join(tmpdir(),'internal group ')),store=new ArkmeStateStore(dir)
  let accepted=false,loseReply=false
  const refs=new Map<string,Record<string,unknown>>()
  const post=vi.fn(async(path:string,body:Record<string,unknown>)=>{
    if(path==='status')return accepted?{state:'ready',request_uid:'original'}:{state:'not_found'}
    if(path==='preview')return {preview_token:`token-${post.mock.calls.length}`,expires_at:Date.now()+300000}
    expect(await store.teamInternalGroup('test:11',input.team_id)).toMatchObject({requestUid:'original',input})
    accepted=true
    if(loseReply)throw new Error('reply lost')
    return {state:'accepted',request_uid:body.request_uid}
  })
  const ports:InternalGroupPorts={journal:change=>store.teamInternalGroup('test:11',input.team_id,change),post,
    seal:async value=>{const ref=`opaque-${refs.size}`;refs.set(ref,value);return ref},open:async ref=>refs.get(ref)!,
    preview:async(_data,requestUid,previewRef)=>({state:'preview',requestUid,previewRef,expiresAt:Date.now()+300000,add:[],remove:[],retainCount:0,botCount:0,owner:{key:'owner',name:'负责人'},ownerChanged:false,roleChanges:[],closePublicAccess:false,requiresClientUpgrade:false})}
  return {dir,store,ports,owner:new TeamInternalGroups(ports),post,setLost:()=>{loseReply=true},accept:()=>{accepted=true}}
}
it('persists before dispatch, resolves lost acknowledgement and survives restart/account changes',async()=>{
  const f=await fixture(),preview=await f.owner.prepare(input,'original','工程群')
  expect(preview.state).toBe('preview');expect(await f.ports.journal()).toBeUndefined()
  f.setLost()
  expect(await f.owner.confirm((preview as {previewRef:string}).previewRef)).toMatchObject({state:'ready',requestUid:'original'})
  const restarted=new TeamInternalGroups({...f.ports,journal:change=>new ArkmeStateStore(f.dir).teamInternalGroup('test:11',input.team_id,change)})
  expect(await restarted.recover()).toMatchObject({state:'ready',label:'工程群'})
  expect(await new ArkmeStateStore(f.dir).teamInternalGroup('prod:11',input.team_id)).toBeUndefined()
  expect(await new ArkmeStateStore(f.dir).teamInternalGroup('test:12',input.team_id)).toBeUndefined()
  await expect(restarted.ack('other')).rejects.toThrow()
  await restarted.ack('original');expect(await new ArkmeStateStore(f.dir).teamInternalGroup('test:11',input.team_id)).toBeUndefined()
  expect(f.post.mock.calls.filter(([p])=>p==='confirm')).toHaveLength(1)
})
it('never replaces an uncertain command; renewed previews keep its exact UID and original selection',async()=>{
  const f=await fixture()
  await f.ports.journal({put:{requestUid:'original',input,label:'工程群'}})
  expect(await f.owner.prepare({...input,name:'其他群'},'new-request','其他群')).toMatchObject({state:'unresolved',requestUid:'original'})
  const renewed=await f.owner.prepareOriginal()
  expect(renewed).toMatchObject({state:'preview',requestUid:'original',mode:'create',label:'工程群'})
  expect(f.post.mock.calls.find(([p])=>p==='preview')?.[1]).toEqual(input)
  await expect(f.owner.ack('original')).rejects.toThrow()
  expect(await f.ports.journal()).toMatchObject({requestUid:'original',input})
  f.accept();expect(await f.owner.prepareOriginal()).toMatchObject({state:'ready',requestUid:'original'})
})
it('serializes different confirmations in the production journal and preserves corrupt evidence',async()=>{
  const f=await fixture()
  const p=await f.owner.prepare(input,'original','工程群'),q=await f.owner.prepare({...input,name:'另一群'},'different','另一群')
  const results=await Promise.allSettled([f.owner.confirm((p as {previewRef:string}).previewRef),f.owner.confirm((q as {previewRef:string}).previewRef)])
  expect(results.filter(x=>x.status==='fulfilled')).toHaveLength(1)
  expect(f.post.mock.calls.filter(([path])=>path==='confirm')).toHaveLength(1)
  const path=join(f.dir,'state.json'),raw=JSON.parse(await readFile(path,'utf8'));raw.teamInternalGroups='corrupt';await writeFile(path,JSON.stringify(raw))
  await expect(new ArkmeStateStore(f.dir).teamInternalGroup('test:11',input.team_id,{ack:'original'})).rejects.toThrow('损坏')
  expect(JSON.parse(await readFile(path,'utf8')).teamInternalGroups).toBe('corrupt')
})
it('settles a definitive pre-activation stale rejection without replacing the original receipt',async()=>{
 const f=await fixture();await f.ports.journal({put:{requestUid:'original',input,label:'工程群'}})
 f.ports.post=vi.fn(async()=>({state:'rejected',reason:'preview_stale',request_uid:'original'}))
 const owner=new TeamInternalGroups(f.ports)
 expect(await owner.recover()).toMatchObject({state:'rejected',requestUid:'original'})
 await owner.ack('original');expect(await f.ports.journal()).toBeUndefined()
})

it('returns the original mode and label after reopening through a different entry',async()=>{
 const f=await fixture(), original={mode:'link' as const,team_id:input.team_id,chat_session_uid:'original-group'}
 await f.ports.journal({put:{requestUid:'original',input:original,label:'原协作群'}})
 expect(await f.owner.prepare(input,'new-request','新群')).toMatchObject({state:'unresolved',label:'原协作群'})
 expect(await f.owner.prepareOriginal()).toMatchObject({state:'preview',mode:'link',label:'原协作群',requestUid:'original'})
 expect(f.post.mock.calls.find(([p])=>p==='preview')?.[1]).toEqual(original)
})
