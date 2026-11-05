import {readFile} from 'node:fs/promises'
import {DatabaseSync} from 'node:sqlite'
import {expect,it} from 'vitest'
import {TeamCodexCloud,type TeamCodexCloudPort} from '../../src/team-codex-cloud.js'
import type {TeamCodexState} from '../../src/team-codex-contract.js'

// Explicit, short-lived TEST credentials are created by the external acceptance runner.
// No production config, desktop credential store, or existing journal is read.
const fixture=process.env.CODEX_CONTENT_REAL_TEST_FIXTURE
it.skipIf(!fixture)('reads private OSS content through the actual Host owner with two TEST accounts',async()=>{
 const f=JSON.parse(await readFile(fixture!,'utf8')) as {environment:string;sourceId:string;taskId:string;tokens:Record<string,string>;queueSourceId?:string;queueTaskId?:string}
 expect(f.environment).toBe('test')
 for(const user of [3016,3020]){
  const db=new DatabaseSync(':memory:')
  const post:TeamCodexCloudPort['post']=async(_owner,path,body,signal)=>{
   const response=await fetch('https://jotmo-team.senguo.me'+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+f.tokens[user]},body:JSON.stringify(body),signal})
   const value=await response.json() as {code:number;data:unknown};expect(response.status).toBe(200);expect(value.code).toBe(200);return value.data as never
  }
  const cloud=new TeamCodexCloud(db,{post,selectedTeam:async(localTeam:string)=>({teamRef:localTeam,jotmoId:localTeam==='queue-team'?'codex3016test':'t3016t'})} as TeamCodexCloudPort,async()=>user)
  try{
   const local:TeamCodexState={localOnly:true,self:{userRef:'test-user',displayName:'验收',role:'member',joinedAtMillis:1,identityState:'ready'},tasks:[],installations:[]}
   const state=await cloud.state(user,'test-team',local,1,'',f.sourceId);expect(state.cloud?.status).toBe('ready')
   const task=state.tasks.find(t=>t.cloud?.taskId===f.taskId);expect(task?.cloud?.remote).toBe(true)
   const page=await cloud.events(user,'test-team',f.taskId,f.sourceId)
   expect(page.items.some(e=>e.kind==='Progress'&&e.text==='正在验证 OSS 真实采集')).toBe(true)
   expect(page.items.some(e=>e.kind==='Stop'&&e.text.includes('OSS 真实采集完成'))).toBe(true)
   const images=page.items.find(e=>e.kind==='UserPromptSubmit')?.privateImages
   if(user===3016)expect(images?.[0]?.state).toBe('ready')
   else {expect(images??[]).toEqual([]);expect(page.queueCloud).toBe('private');expect(task?.queueSummary).toBeUndefined()}
   if(f.queueSourceId&&f.queueTaskId){
    const queueState=await cloud.state(user,'queue-team',local,1,'',f.queueSourceId)
    const queued=queueState.tasks.find(t=>t.cloud?.taskId===f.queueTaskId)
    const detail=await cloud.events(user,'queue-team',f.queueTaskId,f.queueSourceId)
    if(user===3016){expect(queued?.queueSummary?.count).toBe(1);expect(detail.queue?.items[0]?.text).toBe('本人排队内容隐私验证')}
    else{expect(queued?.queueSummary).toBeUndefined();expect(detail.queue).toBeUndefined();expect(detail.queueCloud).toBe('private')}
   }
  }finally{cloud.fence();db.close()}
 }
},60000)
