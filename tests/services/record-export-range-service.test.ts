import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { inflateRawSync } from 'node:zlib'
import { afterEach, expect, it, vi } from 'vitest'
import { RecordExportService } from '../../src/services/record-export-service.js'
import { RecordExportRangeService, exportSelection } from '../../src/services/record-export-range-service.js'
import { ArkmePluginError } from '../../src/services/service.js'
const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
const selection = { mode: 'incremental', timeZone: 'Asia/Shanghai', includeAttachments: false } as const
const wire = { mode: 'incremental', time_zone: 'Asia/Shanghai', include_attachments: false, order_kind: 1 }
async function fixture(removalOnly = false) {
  const root = await mkdtemp(join(tmpdir(), 'arkme-range-')); roots.push(root)
  let userId = 11, saved = false
  const plan = { preview_uid: 'preview1', base_version: 1, chain_uid: 'b'.repeat(64), selection: wire, selection_fingerprint: 'a'.repeat(64), status: 'started', record_count: removalOnly ? 0 : 1, removed_count: 1, new_count: removalOnly ? 0 : 1, updated_count: 0, total_image_count: 0, total_voice_count: 0 }
  const post = vi.fn(async (path: string, _body?: unknown): Promise<Record<string, unknown>> => {
    if (path.endsWith('/capabilities')) return { protocol_version:2, date_range:true, incremental:true, explicit_saved_confirmation:true }
    if (path.endsWith('/prepare')) return { protocol_version: 2, can_export: true, baseline_required: false, plan, chain: { version: 1, saved_at: 1000 } }
    if (path.endsWith('/start')) return plan
    if (path.endsWith('/page')) return { items: removalOnly ? [] : [{ record_uid: 'r1', version: 4, send_at: 1793700000000, title: '标题', text: '正文', topic_core: { topic_uid: 't', title: '当前主题' }, file_refs: [] }], removed_uids: ['gone'], next_index: removalOnly ? 1 : 2, has_more: false }
    if (path.endsWith('/finish')) return { quota_finalized: true }
    if (path.endsWith('/saved')) { saved = true; return { version: 2, saved_at: 2000 } }
    throw new Error(`Unexpected path ${path}`)
  })
  const runtime = { config: { environment: 'test', fileStateDirectory: root }, requireSession: async () => ({ userId, refreshToken: 'secret' }), stateStore: { uniqueCode: async () => 'stable-local-secret' }, authenticatedPost: post }
  return { owner: new RecordExportService(runtime as never), range: new RecordExportRangeService(runtime as never), post, plan, runtime, saved: () => saved, setUser: (id: number) => { userId = id } }
}
function zipEntry(bytes: Buffer, filename: string) {
  const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])); let cursor = bytes.readUInt32LE(end + 16)
  for (let i = 0; i < bytes.readUInt16LE(end + 10); i++) {
    const size = bytes.readUInt32LE(cursor + 20), names = bytes.readUInt16LE(cursor + 28), extra = bytes.readUInt16LE(cursor + 30), comment = bytes.readUInt16LE(cursor + 32), offset = bytes.readUInt32LE(cursor + 42)
    const name = bytes.subarray(cursor + 46, cursor + 46 + names).toString()
    if (name === filename || (filename === '*.md' && name.endsWith('.md'))) { const start = offset + 30 + bytes.readUInt16LE(offset + 26) + bytes.readUInt16LE(offset + 28); const data = bytes.subarray(start, start + size); return bytes.readUInt16LE(cursor + 10) === 8 ? inflateRawSync(data) : data }
    cursor += 46 + names + extra + comment
  }
  throw new Error('Entry missing')
}
it.each([false, true])('creates a standalone v2 archive and advances only after exact saved confirmation; removal-only=%s', async removalOnly => {
  const f = await fixture(removalOnly)
  const preview = await f.owner.preview('test:11', selection, 1)
  expect(preview).toMatchObject({ previewUid: 'preview1', removedCount: 1, chainVersion: 1 })
  const result = await f.owner.run({ expectedAccountScope: 'test:11', confirmed: true, orderKind: 1, previewUid: preview.previewUid, selection })
  expect(f.saved()).toBe(false)
  const file = await f.owner.read(result.fileRef), bytes = await readFile(file.path)
  const manifest = JSON.parse(zipEntry(bytes, 'manifest.json').toString())
  expect(manifest).toMatchObject({ schema_version: 2, selection, removed_uids: ['gone'], record_count: removalOnly ? 0 : 1 })
  if (!removalOnly) {
    expect(manifest.records[0]).toMatchObject({ record_uid: 'r1', version: 4, text: '正文' })
    expect(zipEntry(bytes, '*.md').toString()).toContain('主题：当前主题\n\n标题\n\n正文')
  }
  const finish = f.post.mock.calls.find(([path]) => path.endsWith('/finish'))![1] as any
  expect(finish).toMatchObject({ success: true, artifact_size: bytes.length, artifact_sha256: createHash('sha256').update(bytes).digest('hex') })
  await f.owner.read(result.fileRef); await f.owner.read(result.fileRef)
  expect(f.saved()).toBe(false)
  expect(await f.owner.confirmSaved('test:11', result.savedConfirmationRef!)).toMatchObject({ chainVersion: 2 })
  expect(f.saved()).toBe(true)
  expect(f.post.mock.calls.every(([path]) => path.includes('/range/'))).toBe(true)
  expect(f.post.mock.calls.filter(([path]) => path.endsWith('/start'))).toHaveLength(1)
  expect(JSON.stringify(result)).not.toMatch(/stable-local-secret|preview1/)
})
it('rejects a tampered archive or account switch before contacting saved endpoint', async () => {
  const f = await fixture(), result = await f.owner.run({ expectedAccountScope: 'test:11', confirmed: true, orderKind: 1, previewUid: 'preview1', selection })
  const file = await f.owner.read(result.fileRef)
  const bytes = await readFile(file.path); bytes[0] ^= 1; await writeFile(file.path, bytes)
  await expect(f.owner.confirmSaved('test:11', result.savedConfirmationRef!)).rejects.toBeDefined()
  expect(f.saved()).toBe(false)
  f.setUser(12)
  await expect(f.owner.confirmSaved('test:11', result.savedConfirmationRef!)).rejects.toMatchObject({ code: 'record-export-account-changed' })
  expect(f.saved()).toBe(false)
})
it('rejects impossible dates and does not downgrade unsupported/error responses', async () => {
  expect(() => exportSelection({ ...selection, mode: 'dates', startDate: '2026-02-30', endDate: '2026-03-02' })).toThrow()
  const f = await fixture()
  f.post.mockRejectedValue(new ArkmePluginError('upstream', 'not found', false, 404))
  expect(await f.range.supported('test:11')).toBe(false)
  f.post.mockRejectedValue(new Error('timeout'))
  await expect(f.range.supported('test:11')).rejects.toThrow('timeout')
  expect(f.post.mock.calls.every(([path]) => path.endsWith('/range/capabilities'))).toBe(true)
})
it('freezes selection and rejects missing plans or conflicting start without creating a legacy export', async () => {
  const f = await fixture(), original = f.post.getMockImplementation()!
  f.post.mockImplementation(async (path, body) => path.endsWith('/prepare') ? { protocol_version: 2, can_export: true, baseline_required: false } : original(path, body))
  await expect(f.owner.preview('test:11', selection, 1)).rejects.toBeDefined()
  f.plan.selection = { ...wire, include_attachments: true }
  await expect(f.owner.run({ expectedAccountScope: 'test:11', confirmed: true, orderKind: 1, selection, previewUid: 'preview1' })).rejects.toBeDefined()
  expect(f.post.mock.calls.some(([path]) => path.includes('/session/'))).toBe(false)
})

