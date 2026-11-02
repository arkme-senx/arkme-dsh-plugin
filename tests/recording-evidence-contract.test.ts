import { createServer } from 'node:http'
import { once } from 'node:events'
import { expect, it, vi } from 'vitest'
import { parseRecordingEvidence } from '../src/recording-evidence-contract.js'
import { createArkmeSdk } from '../src/sdk/index.js'
import { createArkmeHostApi, dispatchArkmeHostOperation } from '../src/host-api.js'
import { createArkmeCoreToolDefinitions, arkmeToolCatalog, type ArkmeCoreToolPorts } from '../src/tools/index.js'
import type { ArkmeService } from '../src/arkme-service.js'

const compare = { supported: true, schema_version: 1, version: 'snapshot', model_version: 'model', metric: 'cosine_distance', aggregation: 'mean_reference', state: 'ready', items: [{ client_index: 0, status: 'ready', distance_a: .2, distance_b: null, effective_speech_ms: 4000, embedding: [1, 2], session_id: 'private' }] }
const query = { action: 'compare' as const, itemRefs: ['opaque'], referenceA: ['ref'] }
it('validates complete cardinality and strips raw vectors and internal IDs', () => {
  const result = parseRecordingEvidence(compare, query)
  expect(JSON.stringify(result)).not.toMatch(/embedding|session_id|private/)
  expect(() => parseRecordingEvidence({ ...compare, items: [] }, query)).toThrow()
  expect(() => parseRecordingEvidence({ ...compare, items: [{ ...compare.items[0], distance_a: NaN }] }, query)).toThrow()
  expect(() => parseRecordingEvidence(compare, { ...query, referenceB: ['b'] })).toThrow()
})
it('unknown data remains null and cannot become a single-item perfect score', () => {
  const group = { client_index: 0, version: 'v', model_version: 'm', score_definition: 's', reference_method: 'r', state: 'insufficient', score: null, analyzed_count: 1, total_count: 927, review_count: null, analyzed_speech_ms: 1000, total_speech_ms: null, items: [] }
  const input = { supported: true, schema_version: 1, metric: 'cosine_distance', groups: [group] }
  expect(parseRecordingEvidence(input, { action: 'consistency', groupRefs: ['opaque'] })).toMatchObject({ groups: [{ score: null, total_count: 927 }] })
  expect(() => parseRecordingEvidence({ ...input, groups: [{ ...group, state: 'ready', score: 100 }] }, { action: 'consistency', groupRefs: ['opaque'] })).toThrow()
})
it('SDK and Host use one owner and preserve cancellation', async () => {
  const owner = { recordingSpeakerEvidenceQuery: vi.fn(async () => ({ supported: false })) }
  const sdk = createArkmeSdk({ fetchImpl: async (_url, init) => {
    const { operation, params } = JSON.parse(String(init?.body))
    const value = await dispatchArkmeHostOperation(owner as unknown as ArkmeService, operation, params, undefined, undefined, undefined, undefined, init?.signal ?? undefined)
    return new Response(JSON.stringify({ ok: true, value }))
  } })
  const signal = new AbortController().signal
  expect(await sdk.recordingSpeakerEvidenceQuery(query, signal)).toEqual({ supported: false })
  expect(owner.recordingSpeakerEvidenceQuery).toHaveBeenCalledExactlyOnceWith(query, signal)
})
it('read tool cannot schedule inference and build requires explicit write grant', async () => {
  const ports = { recordingSpeakerEvidenceQuery: vi.fn(async () => ({ supported: false })) }
  const tools = createArkmeCoreToolDefinitions(ports as unknown as ArkmeCoreToolPorts)
  const tool = tools.find(t => t.name === 'arkme_recording_speaker_evidence')!
  await expect(tool.execute({ request_json: JSON.stringify({ action: 'build', itemRefs: ['opaque'] }) }, {} as never)).rejects.toThrow()
  expect(ports.recordingSpeakerEvidenceQuery).not.toHaveBeenCalled()
  expect(arkmeToolCatalog.modulesFor('business').find(m => m.meta.toolName === 'arkme_recording_speaker_evidence_build')?.meta).toMatchObject({ effect: 'write', grant: 'explicit-user-write' })
})

it('failed durable jobs cannot be reported as still building', () => {
  expect(parseRecordingEvidence({ state: 'failed', job_ids: ['internal'], active_jobs: 0, failed_jobs: 1, missing_material_children: 0 }, { action: 'build', itemRefs: ['opaque'] })).toEqual({ state: 'failed', queuedCount: 0, missingMaterialChildren: 0 })
})
it('preview uses the read Tool and the public SDK owner without a write', async () => {
  const input = { itemRef: 'opaque', itemRefs: ['opaque'], detach: true, expectedVersion: 'version', idempotencyKey: 'preview-request-001' }
  const ports = { previewRecordingSpeakerCorrection: vi.fn(async () => ({ affectedCount: 1, intentToken: 'signed', expiresAt: 1, selectionVersion: 's', evidenceVersion: 'e' })), applyRecordingSpeakerCorrection: vi.fn() }
  const tools = createArkmeCoreToolDefinitions(ports as unknown as ArkmeCoreToolPorts)
  await tools.find(t => t.name === 'arkme_recording_speaker_correction_context')!.execute({ action: 'preview', request_json: JSON.stringify(input) }, {} as never)
  expect(ports.previewRecordingSpeakerCorrection).toHaveBeenCalledExactlyOnceWith(input, undefined)
  expect(ports.applyRecordingSpeakerCorrection).not.toHaveBeenCalled()
})

