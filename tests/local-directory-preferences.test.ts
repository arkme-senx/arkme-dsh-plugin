import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { ArkmeLocalDatabase } from '../src/local-database.js'
import { ArkmeService } from '../src/arkme-service.js'
import { dispatchArkmeHostOperation } from '../src/host-api.js'
import { builtinDirectoryPreferences } from '../src/client/builtin-directory-preferences.js'
import { notificationDirectoryPreferences } from '../src/client/notification-directory-preferences.js'
import { teamDirectoryPreferences } from '../src/client/team-directory-preferences.js'
import { callArkme } from '../src/client/api.js'
import { ArkmeStateStore } from '../src/state-store.js'
import { LocalDirectoryPreferenceStore, readLegacyDirectoryPreferences } from '../src/client/local-directory-preferences.js'
import { normalizeLocalDirectoryPreferences } from '../src/local-directory-preferences.js'
vi.mock('../src/client/api.js',()=>({callArkme:vi.fn()}))
const pin={pinned:true,pinnedAt:100},unpin={pinned:false,pinnedAt:0}
const keys=['builtin:self','builtin:arko','builtin:harness','notification','team:["folder","arkme"]','team:["conversation","team","arkme","visitor-1"]','team:["conversation","external","arkme","visitor-1"]']
it('survives a Host database reopen and an entirely new browser origin; old origins cannot revive unpins',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'arkme-directory-pins-'))
 let db=new ArkmeLocalDatabase(directory,new ArkmeStateStore(directory))
 const transport=async(op:string,p:Record<string,unknown>)=>db.localDirectoryPreferences(p.accountKey as string,p.entries as never,op.endsWith('migrate'))
 try {
  const first=new LocalDirectoryPreferenceStore(transport)
  await first.hydrate('prod:11')
  for(const key of keys)await first.set('prod:11',key,pin)
  await first.set('prod:11','builtin:self',unpin)
  db.close();db=new ArkmeLocalDatabase(directory,new ArkmeStateStore(directory))
  const freshOrigin=new LocalDirectoryPreferenceStore(transport,()=>({'builtin:self':pin}))
  await freshOrigin.hydrate('prod:11')
  expect(freshOrigin.read('prod:11')['builtin:self']).toEqual(unpin)
  for(const key of keys.slice(1))expect(freshOrigin.read('prod:11')[key]).toEqual(pin)
  expect(await db.localDirectoryPreferences('test:11')).toEqual({})
  expect(await db.localDirectoryPreferences('prod:12')).toEqual({})
  const service=Object.assign(Object.create(ArkmeService.prototype),{config:{environment:'prod'},stateStore:db,runtime:{requireSession:async()=>({userId:11})}}) as ArkmeService
  await expect(dispatchArkmeHostOperation(service,'directory.preferences.set',{accountKey:'prod:12',entries:{notification:pin}})).rejects.toMatchObject({code:'directory-account-changed'})
  await expect(dispatchArkmeHostOperation(service,'directory.preferences.set',{accountKey:'prod:11',entries:{invalid:pin}})).rejects.toMatchObject({code:'directory-preference-invalid'})
  await dispatchArkmeHostOperation(service,'directory.preferences.set',{accountKey:'prod:11',entries:{notification:unpin}})
  expect((await dispatchArkmeHostOperation(service,'directory.preferences.read',{accountKey:'prod:11'}) as Record<string,unknown>).notification).toEqual(unpin)
 }finally{db.close();await rm(directory,{recursive:true,force:true})}
})
it('keeps optimistic changes through late hydration and serializes quick pin/unpin without resurrection',async()=>{
 let finish!:(v:unknown)=>void
 const transport=vi.fn().mockImplementationOnce(()=>new Promise(r=>{finish=r}))
   .mockResolvedValueOnce({'builtin:self':pin}).mockResolvedValueOnce({'builtin:self':unpin})
 const store=new LocalDirectoryPreferenceStore(transport)
 const load=store.hydrate('prod:11');await Promise.resolve()
 const first=store.set('prod:11','builtin:self',pin),second=store.set('prod:11','builtin:self',unpin)
 expect(store.read('prod:11')['builtin:self']).toEqual(unpin)
 expect(store.read('prod:12')).toEqual({})
 await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));finish({})
 await load;expect(store.read('prod:11')['builtin:self']).toEqual(unpin)
 await Promise.all([first,second]);expect(store.read('prod:11')['builtin:self']).toEqual(unpin)
})
it('rolls failed saves back and reports failure instead of relying on a renderer-only copy',async()=>{
 const store=new LocalDirectoryPreferenceStore(vi.fn().mockResolvedValueOnce({'builtin:self':pin}).mockRejectedValueOnce(new Error('disk full')))
 await store.hydrate('prod:11')
 const saved=store.set('prod:11','builtin:self',unpin)
 expect(store.read('prod:11')['builtin:self']).toEqual(unpin)
 await expect(saved).rejects.toThrow('保存未确认')
 expect(store.read('prod:11')['builtin:self']).toEqual(pin)
})
it('migrates readable old preferences without credentials or message payloads',()=>{
 const data=new Map([['arkme.builtin.directory.pins.v1:prod:11','{"self":123,"arko":456}'],['arkme.notification.directory.pin.v1:prod:11','false'],['arkme.team.directory.preferences.v1:prod:11',JSON.stringify({'["folder","arkme"]':{pinned:true},'["conversation","team","arkme","v"]':{pinned:false,removal:{at:10,sequences:{'["conversation","team","arkme","v"]':3}}}})]])
 const entries=readLegacyDirectoryPreferences('prod:11',{getItem:k=>data.get(k)??null})
 expect(entries['builtin:self']).toEqual({pinned:true,pinnedAt:123})
 expect(entries.notification).toEqual(unpin)
 expect(entries['team:["conversation","team","arkme","v"]']?.removal?.at).toBe(10)
 expect(normalizeLocalDirectoryPreferences({'arbitrary':pin,'builtin:self':{...pin,token:'secret'}})).toEqual({'builtin:self':pin})
})

it('retains local storage for unrelated built-in and notification entries',async()=>{
 let saved:Record<string,unknown>={}
 vi.mocked(callArkme).mockImplementation(async(op,input)=>{if(op==='directory.preferences.set') saved={...saved,...input.entries as object};return saved as never})
 await builtinDirectoryPreferences.pin('prod:77','harness',true)
 await notificationDirectoryPreferences.pin('prod:77',true)
 expect(JSON.parse(builtinDirectoryPreferences.snapshot('prod:77')).harness).toBeGreaterThan(0)
 expect(notificationDirectoryPreferences.read('prod:77')).toBe(true)
 expect(vi.mocked(callArkme).mock.calls.filter(([op])=>op==='directory.preferences.set')).toHaveLength(2)
})
