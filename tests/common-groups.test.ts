import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it, vi } from 'vitest'
import { ArkmeLocalDatabase } from '../src/local-database.js'
import { ArkmeStateStore } from '../src/state-store.js'
import { CommonGroupService, commonGroupChanges } from '../src/services/common-group-service.js'
import type { ServiceRuntime } from '../src/services/service.js'
import type { SourceService } from '../src/services/source-service.js'

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ uid: String(i+1).padStart(3, '0'), title: `群${i+1}`, memberCount: 2 }))
async function database() {
  const path = await mkdtemp(join(tmpdir(), 'common groups '))
  const db = new ArkmeLocalDatabase(path, new ArkmeStateStore(path))
  return { path, db, async close() { this.db.close(); await rm(path, { recursive: true, force: true }) } }
}

describe('persistent common groups', () => {
  it('persists 20-row pages, checkpoints and isolated relationships across restart', async () => {
    const f = await database()
    try {
      for (const batch of [rows(20), rows(41).slice(20,40), rows(41).slice(40)]) {
        const old = f.db.commonGroups.read('test:1','peer').checkpoint
        f.db.commonGroups.apply('test:1','peer',old,{items:batch.map(row=>({...row,groupAvatar:{memberCount:2,strategy:"test",computedAtMillis:1,slots:[{fallback:{kind:"default" as const}}]}})),removed:[],phase:'discover',after:batch.at(-1)!.uid})
      }
      f.db.close(); f.db = new ArkmeLocalDatabase(f.path,new ArkmeStateStore(f.path))
      expect(f.db.commonGroups.read('test:1','peer').items).toHaveLength(20)
      expect(f.db.commonGroups.read('test:1','peer','020').items).toHaveLength(20)
      expect(f.db.commonGroups.read('test:1','peer','040').items).toHaveLength(1)
      expect(f.db.commonGroups.read('test:1','peer').items[0]!.groupAvatar?.slots).toHaveLength(1)
      expect(f.db.commonGroups.read('test:1','peer').checkpoint.after).toBe('041')
      expect(f.db.commonGroups.read('production:1','peer').total).toBe(0)
      expect(f.db.commonGroups.read('test:2','peer').total).toBe(0)
      expect(f.db.commonGroups.read('test:1','other').total).toBe(0)
    } finally { await f.close() }
  })
  it('commits deltas with checkpoints, rejects stale writers and rolls back SQL failure', async () => {
    const f = await database()
    const raw = new DatabaseSync(join(f.path,'records.sqlite3'))
    try {
      const first=f.db.commonGroups.read('s','p').checkpoint
      expect(f.db.commonGroups.apply('s','p',first,{items:rows(2),removed:[],phase:'discover',after:'002'})).toBe(true)
      expect(f.db.commonGroups.apply('s','p',first,{items:[],removed:['001'],phase:'complete',after:''})).toBe(false)
      const next=f.db.commonGroups.read('s','p').checkpoint
      raw.exec("CREATE TRIGGER fail_group BEFORE DELETE ON common_group_relation BEGIN SELECT RAISE(ABORT,'injected'); END")
      expect(()=>f.db.commonGroups.apply('s','p',next,{items:[{...rows(1)[0]!,title:'new'}],removed:['002'],phase:'complete',after:''})).toThrow('injected')
      expect(f.db.commonGroups.read('s','p').checkpoint).toEqual(next)
      expect(f.db.commonGroups.read('s','p').items[0]!.title).toBe('群1')
      raw.exec('DROP TRIGGER fail_group')
      f.db.commonGroups.apply('s','p',next,{items:[{...rows(1)[0]!,title:'new'}],removed:['002'],phase:'complete',after:''})
      expect(f.db.commonGroups.read('s','p').items).toEqual([{uid:'001',title:'new',memberCount:2}])
      expect(f.db.commonGroups.read('s','p').checkpoint.syncedAtMillis).toBeGreaterThan(0)
      raw.exec("CREATE TRIGGER no_redundant_update BEFORE UPDATE ON common_group_relation BEGIN SELECT RAISE(ABORT,'unchanged row updated'); END")
      const unchanged = f.db.commonGroups.read('s', 'p')
      expect(f.db.commonGroups.apply('s', 'p', unchanged.checkpoint, {
        items: unchanged.items, removed: [], phase: 'complete', after: '',
      })).toBe(true)
      expect(f.db.commonGroups.read('s', 'p').checkpoint.revision).toBe(unchanged.checkpoint.revision + 1)
    } finally { raw.close(); await f.close() }
  })
  it('rejects incomplete, duplicate and unauthorized deletion evidence', () => {
    const good={items:[{chat_session_uid:'b',title:'B',member_count:2}],removed:['a'],has_more:false}
    expect(commonGroupChanges(good,['a','b'],'').removed).toEqual(['a'])
    for(const bad of [{...good,removed:[]},{...good,removed:['c']},{...good,has_more:true},{...good,items:[...good.items,...good.items]}]) expect(()=>commonGroupChanges(bad,['a','b'],'')).toThrow()
    expect(()=>commonGroupChanges(good,[],'')).toThrow()
    expect(()=>commonGroupChanges({items:good.items,removed:[],has_more:true,next_after:'a'},[],'')).toThrow()
  })
  it('reads offline before network, syncs 20-row batches, and reconciles explicit removals', async () => {
    const f=await database()
    let groups=rows(21), online=true
    const remote=vi.fn(async (path:string,body:Record<string,unknown>)=>{
      if(!online)throw Error('offline')
      if(path.endsWith('/detail'))return {private_counterpart:{user_id:2}}
      const known=body.known_group_uids as string[]|undefined
      const all=known?groups.filter(x=>known.includes(x.uid)):groups.filter(x=>x.uid>String(body.after??''))
      const batch=all.slice(0,20)
      return {items:batch.map(x=>({chat_session_uid:x.uid,title:x.title,member_count:x.memberCount})),removed:known?.filter(x=>!all.some(y=>y.uid===x))??[],has_more:!known&&all.length>20,...(!known&&all.length>20?{next_after:batch.at(-1)!.uid}:{})}
    })
    const runtime={config:{environment:'test',chatBaseUrl:'https://chat.invalid'},stateStore:f.db,requireSocialSession:async()=>({userId:1}),requireSession:async()=>({userId:1}),authenticatedChatPost:remote} as unknown as ServiceRuntime
    const source={hydrateDirectoryPage:async(items:unknown[])=>items,openSourceRef:async(ref:string,userId:number)=>({kind:ref==='private'?'private_chat':'group_chat',ownerRef:ref,userId}),sourceItem:async(row:{ownerRef:string;displayName:string})=>({sourceRef:row.ownerRef,displayName:row.displayName,kind:'group_chat'})} as unknown as SourceService
    const service=new CommonGroupService(runtime,source)
    try {
      expect((await service.list('private')).totalCached).toBe(0);expect(remote).not.toHaveBeenCalled()
      expect((await service.sync('private')).items).toHaveLength(20)
      expect((await service.sync('private')).syncHasMore).toBe(false)
      groups=[{...groups[0]!,title:'改名'},...groups.slice(2)]
      let result=await service.sync('private')
      for(let i=0;result.syncHasMore&&i<5;i++)result=await service.sync('private')
      expect(result.totalCached).toBe(20);expect(result.items[0]!.source.displayName).toBe('改名')
      online=false
      expect((await service.list('private')).totalCached).toBe(20)
      await expect(service.sync('private')).rejects.toThrow('offline')
      expect((await service.list('private')).totalCached).toBe(20)
    } finally {service.dispose();await f.close()}
  })
  it('coalesces concurrent readers, cancels only the last consumer, and rejects late account writes', async () => {
    const f=await database()
    let userId=1, resolve: (value:unknown)=>void = ()=>{}, sharedSignal:AbortSignal|undefined
    const queryStarted=vi.fn()
    const runtime={config:{environment:'test',chatBaseUrl:'https://chat.invalid'},stateStore:f.db,
      requireSocialSession:async()=>({userId}),requireSession:async()=>({userId}),authenticatedChatPost:async(path:string,_body:unknown,_session:unknown,signal:AbortSignal)=>{
        if(path.endsWith('/detail'))return {private_counterpart:{user_id:2}}
        sharedSignal=signal;queryStarted()
        return await new Promise(done=>{resolve=done})
      }} as unknown as ServiceRuntime
    const source={hydrateDirectoryPage:async(items:unknown[])=>items,openSourceRef:async()=>({kind:'private_chat',ownerRef:'p'}),
      sourceItem:async()=>({sourceRef:'opaque',kind:'group_chat',displayName:'group'})} as unknown as SourceService
    const service=new CommonGroupService(runtime,source)
    const response={items:[{chat_session_uid:'a',title:'group',member_count:2}],removed:[],has_more:false}
    try {
      const a=new AbortController(),b=new AbortController()
      const one=service.sync('p',a.signal), two=service.sync('p',b.signal)
      const rejected=expect(one).rejects.toBeDefined()
      await vi.waitFor(()=>expect(queryStarted).toHaveBeenCalledTimes(1))
      a.abort();await rejected
      expect(sharedSignal?.aborted).toBe(false)
      resolve(response);await two
      expect((await service.list('p')).revision).toBe(1)
      const late=service.sync('p')
      const changed=expect(late).rejects.toThrow('账号已切换')
      await vi.waitFor(()=>expect(queryStarted).toHaveBeenCalledTimes(2))
      userId=3;resolve(response);await changed
      expect((await service.list('p')).totalCached).toBe(0)
      userId=1
      expect((await service.list('p')).revision).toBe(1)
      const canceled=service.sync('p');const aborted=expect(canceled).rejects.toBeDefined()
      await vi.waitFor(()=>expect(queryStarted).toHaveBeenCalledTimes(3))
      service.dispose();expect(sharedSignal?.aborted).toBe(true);resolve(response);await aborted
      expect((await service.list('p')).revision).toBe(1)
    } finally {service.dispose();await f.close()}
  })
  it('bounds cache growth without deleting prior rows or advancing the checkpoint', async()=>{
    const f=await database();const raw=new DatabaseSync(join(f.path,'records.sqlite3'))
    try {
      raw.exec("INSERT INTO common_group_sync VALUES ('s','p',1,'discover','',0)")
      raw.exec("WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<20000) INSERT INTO common_group_relation SELECT 's','p',printf('%05d',x),'群',2,NULL FROM n")
      const checkpoint=f.db.commonGroups.read('s','p').checkpoint
      expect(()=>f.db.commonGroups.apply('s','p',checkpoint,{items:[{uid:'new',title:'群',memberCount:2}],removed:[],phase:'complete',after:''})).toThrow('容量')
      expect(f.db.commonGroups.read('s','p').total).toBe(20000)
      expect(f.db.commonGroups.read('s','p').checkpoint).toEqual(checkpoint)
    } finally {raw.close();await f.close()}
  })

})
