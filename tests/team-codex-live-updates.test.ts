import {createHash} from 'node:crypto'
import {appendFileSync,mkdirSync,mkdtempSync,readFileSync,statSync,realpathSync,rmSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {DatabaseSync} from 'node:sqlite'
import {afterEach,describe,it,expect,vi} from 'vitest'
import {TeamCodexLiveUpdates} from '../src/team-codex-live-updates.js'
import type {TeamCodexEvent} from '../src/team-codex-contract.js'
const roots:string[]=[],dbs:DatabaseSync[]=[],stores:TeamCodexLiveUpdates[]=[]
afterEach(async()=>{for(const store of stores.splice(0)){store.fence();await store.idle()}for(const db of dbs.splice(0))db.close();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true})})
const session='session_123',turn='turn_123',at=1792748662000
const line=(type:string,payload:object,time=at)=>JSON.stringify({type,timestamp:new Date(time).toISOString(),payload})+'\n'
const started=(id=turn,root=id)=>line('event_msg',{type:'task_started',turn_id:id,root_turn_id:root})
const progress=(text='已找到问题',time=at+1000,phase='commentary')=>line('response_item',{type:'message',role:'assistant',phase,status:'completed',content:[{type:'output_text',text}]},time)
const complete=(id=turn,kind='task_complete')=>line('event_msg',{type:kind,turn_id:id,root_turn_id:id,last_agent_message:'最终回答'},at+10000)
const prompt:TeamCodexEvent={sequence:1,kind:'UserPromptSubmit',turnId:turn,text:'需求',at,truncated:false}
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'codex-live-'));roots.push(root)
 const home=join(root,'codex');mkdirSync(join(home,'sessions'),{recursive:true})
 const path=join(home,'sessions','bound.jsonl');writeFileSync(path,line('session_meta',{id:session})+started())
 const index=new DatabaseSync(join(home,'state_5.sqlite'));dbs.push(index);index.exec('CREATE TABLE threads(id TEXT PRIMARY KEY,rollout_path TEXT)');index.prepare('INSERT INTO threads VALUES(?,?)').run(session,path)
 const db=new DatabaseSync(join(root,'journal.sqlite'));dbs.push(db)
 const source={sessionId:session,homeKey:createHash('sha256').update(realpathSync(home)).digest('hex'),live:true}
 const store=new TeamCodexLiveUpdates(db,home);stores.push(store)
 const callback=vi.fn();let valid=true
 const scan=async(events=[prompt])=>{store.schedule(11,source,events,()=>valid,callback);await store.idle()}
 const projected=()=>store.project(11,source,[prompt])[0]!
 return {root,home,path,db,index,source,store,callback,scan,projected,revoke:()=>{valid=false;store.fence()}}
}
describe('event-driven public Codex progress',()=>{
 it('separates public progress from completion, excludes tools/reasoning/subagents, and redacts private media',async()=>{
  const f=fixture()
  appendFileSync(f.path,progress('进度 api_key=secret-value ![图](/private/test.png)')+progress('内部推理',at+2000,'analysis')+line('response_item',{type:'function_call_output',output:'工具秘密'})+started('child',turn)+progress('子任务内部')+started()+progress('最终正文',at+9000,'final_answer'))
  await f.scan()
  expect(f.projected().localProgress).toHaveLength(1)
  expect(f.projected().localProgress![0]!.text).toContain('api_key=[REDACTED]')
  expect(JSON.stringify(f.projected())).not.toMatch(/secret-value|private\/test|内部|工具秘密|最终正文/)
  expect(f.callback).not.toHaveBeenCalled()
  appendFileSync(f.path,complete());await f.scan()
  expect(f.callback).toHaveBeenCalledWith({turnId:turn,kind:'Stop',text:'最终回答',at:at+10000,truncated:false})
 })
 it('captures append from a file notification without another poll, coalesces duplicates, and preserves Unicode partial lines',async()=>{
  const f=fixture();await f.scan()
  const text=line('response_item',{id:'public_message_1',type:'message',role:'assistant',phase:'commentary',status:'completed',content:[{type:'output_text',text:'你好 🌏'}]},at+1000),buffer=Buffer.from(text),split=buffer.indexOf(Buffer.from('🌏'))+2
  appendFileSync(f.path,buffer.subarray(0,split));await f.scan();expect(f.projected().localProgress).toBeUndefined()
  appendFileSync(f.path,buffer.subarray(split))
  await vi.waitFor(()=>expect(f.projected().localProgress).toHaveLength(1),{timeout:2500,interval:100})
  expect(f.projected().localProgress![0]!.text).toBe('你好 🌏')
  appendFileSync(f.path,text);await f.scan();expect(f.projected().localProgress).toHaveLength(1)
 })
 it('uses native identity for updates and original record positions when native identity is absent',async()=>{
  const f=fixture()
  const message=(text:string,time:number)=>line('response_item',{id:'stable_message',type:'message',role:'assistant',phase:'commentary',status:'completed',content:[{type:'output_text',text}]},time)
  appendFileSync(f.path,message('first',at+1000));await f.scan()
  const before=f.projected().localProgress![0]!
  appendFileSync(f.path,message('updated',at+2000));await f.scan()
  expect(f.projected().localProgress).toHaveLength(1)
  expect(f.projected().localProgress![0]).toMatchObject({id:before.id,sourceSequence:before.sourceSequence,at:before.at,text:'updated'})
  appendFileSync(f.path,progress('相同文字',at+3000)+progress('相同文字',at+3000));await f.scan()
  const equal=f.projected().localProgress!.filter(p=>p.text==='相同文字')
  expect(equal).toHaveLength(2);expect(equal[0]!.id).not.toBe(equal[1]!.id)
  expect(equal[0]!.sourceSequence).toBeLessThan(equal[1]!.sourceSequence!)
 })
 it('persists cursor and progress across reopen, scopes account and cloud turn mapping, and replays a missed terminal',async()=>{
  const f=fixture();appendFileSync(f.path,progress()+complete());await f.scan();f.store.fence()
  const before=readFileSync(f.path),store=new TeamCodexLiveUpdates(f.db,f.home);stores.push(store)
  const done=vi.fn();store.schedule(11,f.source,[prompt],()=>true,done);await store.idle()
  expect(done).toHaveBeenCalledTimes(1);expect(readFileSync(f.path)).toEqual(before)
  expect(store.project(22,f.source,[prompt])[0]!.localProgress).toBeUndefined()
  const cloud={...f.source,turns:new Map([['cloud_hash',turn]])}
  expect(store.project(11,cloud,[{...prompt,turnId:'cloud_hash'}])[0]!.localProgress).toHaveLength(1)
  expect(store.project(11,cloud,[{...prompt,turnId:'wrong_hash'}])[0]!.localProgress).toBeUndefined()
 })
 it('rechecks the just-authorized turn when its prompt Hook arrives after native progress',async()=>{
  const f=fixture();appendFileSync(f.path,complete()+started('next_turn')+progress('第二问的进度',at+12000))
  await f.scan()
  const next={...prompt,sequence:2,turnId:'next_turn',at:at+11000}
  await f.scan([prompt,next])
  expect(f.store.project(11,f.source,[next])[0]?.localProgress?.map(p=>p.text)).toEqual(['第二问的进度'])
 })
 it('does not infer completion from prose, preserves interruption, and never imports unregistered turns',async()=>{
  const f=fixture();appendFileSync(f.path,progress('已完成')+complete(turn,'turn_aborted')+started('other')+progress('无关对话')+complete('other'))
  await f.scan();expect(f.callback).toHaveBeenCalledExactlyOnceWith({turnId:turn,kind:'Interrupt',text:'',at:at+10000,truncated:false})
  expect(f.projected().localProgress?.map(p=>p.text)).toEqual(['已完成'])
 })
 it('cancels pending reads/watchers on account fence and rejects mismatched source metadata',async()=>{
  const f=fixture();appendFileSync(f.path,progress()+complete());f.store.schedule(11,f.source,[prompt],()=>true,f.callback);f.store.fence();await f.store.idle()
  expect(f.callback).not.toHaveBeenCalled();expect(f.projected().localProgress).toBeUndefined()
  writeFileSync(f.path,line('session_meta',{id:'other'})+started()+progress());await f.scan();expect(f.projected().localProgress).toBeUndefined()
 })
 it('starts near the tail of a long old transcript instead of indexing its full prefix',async()=>{
  const f=fixture();writeFileSync(f.path,line('session_meta',{id:session})+started('old')+line('response_item',{type:'function_call_output',output:'x'.repeat(12*1024*1024)})+started()+progress())
  await f.scan()
  expect(f.projected().localProgress?.[0]?.text).toBe('已找到问题')
  expect(f.db.prepare('SELECT start FROM codex_live_spans WHERE turn=?').get(turn)?.start).toBeGreaterThan(12*1024*1024)
  expect(f.db.prepare('SELECT 1 FROM codex_live_spans WHERE turn=?').get('old')).toBeUndefined()
 })
 it('skips oversized tool/image lines with a bounded cursor and resumes at the next valid message',async()=>{
  const f=fixture();appendFileSync(f.path,line('response_item',{type:'function_call_output',output:'x'.repeat(6*1024*1024)})+progress())
  for(let i=0;i<6&&!f.projected().localProgress;i++)await f.scan()
  expect(f.projected().localProgress?.[0]?.text).toBe('已找到问题')
  const cursor=f.db.prepare('SELECT offset FROM codex_live_cursors').get()!
  await f.scan();expect(f.db.prepare('SELECT offset FROM codex_live_cursors').get()).toEqual(cursor)
 })
})

