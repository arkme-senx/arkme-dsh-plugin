import { expect, test, vi } from 'vitest'
import { AppMigrationStore } from '../src/client/app-migration-store.js'
import type { MigrationSnapshot } from '../src/app-migration-shared.js'
const available: MigrationSnapshot={phase:'available',currentVersion:'0.3.3',downloadedBytes:0,prompt:true,target:{version:'3.0.0',versionCode:277,kind:'pkg',downloadUrl:'https://d.jiwo.cc/app.pkg'}}
test('does not prompt in background, prompts after focus, background download stays hidden', async()=>{
 let foreground=false
 const call=vi.fn(async()=>({...available}))
 const store=new AppMigrationStore(call,()=>true,()=>foreground)
 await store.refresh(true);expect(store.getSnapshot().visible).toBe(false)
 foreground=true;await store.refresh(true);expect(store.getSnapshot().visible).toBe(true)
 await store.dismiss();expect(store.getSnapshot().visible).toBe(false)
 call.mockImplementation(async()=>({...available,phase:'downloading'}))
 await store.refresh(false);expect(store.getSnapshot().visible).toBe(false)
 call.mockImplementation(async()=>({...available,phase:'completed'}))
 foreground=false;await store.refresh(false);expect(store.getSnapshot().visible).toBe(false)
 foreground=true;await store.refresh(false);expect(store.getSnapshot().visible).toBe(true)
})
test('remote/browser contexts do not call host',async()=>{
 const call=vi.fn();const store=new AppMigrationStore(call,()=>false,()=>true)
 await store.refresh(true);expect(call).not.toHaveBeenCalled()
})
test('display acknowledges the prompt so plugin restart does not repeat it',async()=>{
 let status={...available}
 const call=vi.fn(async(op:string)=>{if(op==='app.migration.dismiss')status={...status,prompt:false};return status})
 const store=new AppMigrationStore(call,()=>true,()=>true)
 await store.refresh(true);expect(store.getSnapshot().visible).toBe(true)
 const restarted=new AppMigrationStore(call,()=>true,()=>true)
 await restarted.refresh(true);expect(restarted.getSnapshot().visible).toBe(false)
})
test('manual settings entry checks latest again even when an installer was available',async()=>{
 const call=vi.fn(async()=>available);const store=new AppMigrationStore(call,()=>true,()=>true)
 await store.refresh(true);call.mockClear();await store.open()
 expect(call).toHaveBeenCalledWith('app.migration.check',{manual:true})
})
test('a fresh next-day Host reminder is displayed without restarting the plugin', async()=>{
 const {AppMigrationManager}=await import('../src/app-migration.js')
 const {mkdtemp,rm}=await import('node:fs/promises')
 const {tmpdir}=await import('node:os')
 const {join}=await import('node:path')
 const root=await mkdtemp(join(tmpdir(),'migration-next-day-'))
 let now=new Date(2026,8,22,12).getTime()
 const target=available.target!
 const manager=new AppMigrationManager({enabled:true,currentVersion:'0.3.3',platform:'darwin',architecture:'arm64',stateDirectory:root,serviceOrigin:'https://api.jotmo.cc',artifactOrigin:'https://d.jiwo.cc',now:()=>now,fetch:async()=>Response.json({...target,installer:target})})
 const store=new AppMigrationStore(async(op,params)=>op==='app.migration.check'?manager.check(params?.manual===true):op==='app.migration.dismiss'?manager.dismiss():manager.status(),()=>true,()=>true)
 try {
  await store.refresh(true);expect(store.getSnapshot().visible).toBe(true)
  await store.dismiss();await store.refresh(true);expect(store.getSnapshot().visible).toBe(false)
  now+=86400000;await store.refresh(true)
  expect(store.getSnapshot().status?.prompt).toBe(true)
  expect(store.getSnapshot().visible).toBe(true)
 } finally {await manager.dismiss();await manager.dispose();await rm(root,{recursive:true,force:true})}
})
test('a check started before dismissal must not reopen the dialog with its delayed result',async()=>{
 let release!: (status:MigrationSnapshot)=>void
 let checking=false
 const store=new AppMigrationStore(async operation=>operation==='app.migration.check'&&checking?await new Promise<MigrationSnapshot>(resolve=>{release=resolve}):available,()=>true,()=>true)
 await store.refresh(true);checking=true
 const pending=store.refresh(true)
 await store.dismiss();release(available);await pending
 expect(store.getSnapshot().visible).toBe(false)
})
test('ready installer prompts on startup and activation, but not on polling after close', async()=>{
 const completed:MigrationSnapshot={...available,phase:'completed',prompt:false,fileName:'即我.pkg'}
 const store=new AppMigrationStore(async()=>completed,()=>true,()=>true)
 await store.refresh(true);expect(store.getSnapshot().visible).toBe(true)
 await store.dismiss();await store.refresh();expect(store.getSnapshot().visible).toBe(false)
 await store.refresh(true);expect(store.getSnapshot().visible).toBe(true)
})
test('activation during an in-flight poll still performs a ready check',async()=>{
 const completed:MigrationSnapshot={...available,phase:'completed',prompt:false}
 let release!:(s:MigrationSnapshot)=>void
 const call=vi.fn(async(op:string)=>op==='app.migration.status'?await new Promise<MigrationSnapshot>(resolve=>{release=resolve}):completed)
 const store=new AppMigrationStore(call,()=>true,()=>true)
 const poll=store.refresh();const activation=store.refresh(true)
 release(completed);await Promise.all([poll,activation])
 expect(call).toHaveBeenCalledWith('app.migration.check',{manual:false})
 expect(store.getSnapshot().visible).toBe(true)
})
test('foreground polling detects activation even when window focus event is absent',async()=>{
 vi.useFakeTimers();vi.stubGlobal('window',new EventTarget());vi.stubGlobal('document',new EventTarget())
 let foreground=true
 const completed:MigrationSnapshot={...available,phase:'completed',prompt:false}
 const store=new AppMigrationStore(async()=>completed,()=>true,()=>foreground)
 const stop=store.start()
 try {
  await vi.advanceTimersByTimeAsync(1);await store.dismiss()
  foreground=false;await vi.advanceTimersByTimeAsync(1000)
  foreground=true;await vi.advanceTimersByTimeAsync(1000)
  expect(store.getSnapshot().visible).toBe(true)
 }finally{stop();vi.useRealTimers();vi.unstubAllGlobals()}
})