it('keeps attachment reuse opt-in so legacy ZIP callers still get standalone file references',async()=>{
 const f=await fixture();const original=f.post.getMockImplementation()!;
 f.post.mockImplementation(async(path,body)=>path.endsWith('/capabilities')?{protocol_version:2,date_range:true,incremental:true,explicit_saved_confirmation:true,policy_version:3,incremental_no_quota:true,attachment_reuse:true}:original(path,body));
 await f.range.preview('test:11',selection,1);
 expect(f.post.mock.calls.find(([path])=>path.endsWith('/prepare'))![1]).not.toHaveProperty('reuse_attachments');
 const directoryRange=new RecordExportRangeService(f.runtime as never,true);
 await directoryRange.preview('test:11',selection,1);
 expect(f.post.mock.calls.filter(([path])=>path.endsWith('/prepare')).at(-1)![1]).toMatchObject({reuse_attachments:true,policy_version:3});
})
it('refuses folder execution on an older backend without sending an ambiguous incremental request',async()=>{
 const f=await fixture(),directoryRange=new RecordExportRangeService(f.runtime as never,true);
 expect(await directoryRange.preview('test:11',selection,1)).toMatchObject({canExport:false,folderSupported:false});
 expect(f.post.mock.calls.every(([path])=>path.endsWith('/capabilities'))).toBe(true);
})
