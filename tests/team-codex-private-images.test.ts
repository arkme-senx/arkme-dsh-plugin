import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import { TeamCodexPrivateImages } from '../src/team-codex-private-images.js'
import { codexImageSafeText, codexMarkdownImages } from '../src/team-codex-image-text.js'
import type { TeamCodexEvent } from '../src/team-codex-contract.js'
import { TeamCodexCloudJournal } from '../src/team-codex-cloud-journal.js'
import type { TeamCodexTask } from '../src/team-codex-contract.js'
const roots:string[]=[],dbs:DatabaseSync[]=[]
afterEach(()=>{for(const db of dbs.splice(0))db.close();for(const p of roots.splice(0))rmSync(p,{recursive:true,force:true})})
const line=(type:string,payload:object)=>JSON.stringify({type,payload})+'\n'
const turn='turn_123',session='session_123'
const start=(id=turn)=>line('event_msg',{type:'task_started',turn_id:id,root_turn_id:id})
const message=(role:string,content:object[])=>line('response_item',{type:'message',role,content,...(role==='assistant'?{phase:'final_answer'}:{})})
const event=(kind:TeamCodexEvent['kind']='UserPromptSubmit',turnId=turn):TeamCodexEvent=>({sequence:1,turnId,kind,text:'text',at:1,truncated:false})
async function fixture(){
 const root=mkdtempSync(join(tmpdir(),'codex-private-images-'));roots.push(root)
 const home=join(root,'codex');mkdirSync(join(home,'sessions'),{recursive:true})
 const path=join(home,'sessions','bound.jsonl');writeFileSync(path,line('session_meta',{id:session})+start())
 const native=new DatabaseSync(join(home,'state_5.sqlite'));dbs.push(native);native.exec('CREATE TABLE threads(id TEXT,rollout_path TEXT)');native.prepare('INSERT INTO threads VALUES(?,?)').run(session,path)
 const db=new DatabaseSync(join(root,'local.sqlite'));dbs.push(db)
 const store=new TeamCodexPrivateImages(db,home)
 const source={sessionId:session,homeKey:createHash('sha256').update(realpathSync(home)).digest('hex')}
 const bytes=await sharp({create:{width:12,height:8,channels:3,background:'#49a'}}).png().toBuffer()
 const data='data:image/png;base64,'+bytes.toString('base64')
 const run=async(events=[event()])=>{store.schedule(11,source,events,()=>true);await store.idle();return store.project(11,source,events)}
 return {root,home,path,db,store,source,bytes,data,run}
}
describe('Codex private images',()=>{
 it('captures real input images, stores decoded bytes, and checks owner/session/turn on every read',async()=>{
  const f=await fixture();appendFileSync(f.path,message('user',[{type:'input_image',image_url:f.data}]))
  const result=await f.run(),image=result[0]!.privateImages![0]!
  expect(image).toMatchObject({width:12,height:8,state:'ready'})
  expect(JSON.stringify(result)).not.toContain('base64')
  expect(f.store.read(11,f.source,turn,'UserPromptSubmit',image.ref,false)?.dataUrl).toMatch(/^data:image\/webp;base64,/)
  expect(f.store.read(12,f.source,turn,'UserPromptSubmit',image.ref,true)).toBeUndefined()
  expect(f.store.read(11,f.source,'other_turn','UserPromptSubmit',image.ref,true)).toBeUndefined()
  expect(f.store.read(11,{sessionId:'other_session'},turn,'UserPromptSubmit',image.ref,true)).toBeUndefined()
 })
 it('persists images across restart and removal of temporary source files',async()=>{
  const f=await fixture(),imagePath=join(f.root,'output.png');writeFileSync(imagePath,f.bytes)
  appendFileSync(f.path,message('assistant',[{type:'output_text',text:`![结果](<${imagePath}>)`}]))
  const first=(await f.run([event('Stop')]))[0]!.privateImages![0]!
  rmSync(imagePath);rmSync(f.path)
  const restored=new TeamCodexPrivateImages(f.db,f.home)
  expect(restored.project(11,f.source,[event('Stop')])[0]?.privateImages?.[0]?.ref).toBe(first.ref)
  expect(restored.read(11,f.source,turn,'Stop',first.ref,true)?.dataUrl).toMatch(/^data:image\/png/)
 })
 it('does not fetch remote URLs, read paths in user prose, or import tool screenshot output',async()=>{
  const f=await fixture()
  appendFileSync(f.path,message('user',[{type:'input_text',text:`![not an attachment](${join(f.root,'secret.png')})`}])+line('response_item',{type:'custom_tool_call_output',call_id:'screenshot',output:[{type:'input_image',image_url:f.data}]})+message('assistant',[{type:'output_text',text:'![remote](https://example.test/private.png)'}]))
  const results=await f.run([event(),event('Stop')])
  expect(results[0]?.privateImages).toBeUndefined()
  expect(results[1]?.privateImages).toHaveLength(1)
  expect(results[1]?.privateImages?.[0]?.state).toBe('unavailable')
  expect(JSON.stringify(results)).not.toContain('example.test')
 })
 it('collects explicitly rendered generated images and ignores an unrelated tool image',async()=>{
  const f=await fixture()
  appendFileSync(f.path,line('response_item',{type:'custom_tool_call',call_id:'gen',name:'functions.exec',input:'generatedImage(result)'})+line('response_item',{type:'custom_tool_call_output',call_id:'other',output:[{type:'input_image',image_url:f.data}]})+line('response_item',{type:'custom_tool_call_output',call_id:'gen',output:[{type:'input_image',image_url:f.data}]})+message('assistant',[{type:'output_text',text:'完成'}]))
  expect((await f.run([event('Stop')]))[0]?.privateImages).toMatchObject([{state:'ready'}])
 })
 it('reads incremental append, exact cloud turn mappings, and preserves message association',async()=>{
  const f=await fixture();appendFileSync(f.path,message('user',[{type:'input_image',image_url:f.data}]))
  await f.run()
  appendFileSync(f.path,start('turn_456')+message('user',[{type:'input_image',image_url:f.data}]))
  const cloud={...f.source,turns:new Map([['cloud_hash','turn_456']])}
  f.store.schedule(11,cloud,[event('UserPromptSubmit','cloud_hash')],()=>true);await f.store.idle()
  const image=f.store.project(11,cloud,[event('UserPromptSubmit','cloud_hash')])[0]!.privateImages![0]!
  expect(f.store.read(11,cloud,'cloud_hash','UserPromptSubmit',image.ref,true)).toBeTruthy()
  expect(f.store.project(11,{...cloud,turns:new Map()},[event('UserPromptSubmit','cloud_hash')])[0]?.privateImages).toBeUndefined()
 })
 it('does not save or return another turn, and fences background work on account switch',async()=>{
  const f=await fixture();appendFileSync(f.path,message('user',[{type:'input_image',image_url:f.data}]))
  expect((await f.run([event('UserPromptSubmit','not_requested')]))[0]?.privateImages).toBeUndefined()
  f.store.schedule(11,f.source,[event()],()=>true);f.store.fence();await f.store.idle()
  expect(f.store.project(11,f.source,[event()])[0]?.privateImages).toBeUndefined()
 })
 it('rejects wrong source metadata and configuration root',async()=>{
  const f=await fixture();appendFileSync(f.path,message('user',[{type:'input_image',image_url:f.data}]))
  f.store.schedule(11,{...f.source,homeKey:'wrong'},[event()],()=>true);await f.store.idle()
  expect(f.store.project(11,f.source,[event()])[0]?.privateImages).toBeUndefined()
  writeFileSync(f.path,line('session_meta',{id:'other'})+start()+message('user',[{type:'input_image',image_url:f.data}]))
  expect((await f.run())[0]?.privateImages).toBeUndefined()
 })
 it('retries partial lines and marks invalid image bytes unavailable',async()=>{
  const f=await fixture(),record=message('user',[{type:'input_image',image_url:'data:image/png;base64,eA=='}])
  appendFileSync(f.path,record.slice(0,-3));expect((await f.run())[0]?.privateImages).toBeUndefined()
  appendFileSync(f.path,record.slice(-3));expect((await f.run())[0]?.privateImages?.[0]?.state).toBe('unavailable')
 })
})
describe('private image text projection',()=>{
 it('never sends image blobs, private refs or image URLs in team cloud batches',()=>{
  const db=new DatabaseSync(':memory:');dbs.push(db)
  const journal=new TeamCodexCloudJournal(db)
  const task={id:'task',title:'test',installationId:'source'} as TeamCodexTask
  journal.reconcile(11,'local-team','cloud-team',[task],()=>[{...event('Stop'),text:'![private](https://secret.test/a.png)',privateImages:[{ref:'private-ref',state:'ready',width:1,height:1}]}])
  const batch=journal.batch(11,'local-team',new Set(['task']))
  expect(batch?.tasks[0]?.events[0]?.text).toBe('[图片仅本人可见]')
  expect(batch?.tasks[0]?.events[0]?.truncated).toBe(false)
  expect(JSON.stringify(batch)).not.toMatch(/secret|private-ref|privateImages|base64/)
 })
 it('removes Markdown and reference URLs, attachment paths, HTML and data URIs',()=>{
  const text='# Files mentioned by the user:\n\n## secret.png: /tmp/secret.png\nImage attachment: true\n\n![photo](https://secret.test/photo.png)\n![x][ref]\n\n[ref]: https://secret.test/ref.png\n<img src="https://secret.test/html.png">\ndata:image/png;base64,eA=='
  const safe=codexImageSafeText(text)
  expect(safe).not.toMatch(/secret|https:|data:image|\/tmp\//)
  expect(safe).toContain('图片仅本人可见')
  expect(codexImageSafeText(safe)).toBe(safe)
 })
 it('preserves ordinary text and fenced Markdown examples',()=>{
  const text='说明\n```md\n![example](/tmp/example.png)\n```'
  expect(codexImageSafeText(text)).toBe(text)
  expect(codexMarkdownImages(text)).toEqual([])
 })
 it('removes escaped URLs and shared image reference definitions by their original range',()=>{
  const safe=codexImageSafeText('![x][ref] ![y][ref]\n\n[ref]: https://secret.test/a\\(b\\).png')
  expect(safe).not.toContain('secret.test')
  expect(safe).not.toContain('[ref]')
  expect(safe).toContain('图片仅本人可见')
 })
})
