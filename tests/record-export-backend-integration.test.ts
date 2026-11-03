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
  expect((await readFile((await owner.read(result.fileRef)).path)).subarray(0, 2).toString()).toBe('PK')
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
