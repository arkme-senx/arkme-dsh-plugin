import { createServer } from 'node:http'
import { once } from 'node:events'
import { createHash } from 'node:crypto'
import { expect,it,vi } from 'vitest'
import { createArkmeTeamHistoryExportHandler } from '../src/rich-media-routes.js'
const hash=(data:string)=>createHash('sha256').update(data).digest('hex')
async function fixture(change?:(part:any,call:number)=>any){
 const read=vi.fn(async(_ref:string,cursor?:string)=>{
   const first=!cursor,text=first?'中文\n':'second',part={chunkBase64:Buffer.from(text).toString('base64'),chunkSha256:hash(text),sha256:hash('中文\nsecond'),bytes:13,offset:first?7:13,complete:!first,...(first?{cursor:'next'}:{}),fileName:'团队对话.md'}
   return change?change(part,read.mock.calls.length):part
 })
 const options={expectedPort:0,allowNonLoopback:false,temporaryDirectory:'unused',maxUploadBytes:1}
 const server=createServer(createArkmeTeamHistoryExportHandler({readTeamHistoryExportChunk:read},options));server.listen(0,'127.0.0.1');await once(server,'listening');options.expectedPort=(server.address() as {port:number}).port
 return {read,url:`http://127.0.0.1:${options.expectedPort}?ref=opaque`,close:async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}}
}
it('streams the exact UTF-8 file with bounded authenticated calls and a whole-file digest',async()=>{
 const f=await fixture()
 try{const response=await fetch(f.url);expect(response.status).toBe(200);expect(response.headers.get('content-length')).toBe('13');expect(response.headers.get('cache-control')).toBe('private, no-store');expect(await response.text()).toBe('中文\nsecond');expect(f.read.mock.calls.map(c=>c.slice(0,2))).toEqual([['opaque',undefined],['opaque','next']])}finally{await f.close()}
})
it('does not release a successful complete file after a bad final hash or lost permission',async()=>{
 for(const change of [(p:any,n:number)=>n===2?{...p,sha256:'b'.repeat(64)}:p,(_p:any,n:number)=>{if(n===2)throw new Error('permission revoked');return _p}]){
  const f=await fixture(change)
  try{await expect(fetch(f.url).then(response=>response.text())).rejects.toThrow()}finally{await f.close()}
 }
})
it('rejects foreign origins, unsupported ranges and a corrupt initial chunk before bytes',async()=>{
 const f=await fixture((p:any)=>({...p,chunkSha256:'b'.repeat(64)}))
 try{
  expect((await fetch(f.url,{headers:{origin:'https://evil.invalid'}})).status).toBe(403)
  expect((await fetch(f.url,{headers:{range:'bytes=0-'}})).status).toBe(416)
  expect(f.read).not.toHaveBeenCalled()
  const response=await fetch(f.url);expect(response.status).toBe(502);expect(await response.text()).not.toContain('中文')
 }finally{await f.close()}
})
it('preserves the UI filename without changing the authorized reference or allowing header/path injection',async()=>{
 const f=await fixture()
 try{
  const name="访客 O'Neil-团队对话-2026-10-29.md"
  const response=await fetch(f.url+'&name='+encodeURIComponent(name).replaceAll("'",'%27'))
  expect(response.headers.get('content-disposition')).toBe("attachment; filename*=UTF-8''"+encodeURIComponent(name).replaceAll("'",'%27'))
  expect(await response.text()).toBe('中文\nsecond')
  expect(f.read.mock.calls[0]![0]).toBe('opaque')
  const unsafe=await fetch(f.url+'&name='+encodeURIComponent('../evil\r\n.html.md'))
  expect(decodeURIComponent(unsafe.headers.get('content-disposition')!)).not.toMatch(/[/\r\n]/u)
  await unsafe.text()
  const wrong=await fetch(f.url+'&name='+encodeURIComponent('x.html'))
  expect(wrong.headers.get('content-disposition')).toContain(encodeURIComponent('团队对话.md'));await wrong.text()
 }finally{await f.close()}
})