it('keeps the established page evidence and consistency routes independent of the new query route', async () => {
  const page = { itemRefs: ['row'], referenceA: ['a'], referenceB: [] }
  const summary = { anchorRefs: ['row'], itemRefs: [] }
  const owner = { recordingSpeakerEvidence: vi.fn(async () => ({ supported: false })), recordingSpeakerConsistency: vi.fn(async () => ({ supported: false })), recordingSpeakerEvidenceQuery: vi.fn() }
  await dispatchArkmeHostOperation(owner as unknown as ArkmeService, 'recordings.speaker.evidence', page)
  await dispatchArkmeHostOperation(owner as unknown as ArkmeService, 'recordings.speaker.consistency', summary)
  expect(owner.recordingSpeakerEvidence).toHaveBeenCalledExactlyOnceWith(page, undefined)
  expect(owner.recordingSpeakerConsistency).toHaveBeenCalledExactlyOnceWith(summary, undefined)
  expect(owner.recordingSpeakerEvidenceQuery).not.toHaveBeenCalled()
})

it('public playback uses the existing media owner and preserves cancellation', async () => {
  const playback = { playbackRef: 'opaque-media', mimeType: 'audio/wav', startOffsetMillis: 1, endOffsetMillis: 2 }
  const owner = { recordingPlayback: vi.fn(async () => playback) }
  const sdk = createArkmeSdk({ fetchImpl: async (_url, init) => {
    const { operation, params } = JSON.parse(String(init?.body))
    const value = await dispatchArkmeHostOperation(owner as unknown as ArkmeService, operation, params, undefined, undefined, undefined, undefined, init?.signal ?? undefined)
    return new Response(JSON.stringify({ ok: true, value }))
  } })
  const signal = new AbortController().signal
  expect(await sdk.recordingPlayback('opaque-member', signal)).toEqual(playback)
  expect(owner.recordingPlayback).toHaveBeenCalledExactlyOnceWith('opaque-member', signal)
  expect(sdk.mediaUrl(playback.playbackRef)).toContain('ref=opaque-media')
})

it('preview supports 100 opaque references with subranges within the shared body budget', async () => {
  const refs = Array.from({ length: 100 }, (_, i) => `${i}-${'x'.repeat(1200)}`)
  const input = { itemRef: refs[0], itemRefs: refs, detach: true, expectedVersion: 'v', idempotencyKey: 'preview-large-0001', selections: refs.map(itemRef => ({ itemRef, startOffsetMillis: 100, endOffsetMillis: 300 })) }
  const request_json = JSON.stringify(input)
  expect(request_json.length).toBeGreaterThan(200000)
  const ports = { previewRecordingSpeakerCorrection: vi.fn(async () => ({ affectedCount: 100 })) }
  const tool = createArkmeCoreToolDefinitions(ports as unknown as ArkmeCoreToolPorts).find(t => t.name === 'arkme_recording_speaker_correction_context')!
  await tool.execute({ action: 'preview', request_json }, {} as never)
  expect(ports.previewRecordingSpeakerCorrection).toHaveBeenCalledExactlyOnceWith(input, undefined)
})

it('HTTP build requires the trusted origin while capability reads remain read-only', async () => {
  const owner = { recordingSpeakerEvidenceQuery: vi.fn(async () => ({ supported: false })) }
  const options = { expectedPort: 0, allowNonLoopback: false }
  const server = createServer(createArkmeHostApi(owner as unknown as ArkmeService, options))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('missing test address')
  options.expectedPort = address.port
  const origin = `http://127.0.0.1:${address.port}`
  const send = (action: string, trusted: boolean) => fetch(`${origin}/arkme-self/api`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(trusted ? { Origin: origin } : {}) },
    body: JSON.stringify({ operation: 'recordings.speaker.evidence.query', params: { action } }),
  })
  try {
    const blocked = await send('build', false)
    expect(blocked.status).toBe(403)
    expect(await blocked.json()).toMatchObject({ ok: false, error: { code: 'origin-required' } })
    expect(owner.recordingSpeakerEvidenceQuery).not.toHaveBeenCalled()
    for (const [action, trusted] of [['build', true], ['capabilities', false]] as const) {
      const response = await send(action, trusted)
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ ok: true })
    }
    expect(owner.recordingSpeakerEvidenceQuery).toHaveBeenCalledTimes(2)
  } finally {
    server.close()
    await once(server, 'close')
  }
})
