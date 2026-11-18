import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {DatabaseSync} from 'node:sqlite'
import {expect,it} from 'vitest'
import {ArkmeLocalDatabase} from '../src/local-database.js'
import {ArkmeStateStore} from '../src/state-store.js'
import {ArkmeService} from '../src/arkme-service.js'
import {dispatchArkmeHostOperation} from '../src/host-api.js'

it('preserves historical SQLite corrections across reopening and scope isolation while rejecting all former local Host write/read operations',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'arkme historical transcript '));let db=new ArkmeLocalDatabase(directory,new ArkmeStateStore(directory));
 const payload={revision:2,original:'原词，原词。',text:'原词，新词。',marks:[]};
 try{
  const fixture=new DatabaseSync(join(directory,'records.sqlite3'));
  fixture.prepare('INSERT INTO local_transcript_edits(account_key,scope,item_id,payload) VALUES (?,?,?,?)').run('prod:11','recording:123','one',JSON.stringify(payload));fixture.close();
  const service=Object.assign(Object.create(ArkmeService.prototype),{config:{environment:'prod'},stateStore:db,runtime:{requireSession:async()=>({userId:11})}}) as ArkmeService;
  for(const operation of ['transcript.local.change','transcript.local.read'])await expect(dispatchArkmeHostOperation(service,operation,{accountKey:'prod:11',scope:'recording:123',ids:['one'],change:{id:'one',text:'不可双写'}})).rejects.toMatchObject({code:'operation-unknown'});
  db.close();db=new ArkmeLocalDatabase(directory,new ArkmeStateStore(directory));expect((await db.localTranscriptEntries('prod:11','recording:123',['one'])).one).toEqual(payload);
  for(const [account,scope] of [['prod:12','recording:123'],['test:11','recording:123'],['prod:11','call:123']])expect(await db.localTranscriptEntries(account!,scope!,['one'])).toEqual({});
 }finally{db.close();await rm(directory,{recursive:true,force:true})}
})
