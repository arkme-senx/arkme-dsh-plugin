import {expect,it,vi} from 'vitest'
import {teamCodexBytes} from '../src/services/team-codex-transport.js'
const path='/api/v1/team-codex/images/read'
function fixture(response:()=>Promise<Response>){
 let owner=11
 const runtime={config:{environment:'test',teamBaseUrl:'https://test-team.invalid'},requireSession:vi.fn(async()=>({userId:owner,accessToken:'test-only'})),refreshAccessToken:vi.fn(),fetchImpl:vi.fn(async (_input:RequestInfo|URL,_init?:RequestInit)=>response())}
 return {runtime,setOwner:(v:number)=>{owner=v},read:(signal=new AbortController().signal)=>teamCodexBytes(runtime as never,11,path,{}, {},signal)}
}
it('reads chunked bytes with a hard stream bound and cancels oversized responses before EOF',async()=>{
 let cancelled=false,pulls=0
 const f=fixture(async()=>new Response(new ReadableStream({pull(c){pulls++;c.enqueue(new Uint8Array(1024*1024))},cancel(){cancelled=true}})))
 await expect(f.read()).rejects.toMatchObject({code:'team-codex-response'})
 expect(pulls).toBeLessThanOrEqual(23);expect(cancelled).toBe(true)
})
it('propagates cancellation while a body read is pending',async()=>{
 let cancelled=false,start!:()=>void
 const started=new Promise<void>(r=>{start=r})
 const f=fixture(async()=>new Response(new ReadableStream({start(){start()},cancel(){cancelled=true}})))
 const controller=new AbortController(),read=f.read(controller.signal)
 await started;controller.abort()
 await expect(read).rejects.toThrow();expect(cancelled).toBe(true)
})
it('rejects late data after an account switch and sends only the configured TEST endpoint',async()=>{
 const f=fixture(async()=>{f.setOwner(22);return new Response(new Uint8Array([1,2]))})
 await expect(f.read()).rejects.toMatchObject({code:'ACCOUNT_OR_DESTINATION_MISMATCH'})
 expect(f.runtime.fetchImpl.mock.calls[0]?.[0]).toBe('https://test-team.invalid'+path)
})
it('rejects truncation and invalid advertised size and never follows a redirect',async()=>{
 for(const length of ['3','-1','99999999999999999']){
  const f=fixture(async()=>new Response(new Uint8Array([1,2]),{headers:{'content-length':length}}))
  await expect(f.read()).rejects.toMatchObject({code:'team-codex-response'})
  expect(f.runtime.fetchImpl.mock.calls[0]?.[1]).toMatchObject({redirect:'error'})
 }
})
