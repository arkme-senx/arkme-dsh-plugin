function assert(value: unknown): asserts value { if (!value) throw new Error('Consumer contract failed') }
async function rejects(run: () => Promise<unknown>, check?: (error: unknown) => boolean) { let failed = false; try { await run() } catch (error) { failed = true; if (check) assert(check(error)) } assert(failed) }
import { createArkmeSdk, type ArkmeRecordExport, type ArkmeRecordExportOptions, type ArkmeRecordExportProgress } from '@senguoyun/dsh-arkme/sdk'
const options: ArkmeRecordExportOptions = { expectedAccountScope: 'test:11', confirmed: true, orderKind: 2 }
const value: ArkmeRecordExport = { accountScope: 'test:11', count: 1, fileRef: 'arkme-record-export-v1.YQ.Yg.Yw', fileName: 'backup.zip', size: 123, expiresAtMillis: Date.now() + 1000, quotaFinalized: true }
const calls: string[] = []
const sdk = createArkmeSdk({ fetchImpl: async (_url, init) => {
  init?.signal?.throwIfAborted()
  const request = JSON.parse(String(init?.body)); calls.push(request.operation)
  return new Response(JSON.stringify({ ok: true, value: request.operation === 'provider.capabilities'
    ? { contractVersion: 1, features: { recordExportV1: true } } : request.operation === 'data.export.range.preview' ? { accountScope: 'test:11', supported: true, previewUid: 'preview' } : value }))
} })
assert(JSON.stringify(await sdk.exportRecords(options)) === JSON.stringify(value))
assert(/download=1$/.test(sdk.localFileUrl(value.fileRef, true)))
assert((await sdk.previewRecordExport('test:11', {mode:'all',timeZone:'UTC',includeAttachments:true}, 1, undefined, undefined, {directory:true,refresh:false})).previewUid === 'preview')
sdk.dispose()
await rejects(() => sdk.exportRecords(options))
const legacy = createArkmeSdk({ fetchImpl: async () => new Response(JSON.stringify({ ok: true, value: { contractVersion: 1, features: {} } })) })
await rejects(() => legacy.exportRecords(options), (error: unknown) => (error as { body: { code: string } }).body.code === 'CAPABILITY_UNSUPPORTED')
assert(JSON.stringify(calls) === JSON.stringify(['provider.capabilities', 'data.export', 'data.export.range.preview']))
const progress: ArkmeRecordExportProgress[] = []
const directory={...value,kind:'directory',directoryRef:'picked',count:0}
const streamSdk=createArkmeSdk({fetchImpl:async(_url,init)=>JSON.parse(String(init?.body)).operation==='provider.capabilities'
 ?new Response(JSON.stringify({ok:true,value:{contractVersion:1,features:{recordExportV1:true}}}))
 :new Response([{kind:'progress',count:8,phase:'writing'},{kind:'progress',count:8,phase:'confirming'},{kind:'result',value:directory}].map(v=>JSON.stringify(v)+'\n').join(''),{headers:{'Content-Type':'application/x-ndjson'}})})
assert((await streamSdk.exportRecords({...options,destinationRef:'picked'},undefined,p=>progress.push(p))).count===0)
assert(progress[0]?.phase==='writing'&&progress[1]?.phase==='confirming')
streamSdk.dispose()
console.log('PASS: public SDK consumer types, capabilities, preview, directory phases, filtered result, download reference and dispose')
