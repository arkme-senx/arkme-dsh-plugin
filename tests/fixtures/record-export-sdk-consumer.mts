function assert(value: unknown): asserts value { if (!value) throw new Error('Consumer contract failed') }
async function rejects(run: () => Promise<unknown>, check?: (error: unknown) => boolean) { let failed = false; try { await run() } catch (error) { failed = true; if (check) assert(check(error)) } assert(failed) }
import { createArkmeSdk, type ArkmeRecordExport, type ArkmeRecordExportOptions } from '@senguoyun/dsh-arkme/sdk'
const options: ArkmeRecordExportOptions = { expectedAccountScope: 'test:11', confirmed: true, orderKind: 2 }
const value: ArkmeRecordExport = { accountScope: 'test:11', count: 1, fileRef: 'arkme-record-export-v1.YQ.Yg.Yw', fileName: 'backup.zip', size: 123, expiresAtMillis: Date.now() + 1000, quotaFinalized: true }
const calls: string[] = []
const sdk = createArkmeSdk({ fetchImpl: async (_url, init) => {
  init?.signal?.throwIfAborted()
  const request = JSON.parse(String(init?.body)); calls.push(request.operation)
  return new Response(JSON.stringify({ ok: true, value: request.operation === 'provider.capabilities'
    ? { contractVersion: 1, features: { recordExportV1: true } } : value }))
} })
assert(JSON.stringify(await sdk.exportRecords(options)) === JSON.stringify(value))
assert(/download=1$/.test(sdk.localFileUrl(value.fileRef, true)))
sdk.dispose()
await rejects(() => sdk.exportRecords(options))
const legacy = createArkmeSdk({ fetchImpl: async () => new Response(JSON.stringify({ ok: true, value: { contractVersion: 1, features: {} } })) })
await rejects(() => legacy.exportRecords(options), (error: unknown) => (error as { body: { code: string } }).body.code === 'CAPABILITY_UNSUPPORTED')
assert(JSON.stringify(calls) === JSON.stringify(['provider.capabilities', 'data.export']))
console.log('PASS: public SDK consumer types, capability discovery, download reference and dispose')
