import assert from 'node:assert/strict'
import { createArkmeSdk, type RecordingEvidenceQuery, type RecordingEvidenceResult, type RecordingEvidenceSelection, type ArkmeRecordingSpeakerCorrectionPreview, type ArkmeRecordingPlayback } from '@senguoyun/dsh-arkme/sdk'

const controller = new AbortController()
const sdk = createArkmeSdk({ fetchImpl: async (_url, init) => {
  init?.signal?.throwIfAborted()
  const { operation, params } = JSON.parse(String(init?.body))
  const value = operation === 'recordings.speaker.correction.preview'
    ? { affectedCount: 1, intentToken: 'signed', expiresAt: 1, selectionVersion: 's', evidenceVersion: 'e' }
    : operation === 'recordings.playback.open'
      ? { playbackRef: 'opaque-media', mimeType: 'audio/wav', startOffsetMillis: 0, endOffsetMillis: 3000 }
      : { supported: params.action !== 'compare', schema_version: 1, actions: ['compare'] }
  return new Response(JSON.stringify({ ok: true, value }))
} })
const query: RecordingEvidenceQuery = { action: 'capabilities' }
const result: RecordingEvidenceResult = await sdk.recordingSpeakerEvidenceQuery(query, controller.signal)
assert('supported' in result && result.supported)
const selection: RecordingEvidenceSelection = { itemRef: 'opaque', startOffsetMillis: 500, endOffsetMillis: 2000 }
const preview: ArkmeRecordingSpeakerCorrectionPreview = await sdk.previewRecordingSpeakerCorrection({ itemRef: 'opaque', itemRefs: ['opaque'], selections: [selection], target: { kind: 'unknown' }, detach: true, expectedVersion: 's', idempotencyKey: 'external-consumer-001' })
assert.equal(preview.intentToken, 'signed')
const playback: ArkmeRecordingPlayback = await sdk.recordingPlayback('opaque')
assert(sdk.mediaUrl(playback.playbackRef).includes('opaque-media'))
assert.deepEqual(await sdk.recordingSpeakerEvidenceQuery({ action: 'compare', itemRefs: ['row'], referenceA: ['reference'] }), { supported: false, schema_version: 1, actions: ['compare'] })
controller.abort()
await assert.rejects(sdk.recordingSpeakerEvidenceQuery(query, controller.signal))
console.log('external public evidence SDK consumer passed')
