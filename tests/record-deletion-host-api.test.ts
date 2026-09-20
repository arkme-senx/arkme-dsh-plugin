import {once} from 'node:events'
import {createServer} from 'node:http'
import {describe,it,vi,expect} from 'vitest'
import {createArkmeHostApi,dispatchArkmeHostOperation} from '../src/host-api.js'
import type {ArkmeService} from '../src/arkme-service.js'
describe('record deletion host boundary',()=>{
 it('forwards opaque references only, propagates abort, and rejects invalid batches',async()=>{
  const remove=vi.fn().mockResolvedValue({items:[]});const service={deleteSourceRecords:remove} as unknown as ArkmeService;const signal=new AbortController().signal
  await dispatchArkmeHostOperation(service,'source.record-delete',{sourceRef:'source',deletionRefs:['signed'],ownerUserId:999},undefined,undefined,undefined,undefined,signal)
  expect(remove).toHaveBeenCalledWith('source',['signed'],signal)
  for(const deletionRefs of [[],['a',1],Array(101).fill('a'),['a'.repeat(2049)]])await expect(dispatchArkmeHostOperation(service,'source.record-delete',{sourceRef:'source',deletionRefs})).rejects.toThrow()
  expect(remove).toHaveBeenCalledOnce()
 })
 it('requires the trusted DSH origin before any mutation',async()=>{
  const remove=vi.fn();const service={deleteSourceRecords:remove} as unknown as ArkmeService
  const server=createServer(createArkmeHostApi(service,{expectedPort:3080,allowNonLoopback:false}));server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();if(!address||typeof address==='string')throw Error('address')
  try{for(const origin of [undefined,'http://evil.example','http://localhost:9999']){
   const response=await fetch(`http://127.0.0.1:${address.port}/arkme-self/api`,{method:'POST',headers:{'Content-Type':'application/json',...(origin?{Origin:origin}:{})},body:JSON.stringify({operation:'source.record-delete',params:{sourceRef:'source',deletionRefs:['signed']}})})
   expect(response.status).toBe(403)
  }expect(remove).not.toHaveBeenCalled()}finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}
 })
})
