import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { SelfRoleSyncStore } from '../src/self-role-sync-store.js'
let sql: DatabaseSync, store: SelfRoleSyncStore
beforeEach(()=>{
  sql=new DatabaseSync(':memory:')
  // Existing pre-sync installation: no cloud_ack/recovery columns yet.
  sql.exec(`CREATE TABLE self_role(user_id INTEGER,role_id TEXT,name TEXT,avatar_ref TEXT,created_at_millis INTEGER,updated_at_millis INTEGER,PRIMARY KEY(user_id,role_id));
    CREATE TABLE self_role_record(user_id INTEGER,record_uid TEXT,role_id TEXT,role_name TEXT,avatar_ref TEXT,bound_at_millis INTEGER,PRIMARY KEY(user_id,record_uid));
    INSERT INTO self_role VALUES(7,'role','frozen',NULL,1,1);
    INSERT INTO self_role_record VALUES(7,'old','role','frozen',NULL,1)`)
  store=new SelfRoleSyncStore(sql,work=>work())
})
afterEach(()=>sql.close())
it('migrates old bindings idempotently without losing their frozen snapshot',()=>{
  new SelfRoleSyncStore(sql,work=>work())
  expect(store.dueBindings(7,0)).toEqual(['old'])
  expect(store.claimBinding(7,'old',1,true)).toMatchObject({recordUid:'old',snapshot:{roleId:'role',name:'frozen'},failures:0,status:0,version:0})
})
it('uses a bounded index range with many acknowledged, suspended and purged historical bindings',()=>{
  const insert=sql.prepare('INSERT INTO self_role_record(user_id,record_uid,role_id,role_name,bound_at_millis,cloud_ack,fill_due_at,fill_status) VALUES(?,?,?,?,?,?,?,?)')
  sql.exec('BEGIN')
  for(let i=0;i<20_000;i++){
    insert.run(7,`acked-${i}`,'role','frozen',1,1,0,0)
    insert.run(7,`paused-${i}`,'role','frozen',1,0,100_000,2)
    insert.run(7,`purged-${i}`,'role','frozen',1,0,0,4)
  }
  insert.run(7,'due-b','role','frozen',1,0,2,0);insert.run(7,'due-c','role','frozen',1,0,3,0)
  sql.exec('COMMIT')
  const plan=sql.prepare('EXPLAIN QUERY PLAN SELECT record_uid FROM self_role_record WHERE user_id=? AND cloud_ack=0 AND fill_status<>4 AND fill_due_at<=? ORDER BY fill_due_at,record_uid LIMIT 100').all(7,10) as Array<{detail:string}>
  const details=plan.map(row=>row.detail)
  expect(details.some(text=>text.includes('SEARCH self_role_record USING INDEX self_role_fill_due')&&text.includes('user_id=? AND fill_due_at<?'))).toBe(true)
  expect(details.some(text=>/SCAN|TEMP B-TREE/.test(text))).toBe(false)
  expect(store.dueBindings(7,10)).toEqual(['old','due-b','due-c'])
  console.info('SELF_ROLE_DUE_QUERY_PLAN',JSON.stringify({historical:60000,due:3,details}))
})
it('uses token CAS across retries, rebinds and stable-avatar storage conversion',()=>{
  sql.prepare("UPDATE self_role_record SET avatar_ref='local-avatar' WHERE record_uid='old'").run()
  const first=store.claimBinding(7,'old',1)!
  store.saveAsset(7,'local-avatar','asset')
  expect(store.ownsBinding(7,first)).toBe(true)
  expect(store.pendingBindings(7)[0]?.snapshot.avatarRef).toBe('file_asset://asset')
  const second=store.claimBinding(7,'old',2)!
  expect(second.token).toBe(first.token)
  expect(store.ownsBinding(7,second)).toBe(true)
  expect(sql.prepare("SELECT fill_status FROM self_role_record WHERE record_uid='old'").get()).toEqual({fill_status:0})
  sql.prepare("DELETE FROM self_role_record WHERE record_uid='old'").run()
  sql.prepare("INSERT INTO self_role_record(user_id,record_uid,role_id,role_name,bound_at_millis) VALUES(7,'old','role','frozen',1)").run()
  store.acknowledgeBinding(7,'old',second.token);store.deferBinding(7,second,3,4,10)
  expect(store.dueBindings(7,3)).toEqual(['old'])
})
it('caps ordinary retry delay at thirty minutes and never drops or acknowledges the binding',()=>{
  let now=1
  const delays:number[]=[]
  for(let i=0;i<12;i++){
    const attempt=store.claimBinding(7,'old',now,true)!
    expect(attempt).toBeDefined();store.deferBinding(7,attempt,now)
    const row=sql.prepare("SELECT fill_due_at,cloud_ack FROM self_role_record WHERE record_uid='old'").get() as {fill_due_at:number;cloud_ack:number}
    expect(row.cloud_ack).toBe(0);delays.push(row.fill_due_at-now);now=row.fill_due_at
  }
  expect(delays.slice(0,6)).toEqual([60_000,120_000,240_000,480_000,960_000,1_800_000])
  expect(delays.slice(6)).toEqual(Array(6).fill(1_800_000));expect(store.pendingBindings(7)).toHaveLength(1)
})