it('keeps previously collected facts if a future source version removes the recognized local index',async()=>{
 const f=fixture();appendFileSync(f.path,progress('已采集的旧正文'));await f.scan()
 expect(f.projected().localProgress?.[0]?.text).toBe('已采集的旧正文')
 f.index.close();dbs.splice(dbs.indexOf(f.index),1);rmSync(join(f.home,'state_5.sqlite'));await f.scan()
 expect(f.projected().localProgress?.[0]?.text).toBe('已采集的旧正文')
 expect(f.callback).not.toHaveBeenCalled()
})

it('does not reinterpret unknown upstream records/channels as replies and resumes on recognized records',async()=>{
 const f=fixture();appendFileSync(f.path,line('future_native_record',{type:'message',text:'不公开的未来字段'})+progress('未来私有频道',at+1000,'future_private')+progress('仍可识别的公开回复',at+2000))
 await f.scan();expect(f.projected().localProgress?.map(p=>p.text)).toEqual(['仍可识别的公开回复'])
})

it('collects steering inputs in source order without duplicating the root Hook, including a large image input',async()=>{
 const f=fixture()
 const input=(id:string,text:string,image=false)=>line('response_item',{id,type:'message',role:'user',content:[{type:'input_text',text},...(image?[{type:'input_image',image_url:'data:image/png;base64,'+'A'.repeat(5*1024*1024)}]:[])]})
 appendFileSync(f.path,input('root_input','初始输入',true)+progress('开始处理')+input('steering_one','追加说明一')+started()+input('steering_two','追加说明二')+input('root_input','初始输入',true))
 const stat=statSync(f.path),nativeScope=JSON.stringify([11,session])
 f.db.exec('CREATE TABLE codex_image_spans(scope TEXT,turn TEXT,start INTEGER,end INTEGER);CREATE TABLE codex_image_cursors(scope TEXT,identity TEXT)')
 f.db.prepare('INSERT INTO codex_image_spans VALUES(?,?,?,?)').run(nativeScope,turn,Buffer.byteLength(line('session_meta',{id:session})),stat.size)
 f.db.prepare('INSERT INTO codex_image_cursors VALUES(?,?)').run(nativeScope,`${stat.dev}:${stat.ino}`)
 await f.scan();expect(Number(f.db.prepare('SELECT offset FROM codex_live_cursors').get()!.offset)).toBeLessThan(stat.size)
 for(let i=0;i<8;i++){await f.scan();if(f.db.prepare("SELECT 1 FROM codex_live_messages WHERE kind='input'").get())break}
 const inputs=f.db.prepare("SELECT * FROM codex_live_messages WHERE kind='input' ORDER BY source_order").all()
 expect(inputs.map(r=>r.text)).toEqual(['追加说明一','追加说明二'])
 expect(inputs[0]!.source_order).toBeGreaterThan(5*1024*1024)
 expect(inputs[1]!.source_order).toBeGreaterThan(Number(inputs[0]!.source_order))
 expect(f.projected().localProgress?.map(p=>p.text)).toEqual(['开始处理'])
 await f.scan();expect(f.db.prepare("SELECT count(*) n FROM codex_live_messages WHERE kind='input'").get()!.n).toBe(2)
 expect(JSON.stringify(inputs)).not.toMatch(/base64|初始输入/)
})

