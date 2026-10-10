import { afterEach, expect, test, vi } from 'vitest'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppMigrationManager, migrationStateRoot, migrationEligible } from '../src/app-migration.js'
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(p => rm(p, { recursive: true, force: true }))) })
const bytes = Buffer.from('signed installer fixture')
const release = { version: '3.0.0', versionCode: 277, downloadUrl: 'https://d.jiwo.cc/app.pkg' }
async function setup(overrides: Record<string, unknown> = {}) {
 const root = await mkdtemp(join(tmpdir(),'app-migration-')); roots.push(root)
 const fetcher = vi.fn(async (url: string | URL) => String(url).includes('/latest') ? Response.json(release) : new Response(bytes))
 let now = new Date(2026,8,22,12).getTime()
 const options = { enabled: true, platform: 'darwin', architecture: 'arm64', currentVersion: '0.3.3', stateDirectory: root, downloadsDirectory: async () => root, serviceOrigin: 'https://api.jotmo.cc', artifactOrigin: 'https://d.jiwo.cc', fetch: fetcher, now: () => now, reveal: vi.fn(async () => {}), ...overrides }
 const manager = new AppMigrationManager(options)
 return { manager, root, fetcher, options, nextDay: () => { now += 86400000 } }
}
test('eligibility fails closed and account scopes share state', () => {
 expect(migrationEligible('3.0.0',true,'darwin','arm64')).toBe(false)
 expect(migrationEligible('',true,'darwin','arm64')).toBe(false)
 expect(migrationEligible('0.3.3',false,'darwin','arm64')).toBe(false)
 expect(migrationStateRoot('/app/dsh','prod')).toBe(migrationStateRoot('/app/dsh-containers/a/dsh','prod'))
})
test('successful daily check persists across restarts and later reminders return next day', async () => {
 const f=await setup(); await f.manager.check(false); await f.manager.dismiss()
 const second=new AppMigrationManager(f.options); await second.check(false)
 expect(f.fetcher).toHaveBeenCalledTimes(1); expect((await second.status()).prompt).toBe(false)
 f.nextDay(); expect((await second.check(false)).prompt).toBe(true)
 expect(f.fetcher).toHaveBeenCalledTimes(2)
})
test('download validates, never overwrites, reuses completed file after restart', async () => {
 const f=await setup(); await f.manager.check(true)
 await writeFile(join(f.root,'即我-3.0.0-vc277.pkg'),'user file')
 const first=await f.manager.download(); const second=await f.manager.download(); expect(second.jobId).toBe(first.jobId)
 await vi.waitFor(async () => expect((await f.manager.status()).phase).toBe('completed'))
 expect(await readFile(join(f.root,'即我-3.0.0-vc277.pkg'),'utf8')).toBe('user file')
 expect(await readFile(join(f.root,'即我-3.0.0-vc277 (1).pkg'))).toEqual(bytes)
 const restarted=new AppMigrationManager(f.options); expect((await restarted.status()).phase).toBe('completed')
 await restarted.download(); expect(f.fetcher).toHaveBeenCalledTimes(2)
})
test.each(['size','empty','redirect','partial'])('rejects bad %s and cleans temporary files', async kind => {
 const f=await setup({fetch: async (url: string | URL) => String(url).includes('/latest') ? Response.json(release) : kind==='redirect' ? new Response(null,{status:302,headers:{location:'https://evil.example/a.pkg'}}) : new Response(kind==='empty' ? '' : 'short', {status:kind==='partial'?206:200,headers:kind==='size'?{'content-length':String(bytes.length)}:{}})})
 await f.manager.check(true); await f.manager.download()
 await vi.waitFor(async () => expect((await f.manager.status()).phase).toBe('failed'))
 expect((await readdir(f.root)).filter(p=>p.endsWith('.part')||p.endsWith('.pkg'))).toEqual([])
})
test('original release fields enable migration with no installer metadata', async () => {
 const f=await setup()
 expect((await f.manager.check(true)).phase).toBe('available')
 await f.manager.download();await vi.waitFor(async()=>expect((await f.manager.status()).phase).toBe('completed'))
 expect((await f.manager.status()).downloadedBytes).toBe(bytes.length)
})
test('failed automatic checks wait 15 minutes, manual checks bypass cooldown', async()=>{
 let now=1000000, calls=0
 const f=await setup({now:()=>now,fetch:async()=>{calls++;throw new Error('offline')}})
 await f.manager.check(false);await f.manager.check(false);expect(calls).toBe(1)
 const restart=new AppMigrationManager(f.options);await restart.check(false);expect(calls).toBe(1)
 now+=15*60000;await restart.check(false);expect(calls).toBe(2)
 await restart.check(true);expect(calls).toBe(3)
})
test('404 counts as a successful check and never prompts',async()=>{
 const fetcher=vi.fn(async()=>new Response(null,{status:404})); const f=await setup({fetch:fetcher})
 expect((await f.manager.check(false)).prompt).toBe(false);await f.manager.check(false);expect(fetcher).toHaveBeenCalledTimes(1)
})
test('completed modified file is not revealed or reused',async()=>{
 const f=await setup();await f.manager.check(true);const job=await f.manager.download()
 await vi.waitFor(async()=>expect((await f.manager.status()).phase).toBe('completed'))
 await writeFile(join(f.root,'即我-3.0.0-vc277.pkg'),Buffer.alloc(bytes.length + 1))
 await expect(f.manager.reveal(job.jobId)).rejects.toThrow('修改')
 const restart=new AppMigrationManager(f.options);expect((await restart.status()).phase).toBe('available')
 await restart.download();await vi.waitFor(async()=>expect((await restart.status()).phase).toBe('completed'))
 expect(f.fetcher).toHaveBeenCalledTimes(3)
})
test('cancel and dispose abort the owned download and remove temporary file',async()=>{
 for(const operation of ['cancel','dispose'] as const) {
  const f=await setup({fetch:async(url: string|URL,init?:RequestInit)=>String(url).includes('/latest')?Response.json(release):await new Promise<Response>((_,reject)=>init?.signal?.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}))})
  await f.manager.check(true);const job=await f.manager.download()
  await vi.waitFor(async()=>expect((await readdir(f.root)).some(p=>p.endsWith('.part'))).toBe(true))
  if(operation==='cancel') await f.manager.cancel(job.jobId);else await f.manager.dispose()
  expect((await f.manager.status()).phase).toBe('available');expect((await readdir(f.root)).some(p=>p.endsWith('.part'))).toBe(false)
 }
})
test('a newer check cannot switch an active download target',async()=>{
 let releaseValue=release
 const f=await setup({fetch:async(url: string|URL,init?:RequestInit)=>String(url).includes('/latest')?Response.json(releaseValue):await new Promise<Response>((_,reject)=>init?.signal?.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}))})
 await f.manager.check(true);const job=await f.manager.download();releaseValue={...release,version:'3.1.0'}
 expect((await f.manager.check(true)).target?.version).toBe('3.0.0');await f.manager.cancel(job.jobId)
})
test('Windows downloads the declared EXE using the resolved Downloads folder',async()=>{
 const f=await setup({platform:'win32',architecture:'x64',fetch:async(url: string|URL)=>String(url).includes('/latest')?Response.json({...release,downloadUrl:'https://d.jiwo.cc/app.exe'}):new Response(bytes)})
 await f.manager.check(true);const job=await f.manager.download()
 await vi.waitFor(async()=>expect((await f.manager.status()).phase).toBe('completed'))
 await f.manager.reveal(job.jobId);expect(f.options.reveal).toHaveBeenCalledWith(join(f.root,'即我-3.0.0-vc277.exe'))
})
test('invalid directories fail without marking completion',async()=>{
 const f=await setup();const invalid=join(f.root,'not-a-directory');await writeFile(invalid,'user data')
 const manager=new AppMigrationManager({...f.options,downloadsDirectory:async()=>invalid})
 await manager.check(true);await manager.download();await vi.waitFor(async()=>expect((await manager.status()).phase).toBe('failed'))
 expect(await readFile(invalid,'utf8')).toBe('user data')
})
test('reveal invalidation exposes a retryable download state',async()=>{
 const f=await setup();await f.manager.check(true);const job=await f.manager.download()
 await vi.waitFor(async()=>expect((await f.manager.status()).phase).toBe('completed'))
 await unlinkForTest(join(f.root,'即我-3.0.0-vc277.pkg'))
 await expect(f.manager.reveal(job.jobId)).rejects.toThrow()
 expect((await f.manager.status()).phase).toBe('failed')
})
async function unlinkForTest(path:string) {await rm(path)}

