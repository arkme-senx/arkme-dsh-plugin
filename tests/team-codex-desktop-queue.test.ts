import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { TeamCodexDesktopQueueReader } from '../src/team-codex-desktop-queue.js'

const roots:string[]=[]
const databases:DatabaseSync[]=[]
afterEach(()=>{for(const db of databases.splice(0))db.close();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true})})
function fixture() {
  const root=mkdtempSync(join(tmpdir(),'arkme-queue-'));roots.push(root)
  const home=join(root,'codex');mkdirSync(home)
  const path=join(home,'.codex-global-state.json'), now=Date.now()
  const key=createHash('sha256').update(realpathSync(home)).digest('hex')
  const reader=new TeamCodexDesktopQueueReader(home)
  const write=(queues:unknown)=>writeFileSync(path,JSON.stringify({'queued-follow-ups':queues,unrelated:'private-data-not-collected'}))
  const item=(id='queue-one',overrides:Record<string,unknown>={})=>({id,text:`request-${id}`,createdAt:now-100,...overrides})
  const server=()=>{
    const db=new DatabaseSync(join(home,'queue_1.sqlite'));databases.push(db)
    db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE queued_items (
      id TEXT PRIMARY KEY, thread_id TEXT NOT NULL,payload_json TEXT NOT NULL,
      queue_order INTEGER NOT NULL,created_at_ms INTEGER NOT NULL,updated_at_ms INTEGER NOT NULL)`)
    const insert=(id:string,order:number,text:string,clientId=id,thread='thread-one')=>db.prepare('INSERT INTO queued_items VALUES(?,?,?,?,?,?)')
      .run(id,thread,JSON.stringify({UserInput:{content:[{type:'text',text,text_elements:[]}],client_id:clientId}}),order,now-100,now-50)
    return {db,insert}
  }
  return {root,home,path,now,key,reader,write,item,server,read:()=>reader.read(key,['thread-one','thread-empty'],Date.now())}
}

describe('read-only Codex desktop queue adapter',()=>{
  it('reads the real app-server schema from WAL even when the legacy queue is empty',()=>{
    const f=fixture();f.write({});const s=f.server()
    s.insert('second',8,'截图里的后续请求');s.insert('first',7,'更早执行的请求')
    s.insert('unbound',0,'不应读取的对话','unbound','other-thread')
    const path=join(f.home,'queue_1.sqlite'),before=readFileSync(path),wal=readFileSync(path+'-wal')
    expect(f.read().get('thread-one')).toMatchObject({availability:'ready',reason:'none',items:[
      {id:'first',text:'更早执行的请求',state:'queued'},{id:'second',text:'截图里的后续请求',delivery:'queue'},
    ]})
    expect(f.read().get('thread-empty')).toMatchObject({availability:'ready',items:[]})
    expect(JSON.stringify([...f.read()])).not.toContain('不应读取的对话')
    expect(readFileSync(path)).toEqual(before);expect(readFileSync(path+'-wal')).toEqual(wal)
    expect(s.db.prepare('SELECT COUNT(*) AS n FROM queued_items').get()?.n).toBe(3)
  })
  it('merges server order with local pending requests using IDs, not matching text',()=>{
    const f=fixture(),s=f.server();s.insert('server-id',0,'同文','local-id')
    f.write({'thread-one':[f.item('local-id',{text:'旧内容'}),f.item('server-id'),f.item('distinct',{text:'同文'}),
      f.item('pending',{submission:{status:'sending'}})]})
    const result=f.read().get('thread-one')!
    expect(result.availability).toBe('ready')
    expect(result.items.map(i=>i.id)).toEqual(['server-id','distinct','pending'])
    expect(result.items[0]?.text).toBe('同文');expect(result.items[2]?.state).toBe('sending')
    expect(result).not.toHaveProperty('clientIds')
  })
  it('supports modern-only installations and observes edits, reordering and removals without a hook',()=>{
    const f=fixture(),s=f.server();s.insert('first',0,'原内容');s.insert('second',1,'第二条')
    expect(f.read().get('thread-one')?.items.map(i=>i.id)).toEqual(['first','second'])
    s.db.prepare('UPDATE queued_items SET queue_order=?,payload_json=? WHERE id=?').run(2,
      JSON.stringify({UserInput:{content:[{type:'text',text:'已修改'}],client_id:'first'}}),'first')
    expect(f.read().get('thread-one')?.items.map(i=>[i.id,i.text])).toEqual([['second','第二条'],['first','已修改']])
    s.db.prepare('DELETE FROM queued_items WHERE id=?').run('second')
    expect(f.read().get('thread-one')?.items.map(i=>i.id)).toEqual(['first'])
    s.db.exec('DELETE FROM queued_items')
    expect(f.read().get('thread-one')).toMatchObject({availability:'ready',items:[]})
  })
  it('does not call an unreadable, replaced or disappeared server database an empty queue',()=>{
    const f=fixture();f.write({});const path=join(f.home,'queue_1.sqlite')
    writeFileSync(path,'not sqlite')
    expect(f.read().get('thread-one')?.availability).toBe('unavailable')
    rmSync(path)
    expect(f.read().get('thread-one')?.availability).toBe('unavailable')
    f.write({'thread-one':[f.item()]})
    expect(f.read().get('thread-one')).toMatchObject({availability:'partial',items:[{id:'queue-one'}]})
  })
  it('marks incomplete payloads and broken legacy sources instead of claiming complete counts',()=>{
    const f=fixture(),s=f.server();s.insert('good',0,'正文')
    s.db.prepare('INSERT INTO queued_items VALUES(?,?,?,?,?,?)').run('future','thread-one','{"FutureQueueKind":{}}',1,f.now,f.now)
    expect(f.read().get('thread-one')).toMatchObject({availability:'partial',items:[{id:'good'}]})
    s.db.prepare('DELETE FROM queued_items WHERE id=?').run('future');f.write(undefined)
    expect(f.read().get('thread-one')?.availability).toBe('partial')
    s.db.exec('DELETE FROM queued_items')
    expect(f.read().get('thread-one')?.availability).toBe('unavailable')
  })
  it('rejects server/sidecar symlinks, unsupported schemas and unfinished WAL setup',()=>{
    const f=fixture();f.write({});const path=join(f.home,'queue_1.sqlite'),target=join(f.root,'external')
    writeFileSync(target,'never open this');symlinkSync(target,path)
    expect(f.read().get('thread-one')?.availability).toBe('unavailable');rmSync(path)
    const db=new DatabaseSync(path);db.exec('CREATE TABLE unknown (id TEXT)');db.close()
    expect(f.read().get('thread-one')?.availability).toBe('unavailable')
    symlinkSync(target,path+'-wal');expect(f.read().get('thread-one')?.availability).toBe('unavailable');rmSync(path+'-wal')
    writeFileSync(path+'-wal','');expect(f.read().get('thread-one')?.availability).toBe('unavailable')
  })
  it('limits modern payloads and counts attachments without copying attachment or extra metadata',()=>{
    const f=fixture(),s=f.server()
    s.db.prepare('INSERT INTO queued_items VALUES(?,?,?,?,?,?)').run('media','thread-one',JSON.stringify({UserInput:{
      content:[{type:'text',text:'api_key=secret '+ 'x'.repeat(4500)},
        {type:'localImage',path:'/private/image'},{type:'mention',path:'/private/file',name:'secret-name'}],
      client_id:'client-media',extraContext:'sensitive metadata'},other:'not allowed'}),0,f.now,f.now)
    const item=f.read().get('thread-one')!.items[0]!
    expect(item).toMatchObject({attachmentCount:2,truncated:true});expect(item.text).toHaveLength(4096)
    expect(JSON.stringify(item)).not.toMatch(/private|secret-name|sensitive metadata|not allowed|api_key=secret/)
    s.insert('huge',1,'x'.repeat(262145))
    expect(f.read().get('thread-one')).toMatchObject({availability:'partial',items:[{id:'media'}]})
  })
  it('bounds merged and server counts and never includes an unrelated thread',()=>{
    const f=fixture(),s=f.server()
    for(let i=0;i<202;i++)s.insert(`item-${i}`,i,'请求')
    expect(f.read().get('thread-one')?.availability).toBe('partial')
    expect(f.read().get('thread-one')?.items).toHaveLength(200)
    s.db.exec('DELETE FROM queued_items WHERE queue_order>=199')
    f.write({'thread-one':[f.item('local-one'),f.item('local-two')]})
    expect(f.read().get('thread-one')?.availability).toBe('partial')
    expect(f.read().get('thread-one')?.items).toHaveLength(200)
  })
  it('keeps order, stable IDs, text and attachment counts without copying context or unrelated sessions',()=>{
    const f=fixture();f.write({'thread-one':[f.item('second',{context:{fileAttachments:[{path:'/private/file'}],prompt:'hidden-context'}}),f.item('first')],other:[f.item('secret')]})
    const original=readFileSync(f.path,'utf8'), result=f.read()
    expect(result.get('thread-one')).toMatchObject({availability:'ready',items:[{id:'second',attachmentCount:1},{id:'first',attachmentCount:0}]})
    expect(result.get('thread-empty')).toMatchObject({availability:'ready',items:[]})
    expect(JSON.stringify([...result])).not.toMatch(/private-data|private\/file|hidden-context|secret/)
    expect(readFileSync(f.path,'utf8')).toBe(original)
  })
  it('does not interpret an old but successfully read file as an empty or stale queue',()=>{
    const f=fixture();f.write({'thread-one':[f.item()]});utimesSync(f.path,new Date(0),new Date(0))
    expect(f.read().get('thread-one')).toMatchObject({availability:'ready',items:[{id:'queue-one'}]})
  })
  it('distinguishes queued, send-now, sending, paused and uncertain requests',()=>{
    const f=fixture();f.write({'thread-one':[
      f.item('pending',{submission:{hostId:'local',status:'pending'}}),
      f.item('send',{submissionIntent:'send-now',submission:{status:'sending'}}),
      f.item('uncertain',{submission:{status:'outcome-unknown'}}),f.item('paused',{pausedReason:'user-interrupt'}),
    ]})
    expect(f.read().get('thread-one')?.items.map(i=>[i.delivery,i.state,i.paused])).toEqual([
      ['queue','pending',false],['send-now','sending',false],['queue','unknown',false],['queue','queued',true],
    ])
  })
  it.each([undefined,[],null,{'thread-one':'changed-shape'}])('reports unavailable rather than an empty queue for unsupported source %j',queues=>{
    const f=fixture();f.write(queues)
    expect(f.read().get('thread-one')?.availability).toBe('unavailable')
  })
  it('rejects unknown intent, malformed items, duplicates, remote hosts and marks incomplete snapshots',()=>{
    const f=fixture();f.write({'thread-one':[f.item(),f.item(),f.item('future',{submissionIntent:'future'}),
      f.item('remote',{submissionOptions:{executionHostId:'remote-host'}}),f.item('bad',{createdAt:'yesterday'}),null]})
    expect(f.read().get('thread-one')).toMatchObject({availability:'partial',items:[{id:'queue-one'}]})
  })
  it('bounds item and text sizes and redacts common credentials',()=>{
    const f=fixture();f.write({'thread-one':Array.from({length:205},(_,i)=>f.item(`item-${i}`,{text:'password=secret Bearer token '+ 'x'.repeat(5000)}))})
    const result=f.read().get('thread-one')!
    expect(result.availability).toBe('partial');expect(result.items).toHaveLength(200)
    expect(result.items[0]?.text).toHaveLength(4096);expect(result.items[0]?.truncated).toBe(true)
    expect(result.items[0]?.text).toContain('password=[REDACTED] Bearer [REDACTED]')
  })
  it('fails closed for wrong home, missing/corrupt/oversized file and symlinks',()=>{
    const f=fixture()
    expect(f.read().get('thread-one')?.availability).toBe('unavailable')
    writeFileSync(f.path,'{');expect(f.read().get('thread-one')?.availability).toBe('unavailable')
    writeFileSync(f.path,'x'.repeat(8*1024*1024+1));expect(f.read().get('thread-one')?.availability).toBe('unavailable')
    f.write({'thread-one':[f.item()]})
    expect(f.reader.read('wrong',['thread-one'],f.now).get('thread-one')?.reason).toBe('wrong-home')
    rmSync(f.path);const source=join(f.root,'source.json');writeFileSync(source,'{"queued-follow-ups":{}}');symlinkSync(source,f.path)
    expect(f.read().get('thread-one')?.availability).toBe('unavailable')
    const linkedHome=join(f.root,'linked');symlinkSync(f.home,linkedHome)
    expect(new TeamCodexDesktopQueueReader(linkedHome).read(f.key,['thread-one'],f.now).get('thread-one')?.reason).toBe('wrong-home')
    expect(f.reader.read(f.key,[],f.now).size).toBe(0)
  })
})
