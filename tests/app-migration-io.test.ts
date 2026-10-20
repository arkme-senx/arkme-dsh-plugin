import { afterEach, expect, test, vi } from 'vitest'
import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { AppMigrationManager } from '../src/app-migration.js'
vi.mock('node:fs/promises', async importOriginal => {
 const actual=await importOriginal<typeof import('node:fs/promises')>()
 return {...actual,open:vi.fn(actual.open)}
})
const actual=await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
const roots:string[]=[]
afterEach(async()=>{vi.mocked(fs.open).mockImplementation(actual.open);await Promise.all(roots.splice(0).map(path=>actual.rm(path,{recursive:true,force:true})))})
test.each(['ENOSPC','EACCES','network'])('reports %s and never publishes an incomplete installer',async failure=>{
 const root=await actual.mkdtemp(join(tmpdir(),'migration-io-'));roots.push(root)
 const bytes=Buffer.from('installer')
 const metadata={version:'3.0.0',versionCode:277,downloadUrl:'https://d.jiwo.cc/app.pkg',installer:{kind:'pkg',size:bytes.length,sha512:createHash('sha512').update(bytes).digest('hex')}}
 if(failure!=='network')vi.mocked(fs.open).mockImplementation(async(path,flags,mode)=>{
  if(String(path).endsWith('.part'))throw Object.assign(new Error(failure),{code:failure})
  return actual.open(path,flags,mode)
 })
 const manager=new AppMigrationManager({enabled:true,currentVersion:'0.3.3',platform:'darwin',architecture:'arm64',stateDirectory:root,serviceOrigin:'https://api.jotmo.cc',artifactOrigin:'https://d.jiwo.cc',downloadsDirectory:async()=>root,
 fetch:async url=>String(url).includes('/latest')?Response.json(metadata):new Response(new ReadableStream({start(controller){controller.enqueue(bytes.subarray(0,2));controller.error(new Error('connection reset'))}}))})
 await manager.check(true);await manager.download()
 await vi.waitFor(async()=>expect((await manager.status()).phase).toBe('failed'))
 expect((await manager.status()).error).toContain(failure==='network'?'connection reset':failure)
 expect((await actual.readdir(root)).filter(name=>name.endsWith('.pkg')||name.endsWith('.part'))).toEqual([])
})