test.each([false, true])('dispose during cached validation prevents further download work (valid cache: %s)', async valid => {
 const f = await setup()
 const completed = join(f.root, 'completed.pkg')
 const target = { version: release.version, versionCode: release.versionCode, downloadUrl: release.downloadUrl, kind:'pkg', size:bytes.length, sha512:'a'.repeat(128) }
 const saved = JSON.stringify({ schema: 1, target, completed: { path: completed, jobId: 'previous' }, prompt: false })
 await writeFile(completed, bytes)
 await writeFile(join(f.root, 'state.json'), saved)
 let block = false
 let enter!: () => void
 let resume!: () => void
 const entered = new Promise<void>(resolve => { enter = resolve })
 const paused = new Promise<void>(resolve => { resume = resolve })
 const manager = new AppMigrationManager({ ...f.options, downloadsDirectory: async () => {
  if (block) { block = false; enter(); await paused }
  return f.root
 } })
 try {
  expect((await manager.status()).phase).toBe('completed')
  if (!valid) await writeFile(completed, Buffer.alloc(bytes.length + 1))
  const before = await manager.status()
  block = true
  const download = manager.download().then(() => 'resolved', () => 'rejected')
  await entered
  const queued = manager.download().then(() => 'resolved', () => 'rejected')
  await manager.dispose()
  resume()
  expect(await download).toBe('rejected')
  expect(await queued).toBe('rejected')
  expect(f.fetcher).not.toHaveBeenCalled()
  expect(await manager.status()).toEqual(before)
  expect(await readFile(join(f.root, 'state.json'), 'utf8')).toBe(saved)
  expect((await readdir(f.root)).sort()).toEqual(['completed.pkg', 'state.json'])
 } finally {
  resume()
  await manager.dispose()
 }
})
test('activation revalidates a completed file even after today was already checked',async()=>{
 const f=await setup();await f.manager.check(true);await f.manager.download()
 await vi.waitFor(async()=>expect((await f.manager.status()).phase).toBe('completed'))
 const file=(await f.manager.status()).fileName!
 await writeFile(join(f.root,file),'modified')
 expect((await f.manager.check(false)).phase).toBe('available')
 expect((await f.manager.status()).fileName).toBeUndefined()
})

