import {DatabaseSync} from 'node:sqlite'
import {afterEach,expect,it,vi} from 'vitest'
import {TeamCodexCloudJournal,type CloudBatch} from '../src/team-codex-cloud-journal.js'
import {TeamCodexPrivateImages} from '../src/team-codex-private-images.js'
import {TeamCodexImageCloud} from '../src/team-codex-image-cloud.js'
import type {TeamCodexTask} from '../src/team-codex-contract.js'
import type {TeamCodexCloudPort} from '../src/team-codex-cloud.js'
const databases:DatabaseSync[]=[]
afterEach(()=>{for(const db of databases.splice(0))db.close()})
function fixture(count=1){
 const db=new DatabaseSync(':memory:');databases.push(db)
 db.exec(`CREATE TABLE codex_tasks(id TEXT PRIMARY KEY,installation_id TEXT,session_id TEXT,excluded INTEGER,deleted INTEGER);
 CREATE TABLE codex_installations(id TEXT PRIMARY KEY,user_id INTEGER,team_ref TEXT,status TEXT);
 CREATE TABLE connections(id TEXT,user_id INTEGER,team_ref TEXT,session_id TEXT,status TEXT);
 INSERT INTO codex_installations VALUES('install',11,'team','active');`)
 const journal=new TeamCodexCloudJournal(db);new TeamCodexPrivateImages(db)
 const tasks:TeamCodexTask[]=Array.from({length:count},(_,i)=>({id:'task'+i,installationId:'install',title:'Task',status:'active',state:'finished',updatedAt:1,eventCount:1,member:{userRef:'11',displayName:'me',role:'member',joinedAtMillis:1}}))
 for(const task of tasks) db.prepare('INSERT INTO codex_tasks VALUES(?,?,?,0,0)').run(task.id,'install',task.id)
 journal.reconcile(11,'team','101',tasks,()=>[{turnId:'turn',kind:'Stop',text:'answer',sequence:1,at:1,truncated:false}])
 const eligible=new Set(tasks.map(t=>t.id))
 let batch:CloudBatch|undefined
 while((batch=journal.batch(11,'team',eligible))){journal.acknowledge(batch,{owner_ref:'11',task_results:batch.tasks.map(t=>({task_id:t.task_id,status:'saved',version:t.version})),event_results:batch.tasks.flatMap(t=>t.events.map(e=>({event_id:e.event_id,task_id:t.task_id,status:'saved',version:e.version})))})}
 for(const task of tasks)db.prepare('INSERT INTO codex_private_images VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(11,task.id,'turn','Stop',0,'image-'+task.id,'hash-'+task.id,1,1,Buffer.from([1,2]),Buffer.from([3]))
 const post=vi.fn(async(_owner:number,_path:string,body:Record<string,unknown>)=>({version:1,items:(body.images as {client_image_id:string}[]).map((im,i)=>({image_id:'server'+i,client_image_id:im.client_image_id,state:(im as {state?:string}).state??'pending'}))}))
 const bytes=vi.fn(async()=>({}))
 const port={post,bytes} as unknown as TeamCodexCloudPort
 return {db,eligible,post,bytes,restart:()=>new TeamCodexImageCloud(db,port),sync:(worker:TeamCodexImageCloud,owner=11)=>worker.sync(owner,'team',eligible,new AbortController().signal)}
}
it('resumes the accepted manifest after a lost upload receipt and restart without preparing a new version',async()=>{
 const f=fixture(),worker=f.restart()
 f.bytes.mockRejectedValueOnce(Error('lost response'))
 await f.sync(worker);expect(f.post).toHaveBeenCalledTimes(1)
 expect(JSON.parse(String(f.db.prepare('SELECT image_receipt FROM codex_cloud_events').get()!.image_receipt))).toMatchObject({complete:false})
 await f.sync(f.restart());expect(f.post).toHaveBeenCalledTimes(1);expect(f.bytes).toHaveBeenCalledTimes(3)
 await f.sync(worker);expect(f.bytes).toHaveBeenCalledTimes(3)
})
it('does not read another account or disguise an unavailable image as the previous ready image',async()=>{
 const f=fixture(),worker=f.restart();await f.sync(worker,22);expect(f.post).not.toHaveBeenCalled()
 await f.sync(worker);expect(f.post).toHaveBeenCalledTimes(1)
 f.db.exec('UPDATE codex_private_images SET image=NULL,thumbnail=NULL')
 await f.sync(worker);expect(f.post).toHaveBeenCalledTimes(2)
 expect(f.post.mock.calls.at(-1)?.[2]).toMatchObject({images:[{state:'unavailable',client_image_id:'image-task0'}]})
 expect(f.bytes).toHaveBeenCalledTimes(2)
})
it('advances beyond both hot-task and per-tick budgets and clears an actually removed attachment',async()=>{
 const f=fixture(43),worker=f.restart()
 for(let i=0;i<14;i++)await f.sync(worker)
 expect(f.post).toHaveBeenCalledTimes(43)
 for(let i=0;i<14;i++)await f.sync(worker)
 expect(f.post).toHaveBeenCalledTimes(43)
 f.db.exec("DELETE FROM codex_private_images WHERE session='task0'")
 for(let i=0;i<3;i++)await f.sync(worker)
 expect(f.post).toHaveBeenCalledTimes(44)
 expect(f.post.mock.calls.at(-1)?.[2]).toMatchObject({images:[],base_revision:1})
})
