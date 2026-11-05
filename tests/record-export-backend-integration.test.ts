import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, it } from 'vitest'
import { RecordExportService } from '../src/services/record-export-service.js'
import { RecordExportRangeService } from '../src/services/record-export-range-service.js'
const rootUrl = process.env.ARKME_RANGE_BACKEND_URL
const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
it.skipIf(!rootUrl)('runs Go HTTP handlers, Mongo snapshot, streamed ZIP and saved checkpoint through the actual plugin owner', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'arkme-backend-e2e-')); roots.push(directory)
  const runtime = { config: { environment: 'test', fileStateDirectory: directory }, stateStore: { uniqueCode: async () => 'isolated-http-device' }, requireSession: async () => ({ userId: 10001, refreshToken: 'fixture' }), authenticatedPost: async (path: string, body: unknown) => {
    const response = await fetch(`${rootUrl}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const value = await response.json() as any
    if (value.code !== 0) throw new Error(`Backend rejected ${path}: ${value.message}`)
    return value.data
  } }
  const ranges = new RecordExportRangeService(runtime as never), owner = new RecordExportService(runtime as never), scope = 'test:10001'
  expect(await ranges.supported(scope)).toBe(true)
  expect((await ranges.state(scope, undefined, false)).chainVersion).toBe(0)
  const selection = { mode: 'all', timeZone: 'Asia/Shanghai', includeAttachments: false } as const
  const preview = await owner.preview(scope, selection, 1)
  expect(preview.recordCount).toBe(1)
  const result = await owner.run({ expectedAccountScope: scope, confirmed: true, orderKind: 1, selection, previewUid: preview.previewUid })
  expect(result.count).toBe(1); expect(result.quotaFinalized).toBe(true)
  const archive = await readFile((await owner.read(result.fileRef)).path)
  expect(archive.subarray(0, 2).toString()).toBe('PK')
  expect(archive.toString()).toContain('主题：真实主题 &lt;&amp;&gt; \\[测试\\]\n\nHTTP标题\n\n真实隔离数据库正文')
  expect((await ranges.state(scope, undefined, false)).chainVersion).toBe(0)
  expect((await owner.confirmSaved(scope, result.savedConfirmationRef!)).chainVersion).toBe(1)
  expect((await owner.confirmSaved(scope, result.savedConfirmationRef!)).chainVersion).toBe(1)
  const delta = await owner.preview(scope, { ...selection, mode: 'incremental' }, 1)
  expect(delta).toMatchObject({ baselineRequired: false, recordCount: 0, removedCount: 0 })
  const dates = await owner.preview(scope, { ...selection, mode: 'dates', startDate: '2026-11-03', endDate: '2026-11-03' }, 1)
  expect(dates.recordCount).toBe(1)
  const dateResult = await owner.run({ expectedAccountScope: scope, confirmed: true, orderKind: 1, selection: { ...selection, mode: 'dates', startDate: '2026-11-03', endDate: '2026-11-03' }, previewUid: dates.previewUid })
  await owner.confirmSaved(scope, dateResult.savedConfirmationRef!)
  expect((await ranges.state(scope, undefined, false)).chainVersion).toBe(1)
})

it.skipIf(!rootUrl)('writes a folder and automatically commits its saved checkpoint against the real Go handler', async () => {
  const backend=process.env.ARKME_RANGE_BACKEND_URL
  if(!backend)throw new Error('Real isolated export backend is required')
  const {RecordDirectoryExportService}=await import('../src/services/record-directory-export-service.js')
  const {mkdtemp,readFile,rm}=await import('node:fs/promises')
  const {join}=await import('node:path');const {tmpdir}=await import('node:os')
  const root=await mkdtemp(join(tmpdir(),'go-folder-export-'))
  const runtime={config:{environment:'test',fileStateDirectory:join(root,'host')},stateStore:{uniqueCode:async()=>root},requireSession:async()=>({userId:10001,refreshToken:'fixture'}),fetchImpl:fetch,authenticatedPost:async(path:string,body:unknown)=>{const response=await fetch(backend+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const value=await response.json();if(value.code!==0)throw new Error(value.message);return value.data}}
  const service=new RecordDirectoryExportService(runtime as never);service.attach(async()=>root)
  try{
    const selected=await service.pick('test:10001'),selection={mode:'all',timeZone:'UTC',includeAttachments:false} as const
    const preview=await service.preview('test:10001',selection,1,selected.destinationRef)
    const result=await service.run({expectedAccountScope:'test:10001',confirmed:true,orderKind:1,selection,previewUid:preview.previewUid!,destinationRef:selected.destinationRef!})
    expect(result.kind).toBe('directory');expect(result.count).toBe(1);expect(result.savedAtMillis).toBeGreaterThan(0)
    const text = await readFile(join(root,'即我备份-test-10001',result.fileName),'utf8')
    expect(text).toContain('真实隔离数据库正文')
    expect(text).toContain('主题：真实主题 &lt;&amp;&gt; \\[测试\\]')
    expect((await service.preview('test:10001',selection,1,selected.destinationRef)).localReplica).toBe(true)
  }finally{service.dispose();await rm(root,{recursive:true,force:true})}
})