test('same-size cached content is reused without digest verification',async()=>{
 const f=await setup();await f.manager.check(true);await f.manager.download()
 await vi.waitFor(async()=>expect((await f.manager.status()).phase).toBe('completed'))
 await writeFile(join(f.root,'即我-3.0.0-vc277.pkg'),Buffer.alloc(bytes.length))
 const restarted=new AppMigrationManager(f.options)
 expect((await restarted.status()).phase).toBe('completed')
})
test.each([true,false])('progress uses response size only when available (%s)',async known=>{
 let stream!:ReadableStreamDefaultController<Uint8Array>
 const f=await setup({fetch:async(url:string|URL)=>String(url).includes('/latest')?Response.json(release):new Response(new ReadableStream<Uint8Array>({start(c){stream=c}}),{headers:known?{'content-length':String(bytes.length)}:{}})})
 await f.manager.check(true);await f.manager.download()
 await vi.waitFor(()=>expect(stream).toBeDefined());stream.enqueue(bytes.subarray(0,4))
 await vi.waitFor(async()=>expect((await f.manager.status()).downloadedBytes).toBe(4))
 expect((await f.manager.status()).totalBytes).toBe(known?bytes.length:undefined)
 stream.enqueue(bytes.subarray(4));stream.close()
 await vi.waitFor(async()=>expect((await f.manager.status()).phase).toBe('completed'))
})
test.each(['https://evil.example/app.pkg','https://d.jiwo.cc/app.pkg.zip','https://d.jiwo.cc/app.exe'])('rejects untrusted or incorrect installer URL %s',async downloadUrl=>{
 const f=await setup({fetch:async()=>Response.json({...release,downloadUrl})})
 expect((await f.manager.check(true)).phase).not.toBe('available')
 await expect(f.manager.download()).rejects.toThrow()
})
test('install only opens the completed task file and deduplicates concurrent launches',async()=>{
 let releaseOpen!:()=>void
 const install=vi.fn(async()=>new Promise<void>(resolve=>{releaseOpen=resolve}))
 const f=await setup({install});await f.manager.check(true);const job=await f.manager.download()
 await vi.waitFor(async()=>expect((await f.manager.status()).phase).toBe('completed'))
 await expect(f.manager.install('other-task')).rejects.toThrow()
 const first=f.manager.install(job.jobId),second=f.manager.install(job.jobId)
 await vi.waitFor(()=>expect(install).toHaveBeenCalledOnce())
 expect(install).toHaveBeenCalledWith(join(f.root,'即我-3.0.0-vc277.pkg'))
 releaseOpen();await Promise.all([first,second])
})
test('install rejects missing files and reports launch failure without discarding the download',async()=>{
 const install=vi.fn(async()=>{throw new Error('open failed')})
 const f=await setup({install});await f.manager.check(true);const job=await f.manager.download()
 await vi.waitFor(async()=>expect((await f.manager.status()).phase).toBe('completed'))
 await expect(f.manager.install(job.jobId)).rejects.toThrow('open failed')
 expect((await f.manager.status()).phase).toBe('completed')
 await rm(join(f.root,'即我-3.0.0-vc277.pkg'))
 await expect(f.manager.install(job.jobId)).rejects.toThrow()
 expect(install).toHaveBeenCalledOnce()
})
