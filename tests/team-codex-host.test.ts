import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { once, EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import { expect, it, vi } from 'vitest'
import { createArkmeHostApi } from '../src/host-api.js'

it('requires the exact local page origin even for journal reads', async () => {
  const state = vi.fn(async () => ({ localOnly:true,self:null,tasks:[] }))
  const entryAvailability=vi.fn(async()=>({userId:11,visible:false,checked:true}))
  const options = { expectedPort:0,teamCodex:{ state,entryAvailability } as never }
  const server = createServer(createArkmeHostApi({} as never,options))
  server.listen(0,'127.0.0.1'); await once(server,'listening')
  const address = server.address()
  if (!address || typeof address==='string') throw new Error('missing address')
  options.expectedPort = address.port
  const origin = `http://127.0.0.1:${address.port}`
  const request = (value?: string) => fetch(`${origin}/arkme-self/api`,{
    method:'POST',headers:{'Content-Type':'application/json',...(value?{Origin:value}:{})},
    body:JSON.stringify({operation:'team.codex.state',params:{teamRef:'test-team'}}),
  })
  try {
    for (const value of [undefined,'https://example.com',`http://localhost:${address.port}`,`ftp://127.0.0.1:${address.port}`,'null']) {
      expect((await request(value)).status).toBe(403)
    }
    expect(state).not.toHaveBeenCalled()
    expect((await request(origin)).status).toBe(200)
    expect(state).toHaveBeenCalledExactlyOnceWith('test-team',undefined,undefined,undefined,undefined,{cursor:undefined,after:undefined,from:undefined},expect.any(AbortSignal))
    const availability = (value?:string) => fetch(`${origin}/arkme-self/api`,{
      method:'POST',headers:{'Content-Type':'application/json',...(value?{Origin:value}:{})},
      body:JSON.stringify({operation:'team.codex.entry-availability',params:{expectedUserId:11}}),
    })
    expect((await availability()).status).toBe(403)
    expect(entryAvailability).not.toHaveBeenCalled()
    expect((await availability(origin)).status).toBe(200)
    expect(entryAvailability).toHaveBeenCalledExactlyOnceWith(11)
  } finally { server.closeAllConnections(); await new Promise<void>(resolve=>server.close(()=>resolve())) }
})

it('rejects remote callers even when the host allows other non-loopback operations', async () => {
  const state = vi.fn()
  const req = Readable.from([Buffer.from(JSON.stringify({operation:'team.codex.state',params:{teamRef:'test'}}))])
  Object.assign(req,{method:'POST',socket:{remoteAddress:'192.168.1.9'},headers:{origin:'http://127.0.0.1:3100',host:'127.0.0.1:3100'}})
  const res = Object.assign(new EventEmitter(),{writeHead:vi.fn(),end:vi.fn()})
  await createArkmeHostApi({} as never,{expectedPort:3100,allowNonLoopback:true,teamCodex:{state} as never})(req as IncomingMessage,res as unknown as ServerResponse)
  expect(res.writeHead).toHaveBeenCalledWith(403,expect.any(Object))
  expect(state).not.toHaveBeenCalled()
})

it('propagates a disconnected reader to the shared owner without stopping background collection',async()=>{
 let received:AbortSignal|undefined
 const state=vi.fn(async(...args:unknown[])=>{received=args.at(-1) as AbortSignal;await new Promise<void>(resolve=>received!.addEventListener('abort',()=>resolve(),{once:true}));received!.throwIfAborted()})
 const options={expectedPort:0,teamCodex:{state} as never},server=createServer(createArkmeHostApi({} as never,options))
 server.listen(0,'127.0.0.1');await once(server,'listening');const addr=server.address();if(!addr||typeof addr==='string')throw Error('address');options.expectedPort=addr.port
 const origin=`http://127.0.0.1:${addr.port}`,controller=new AbortController()
 try{
  const response=fetch(origin+'/arkme-self/api',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({operation:'team.codex.state',params:{teamRef:'self',after:'cursor'}}),signal:controller.signal}).catch(()=>undefined)
  await vi.waitFor(()=>expect(received).toBeInstanceOf(AbortSignal));controller.abort()
  await vi.waitFor(()=>expect(received!.aborted).toBe(true));await response
  expect(state).toHaveBeenCalledOnce()
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}
})
