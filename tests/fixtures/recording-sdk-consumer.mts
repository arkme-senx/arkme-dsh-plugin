import { createArkmeSdk, readCompleteRecordingTranscript, type ArkmeRecordingTranscriptPage } from '@senguoyun/dsh-arkme/sdk'

const dateStamp = new Date(2026, 8, 10).getTime()
const first: ArkmeRecordingTranscriptPage = {
  dateStamp, transcriptSource: 'system', viewRef: 'opaque-view', nextCursor: 'opaque-cursor',
  state: 'ready', message: '', totalDurationMillis: 1000, processingCount: 0,
  items: [{
    itemId: 'item', itemRef: 'sealed-item', sessionKey: 'session', transcriptSource: 'system',
    startAtMillis: dateStamp, endAtMillis: dateStamp + 1000,
    speakerNumber: 1, speakerKey: 'speaker', speakerColorIndex: 1, speakerLabel: '我',
    canBindSpeaker: true, isSelf: true, isBackground: false,
    text: '汉🎙', textStartOffset: 0, textEndOffset: 2, textTotalLength: 4,
  }],
}
let reads = 0
const sdk = createArkmeSdk({ fetchImpl: async (_url, options) => {
  options?.signal?.throwIfAborted()
  const call = JSON.parse(String(options?.body))
  const value = call.operation === 'provider.capabilities'
    ? { contractVersion: 1, features: { recordingTranscriptPages: true } }
    : call.params.cursor === undefined ? (++reads, first)
    : (++reads, { ...first, nextCursor: '', items: [{ ...first.items[0], text: '尾部', textStartOffset: 2, textEndOffset: 4 }] })
  return new Response(JSON.stringify({ ok: true, value }))
} })
const start = await sdk.recordingTranscriptPage(dateStamp)
const result = await readCompleteRecordingTranscript(start, (cursor, signal) => sdk.recordingTranscriptPage(dateStamp, { cursor, signal }))
if (result.items[0]?.text !== '汉🎙尾部' || result.nextCursor !== '' || reads !== 2) throw new Error('Public consumer lost content')

const unsupported = createArkmeSdk({ fetchImpl: async () => new Response(JSON.stringify({
  ok: true, value: { contractVersion: 1, features: {} },
})) })
let refused = false
try { await unsupported.recordingTranscriptPage(dateStamp) } catch { refused = true }
if (!refused) throw new Error('Missing capability must fail explicitly')

// A plugin owns its request AbortController and cancels it on scope disposal.
// This SDK read has no retained subscription or background process to dispose.
const lifecycle = new AbortController()
lifecycle.abort()
let canceled = false
try { await sdk.recordingTranscriptPage(dateStamp, { signal: lifecycle.signal }) } catch { canceled = true }
if (!canceled || reads !== 2) throw new Error('Disposed consumer continued reading')
const file = { fileRef: 'arkme-file-v1.00000000-0000-4000-8000-000000000001', startAtMillis: dateStamp, ownership: 'self' as const }
const imports: string[] = []
const importer = createArkmeSdk({ fetchImpl: async (_url, options) => {
  options?.signal?.throwIfAborted()
  const call = JSON.parse(String(options?.body))
  if (call.operation !== 'provider.capabilities') imports.push(call.operation)
  return new Response(JSON.stringify({ ok: true, value: call.operation === 'provider.capabilities'
    ? { contractVersion: 1, features: { recordingFileImport: true } }
    : { importRef: 'opaque-import', phase: 'prepared', revision: 1 } }))
} })
const imported = await importer.importRecordingFile(file)
await importer.recordingImportStatus(imported.importRef)
await importer.retryRecordingImport(imported.importRef, imported.revision)
if (imports.join(',') !== 'recordings.import.file,recordings.import.status,recordings.import.retry') throw new Error('Import consumer lost contract')
refused = false
try { await unsupported.importRecordingFile(file) } catch { refused = true }
if (!refused) throw new Error('Unsupported import must fail before writing')
canceled = false
try { await importer.importRecordingFile(file, lifecycle.signal) } catch { canceled = true }
if (!canceled || imports.length !== 3) throw new Error('Disposed consumer started import')
console.log('Packed public SDK consumer: Unicode pages, typed file import, capability refusal and cancellation passed')