it('keeps consumed facts and reads only the append when a verified source has no recognized root input',async()=>{
 const f=fixture();appendFileSync(f.path,progress('旧版公开正文'))
 const scope=JSON.stringify([11,session]),stat=statSync(f.path)
 f.db.exec('CREATE TABLE codex_image_spans(scope TEXT,turn TEXT,start INTEGER,end INTEGER);CREATE TABLE codex_image_cursors(scope TEXT,identity TEXT)')
 f.db.prepare('INSERT INTO codex_image_spans VALUES(?,?,?,?)').run(scope,turn,Buffer.byteLength(line('session_meta',{id:session})),stat.size)
 f.db.prepare('INSERT INTO codex_image_cursors VALUES(?,?)').run(scope,`${stat.dev}:${stat.ino}`)
 await f.scan();expect(f.projected().localProgress?.map(p=>p.text)).toEqual(['旧版公开正文'])
 // A future source rewrites consumed fields in place; previously collected history must survive.
 writeFileSync(f.path,readFileSync(f.path,'utf8').replace('旧版公开正文','新版其他正文'))
 appendFileSync(f.path,progress('新的公开回复',at+2000))
 await f.scan();expect(f.projected().localProgress?.map(p=>p.text)).toEqual(['旧版公开正文','新的公开回复'])
})
