import {DatabaseSync} from 'node:sqlite'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {expect,it,vi} from 'vitest'
import {localCodexTaskPage,localCodexTaskBatch} from '../src/team-codex-local-tasks.js'
import {TeamCodexService} from '../src/team-codex-service.js'
import {TeamCodexCloudJournal} from '../src/team-codex-cloud-journal.js'
import type {ArkmeUserProfileSnapshot} from '../src/types.js'

it('reads 100000 local task summaries by keyset without serializing or aggregating the entire history',async()=>{
 const root=mkdtempSync(join(tmpdir(),'codex-task-pages-'))
 const service=new TeamCodexService({directory:root,currentUserId:async()=>11,profile:async()=>({profile:{userId:11}} as ArkmeUserProfileSnapshot),teams:{listMembers:async()=>{throw Error('personal history must not require team membership')}}})
 const db=new DatabaseSync(join(root,'journal.sqlite'))
 try{
  const member={userRef:'11',displayName:'本人',role:'member',identityState:'ready',joinedAtMillis:1}
  db.prepare('INSERT INTO codex_installations VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('installation',11,'team',JSON.stringify(member),'source',null,'paused','generation',1,2,3)
  const task=db.prepare('INSERT INTO codex_tasks VALUES(?,?,?,?,?,?,?,?,?,?,?,?)'),visible=db.prepare('INSERT INTO codex_session_visibility VALUES(?,?,?)')
  db.exec('BEGIN')
  for(let i=0;i<100000;i++){const id=String(i).padStart(8,'0');task.run(id,'installation',id,id,'project','','','','',0,0,100000-Math.floor(i/2));visible.run('installation',id,'user')}
  db.exec('COMMIT')
  const prepare=db.prepare.bind(db),queries:string[]=[]
  const observe=vi.spyOn(db,'prepare').mockImplementation(sql=>{if(sql.startsWith('WITH local AS'))queries.push(sql);return prepare(sql)})
  const started=performance.now(),first=localCodexTaskPage(db,11,'self')
  expect(first.rows).toHaveLength(50);expect(first.rows[0]!.id).toBe('00000000');expect(first.paging.hasMore).toBe(true)
  const second=localCodexTaskPage(db,11,'self',{cursor:first.paging.nextCursor})
  expect(second.rows[0]!.id).toBe('00000050')
  expect(localCodexTaskPage(db,11,'self',{after:second.paging.previousCursor}).rows).toEqual(first.rows)
  expect(localCodexTaskPage(db,11,'self',{from:second.paging.firstCursor}).rows).toEqual(second.rows)
  expect(()=>localCodexTaskPage(db,22,'self',{cursor:first.paging.nextCursor})).toThrow('本机列表位置无效')
  expect(localCodexTaskPage(db,22,'self').rows).toEqual([])
  const state=await service.state('self')
  expect(state.tasks).toHaveLength(50);expect(state.localTaskPage?.hasMore).toBe(true);expect(JSON.stringify(state).length).toBeLessThan(100000)
  const next=await service.state('self',2,'','','',{cursor:state.localTaskPage!.nextCursor})
  expect(next.tasks[0]!.id).toBe('00000050')
  const batch=localCodexTaskBatch(db,11,'self','00099990')
  expect(batch.ids.length).toBeLessThanOrEqual(8);expect(batch.ids).toContain('00099991')
  observe.mockRestore()
  const plans=queries.slice(0,2).map((sql,i)=>prepare('EXPLAIN QUERY PLAN '+sql).all(11,'self','self',11,'self','self',...(i?[first.rows.at(-1)!.updated_at,first.rows.at(-1)!.updated_at,first.rows.at(-1)!.id]:[])))
  expect(plans.flat().some(row=>String(row.detail).includes('TEMP B-TREE'))).toBe(false)
  expect(plans[1]!.some(row=>String(row.detail).includes('codex_task_activity (updated_at<?)'))).toBe(true)
  console.info('localTaskPlans='+JSON.stringify(plans))
  console.info('localTaskScale='+JSON.stringify({tasks:100000,page:state.tasks.length,wireBytes:JSON.stringify(state).length,elapsedMs:performance.now()-started}))
 }finally{db.close();service.close();rmSync(root,{recursive:true,force:true})}
},30000)

it('commits a cold-history checkpoint with its ingested facts and rolls both back on failure',()=>{
 const db=new DatabaseSync(':memory:')
 try{
  const journal=new TeamCodexCloudJournal(db),task={id:'local',title:'task',status:'active' as const,state:'waiting' as const,updatedAt:1,eventCount:1,member:{userRef:'11',displayName:'本人',role:'member' as const,identityState:'ready' as const,joinedAtMillis:1}}
  const event={sequence:1,turnId:'turn',kind:'UserPromptSubmit' as const,text:'fact',at:1,truncated:false}
  journal.reconcile(11,'team','9',[task],()=>{journal.saveLocalReadCursor(11,'team',task.id,'checkpoint-1');return [event]})
  expect(new TeamCodexCloudJournal(db).localReadCursor(11,'team',task.id)).toBe('checkpoint-1')
  expect(()=>journal.reconcile(11,'team','9',[task],()=>{journal.saveLocalReadCursor(11,'team',task.id,'checkpoint-2');throw Error('cancelled ingestion')})).toThrow('cancelled ingestion')
  expect(journal.localReadCursor(11,'team',task.id)).toBe('checkpoint-1')
  expect(db.prepare('SELECT count(*) n FROM codex_cloud_events').get()!.n).toBe(1)
 }finally{db.close()}
})
