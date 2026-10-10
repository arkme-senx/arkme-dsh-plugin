import { createServer } from 'node:http'
import { once } from 'node:events'
import { expect, test, vi } from 'vitest'
import { createArkmeHostApi } from '../src/host-api.js'
test.each(['download','install'] as const)('migration %s requires local same-origin and ignores caller URLs and commands',async operation=>{
 const manager={download:vi.fn(async()=>({phase:'downloading'})),install:vi.fn(async()=>({phase:'completed'}))}
 const options={expectedPort:0,allowNonLoopback:true,migrationManager:manager as never}
 const server=createServer(createArkmeHostApi({} as never,options));server.listen(0,'127.0.0.1');await once(server,'listening')
 const address=server.address();if(!address||typeof address==='string')throw new Error('address missing')
 options.expectedPort=address.port;const origin=`http://127.0.0.1:${address.port}`
 try {
  for(const requestOrigin of [undefined,'https://evil.example',origin]) {
   const response=await fetch(origin,{method:'POST',headers:{'Content-Type':'application/json',...(requestOrigin?{Origin:requestOrigin}:{})},body:JSON.stringify({operation:`app.migration.${operation}`,params:{jobId:'owned-task',url:'https://evil.example',path:'/tmp/other',command:'launch'}})})
   expect(response.status).toBe(requestOrigin===origin?200:403)
  }
  if(operation==='download')expect(manager.download).toHaveBeenCalledExactlyOnceWith()
  else expect(manager.install).toHaveBeenCalledExactlyOnceWith('owned-task')
 } finally {server.close();await once(server,'close')}
})
