import { describe, expect, it, vi } from 'vitest'
import { RecordingService, type RecordingServiceDependencies } from '../src/services/recording-service.js'
import { ArkmePluginError, type ServiceRuntime } from '../src/services/service.js'
import { validateRecordingEvidenceQuery, type RecordingEvidenceQuery } from '../src/recording-evidence-contract.js'
import { correctionOwnerResponse } from './fixtures/recording-correction-owner.js'

const date = new Date(2026, 9, 14).getTime()
const anchorSession = '1'.repeat(24), anchorChild = '2'.repeat(24)
const memberSession = '3'.repeat(24), memberChild = '4'.repeat(24), person = '5'.repeat(24)
function fixture() {
  const session = { userId: 42, accessToken: 'test', refreshToken: 'test' }
  const members = { version: 'page-v1', total_count: 1, has_more: false, next_cursor: '', items: [{
    locator: { session_id: memberSession, child_id: memberChild, transcript_source: 'system', item_index: 0, start_at: 1000, end_at: 5000, revision: 'member-fact' },
    group: `person:${person}`, start_at: date + 900_000, source_number: 2, assignment_number: 2, formal_speaker_id: person,
    text: '另一份录音中的成员', deviation: .2, embedding: [1, 2],
  }] }
  const data = { session_ls: [{ id: anchorSession, belong_usr: 42, start_at: date, end_at: date + 86400000, spk_ls: [{ num: 1, spk_id: person }] }],
    child_ls: [{ id: anchorChild, session_id: anchorSession, start_at: 0, asr: [{ s: 0, e: 4000, n: 1, t: '锚点' }] }] }
  const receipts = new Map<string, unknown>()
  const post = vi.fn(async (path: string, body: Record<string, unknown>): Promise<unknown> => {
    if (path.includes('/recordings/')) return correctionOwnerResponse(path, body, data)
    if (path.endsWith('/get-speaker-ls')) return { spk_ls: [{ id: person, nick_name: '人物', reference: 'speaker:1234567890abcdef' }] }
    if (path.endsWith('/members') || path.endsWith('/candidates')) return members
    if (path.endsWith('/capabilities')) return { supported: true, schema_version: 1, actions: ['consistency', 'compare', 'members', 'candidates', 'build', 'correction-target', 'correction-preview', 'correction-subrange'] }
    if (path.endsWith('/compare')) return { supported: true, schema_version: 1, version: 'e', model_version: 'm', metric: 'cosine_distance', aggregation: 'mean_reference', state: 'ready', items: (body.items as unknown[]).map((_, client_index) => ({ client_index, status: 'insufficient', distance_a: null, distance_b: null, effective_speech_ms: null, reason: 'reference_item' })) }
    if (path.endsWith('/preview')) return { schema_version: 1, affected_count: (body.items as unknown[]).length, intent_token: 'signed', expires_at: Date.now() + 60000, selection_version: 'selected', evidence_version: 'e' }
    if (path.endsWith('/result')) return { schema_version: 1, receipt: receipts.get(String(body.idempotency_key)) ?? null }
    if (path.endsWith('/apply') || path.endsWith('/undo')) {
      const apply = path.endsWith('/apply')
      const receipt = { schema_version: 1, state: apply ? 'applied' : 'undone', version: apply ? 'after' : 'undone', affected_count: 1, correction_id: 'receipt', can_undo: apply, learning_state_at_commit: apply ? 'awaiting_evidence' : 'reconciled' }
      receipts.set(String(body.idempotency_key), receipt)
      return receipt
    }
    if (path.endsWith('/context')) return { supported: true, schema_version: 1, version: 'before', max_items: 100, sound_source: 'unknown', excluded_speakers: [] }
    throw new Error(`unexpected request ${path}`)
  })
  const runtime = { subscribeAccountScope: () => () => {}, config: { environment: 'test', maxTextLength: 20000 }, requireSession: async () => ({ ...session }), authenticatedAudioPost: post, stateStore: { uniqueCode: async () => 'test-key' } } as unknown as ServiceRuntime
  const media = { issueRecordingPlaybackMediaRef: vi.fn(async () => 'opaque-playback') }
  const service = new RecordingService(runtime, { media } as unknown as RecordingServiceDependencies)
  const read = async () => {
    const anchor = (await service.recordingDay(date)).transcript.items[0]!
    post.mockClear()
    const page = await service.recordingSpeakerEvidenceQuery({ action: 'members', groupRefs: [anchor.itemRef] })
    if (!('items' in page) || !('totalCount' in page)) throw new Error('expected members')
    return { anchor, page, member: page.items[0]! }
  }
  return { service, post, session, members, runtime, media, read }
}

describe('refactored evidence coordinates', () => {
  it('pages without transcript hydration and round-trips the actual member coordinates through comparison, preview, apply, result, undo and playback', async () => {
    const f = fixture(), { anchor, page, member } = await f.read()
    expect(f.post).toHaveBeenCalledTimes(1)
    expect(f.post.mock.calls[0]![0]).toMatch(/speaker-evidence\/members$/)
    expect(JSON.stringify(page)).not.toMatch(/embedding|session_id|child_id|formal_speaker_id|speakerReference/)
    expect(member.itemRef).toMatch(/^arkme-recording-evidence-item-v1\./)
    await f.service.recordingSpeakerEvidenceQuery({ action: 'compare', itemRefs: [member.itemRef], referenceA: [anchor.itemRef] })
    expect(f.post.mock.calls.at(-1)![1]).toMatchObject({ items: [{ session_id: memberSession, child_id: memberChild, revision: 'member-fact', item_index: 0, start_at: 1000, end_at: 5000 }] })
    const context = await f.service.recordingSpeakerCorrectionContext(member.itemRef)
    expect(context).toMatchObject({ supported: true, version: 'before' })
    const command = { itemRef: anchor.itemRef, itemRefs: [member.itemRef], expectedVersion: 'before', idempotencyKey: 'member-command-0001', detach: true,
      target: { kind: 'unknown' as const }, selections: [{ itemRef: member.itemRef, startOffsetMillis: 1000, endOffsetMillis: 3000 }] }
    const preview = await f.service.previewRecordingSpeakerCorrection(command)
    expect(f.post.mock.calls.filter(([path]) => path.endsWith('/apply'))).toHaveLength(0)
    const applied = await f.service.applyRecordingSpeakerCorrection({ ...command, intentToken: preview.intentToken })
    expect(applied.learningStateAtCommit).toBe('awaiting_evidence')
    const writes = f.post.mock.calls.filter(([path]) => path.endsWith('/apply'))
    expect(writes).toHaveLength(1)
    expect(writes[0]![1]).toMatchObject({ item: { child_id: anchorChild }, items: [{ child_id: memberChild, revision: 'member-fact', selection: { start_at: 2000, end_at: 4000 } }], intent_token: 'signed', target: { kind: 'unknown' } })
    expect((writes[0]![1].items as unknown[])).toHaveLength(1)
    expect(await f.service.recordingSpeakerCorrectionResult({ itemRef: anchor.itemRef, action: 'apply', idempotencyKey: command.idempotencyKey })).toMatchObject({ version: 'after', learningStateAtCommit: 'awaiting_evidence' })
    expect(await f.service.undoRecordingSpeakerCorrection({ itemRef: anchor.itemRef, undoRef: applied.undoRef!, expectedVersion: 'after', idempotencyKey: 'member-undo-000001' })).toMatchObject({ learningStateAtCommit: 'reconciled' })
    await f.service.recordingPlayback(member.itemRef)
    expect(f.media.issueRecordingPlaybackMediaRef).toHaveBeenCalledExactlyOnceWith({ viewerUserId: 42, locator: { child_id: memberChild, source: 'primary', ordinal: 0 } }, undefined)
    f.post.mockClear()
    await expect(f.service.assignRecordingSpeaker({ itemRef: member.itemRef, newSpeakerName: '不能绕过精确纠错', scope: 'speaker' })).rejects.toThrow()
    expect(f.post).not.toHaveBeenCalled()
  })

  it.each(['existing', 'new'] as const)('submits %s target as one atomic owner command', async kind => {
    const f = fixture(), { anchor, member } = await f.read()
    const target = kind === 'existing' ? { kind, speakerRef: (await f.service.recordingSpeakerOptions())[0]!.speakerRef } : { kind, name: '  新人物  ' }
    await f.service.applyRecordingSpeakerCorrection({ itemRef: anchor.itemRef, itemRefs: [member.itemRef], detach: false, expectedVersion: 'before', idempotencyKey: `target-${kind}-000001`, target })
    const calls = f.post.mock.calls.filter(([path]) => path.endsWith('/apply'))
    expect(calls).toHaveLength(1)
    expect(calls[0]![1].detach).toBe(false)
    expect(calls[0]![1].target).toEqual(kind === 'existing' ? { kind, speaker_id: person } : { kind, name: '新人物' })
    expect(f.post.mock.calls.some(([path]) => /bind|assign|create-speaker/.test(path))).toBe(false)
  })

  it.each(['existing', 'new'] as const)('rejects contradictory detach and %s assignment before HTTP', async kind => {
    const f = fixture(), { member } = await f.read()
    const target = kind === 'existing' ? { kind, speakerRef: (await f.service.recordingSpeakerOptions())[0]!.speakerRef } : { kind, name: '人物' }
    f.post.mockClear()
    await expect(f.service.previewRecordingSpeakerCorrection({ itemRef: member.itemRef, itemRefs: [member.itemRef], target, detach: true, expectedVersion: 'before', idempotencyKey: 'contradict-target-0001' })).rejects.toMatchObject({ httpStatus: 400 })
    expect(f.post).not.toHaveBeenCalled()
  })

  it.each(['account', 'abort', 'revision'] as const)('drops a preview after %s changes during the HTTP request', async kind => {
    const f = fixture(), { member } = await f.read(), controller = new AbortController()
    f.post.mockImplementationOnce(async () => {
      if (kind === 'account') f.session.userId++
      if (kind === 'abort') controller.abort()
      if (kind === 'revision') f.service.dispose()
      return { schema_version: 1, affected_count: 1, intent_token: 'signed', expires_at: Date.now() + 60000, selection_version: 's', evidence_version: 'e' }
    })
    await expect(f.service.previewRecordingSpeakerCorrection({ itemRef: member.itemRef, itemRefs: [member.itemRef], expectedVersion: 'before', idempotencyKey: 'preview-scope-0001', detach: true }, controller.signal)).rejects.toThrow()
  })

  it('maps excluded people to the same canonical identities as the refactored directory', async () => {
    const f = fixture(), { member } = await f.read()
    const option = (await f.service.recordingSpeakerOptions())[0]!
    f.post.mockClear()
    f.post.mockResolvedValueOnce({ supported: true, schema_version: 1, version: 'before', max_items: 100, sound_source: 'unknown', excluded_speakers: [{ speaker_id: person, label: '人物' }] })
    const context = await f.service.recordingSpeakerCorrectionContext(member.itemRef)
    expect(context).toMatchObject({ excludedSpeakers: [{ optionKey: option.optionKey, label: '人物' }] })
    expect(f.post.mock.calls.filter(([path]) => path.endsWith('/get-speaker-ls'))).toHaveLength(1)
    expect(JSON.stringify(context)).not.toContain(person)
  })

  it('does not invent an exclusion identity when the directory cannot resolve it', async () => {
    const f = fixture(), { member } = await f.read()
    f.post.mockResolvedValueOnce({ supported: true, schema_version: 1, version: 'before', max_items: 100, sound_source: 'unknown', excluded_speakers: [{ speaker_id: '6'.repeat(24), label: '已移除' }] })
    expect(await f.service.recordingSpeakerCorrectionContext(member.itemRef)).toMatchObject({ supported: true, excludedSpeakers: [{ optionKey: '', label: '已移除' }] })
  })

  it.each(['account', 'abort', 'revision'] as const)('drops context after %s changes during the HTTP request', async kind => {
    const f = fixture(), { member } = await f.read(), controller = new AbortController()
    f.post.mockImplementationOnce(async () => {
      if (kind === 'account') f.session.userId++
      if (kind === 'abort') controller.abort()
      if (kind === 'revision') f.service.dispose()
      return { supported: true, schema_version: 1, version: 'before', max_items: 100, sound_source: 'unknown', excluded_speakers: [] }
    })
    await expect(f.service.recordingSpeakerCorrectionContext(member.itemRef, controller.signal)).rejects.toThrow()
  })

  it.each([
    { startOffsetMillis: -1, endOffsetMillis: 2000 },
    { startOffsetMillis: 2000, endOffsetMillis: 2000 },
    { startOffsetMillis: 0, endOffsetMillis: 4001 },
    { startOffsetMillis: 0.5, endOffsetMillis: 2000 },
  ])('rejects an invalid public subrange %j before HTTP', async selection => {
    const f = fixture(), { member } = await f.read()
    f.post.mockClear()
    await expect(f.service.recordingSpeakerEvidenceQuery({ action: 'build', itemRefs: [member.itemRef], selections: [{ itemRef: member.itemRef, ...selection }] })).rejects.toThrow()
    expect(f.post).not.toHaveBeenCalled()
  })

  it.each(['duplicate', 'old-version', 'repeated-cursor', 'missing-row', 'zero-id', 'invalid-distance'] as const)('rejects %s member pages', async kind => {
    const f = fixture(), { anchor } = await f.read()
    if (kind === 'duplicate') { f.members.items.push(f.members.items[0]!); f.members.total_count = 2 }
    if (kind === 'old-version') f.members.version = 'changed'
    if (kind === 'repeated-cursor') { f.members.has_more = true; f.members.next_cursor = 'cursor' }
    if (kind === 'missing-row') { f.members.items = []; f.members.has_more = true; f.members.next_cursor = 'next' }
    if (kind === 'zero-id') f.members.items[0]!.locator.child_id = '0'.repeat(24)
    if (kind === 'invalid-distance') f.members.items[0]!.deviation = NaN
    await expect(f.service.recordingSpeakerEvidenceQuery({ action: 'members', groupRefs: [anchor.itemRef], version: 'page-v1', ...(kind === 'repeated-cursor' ? { cursor: 'cursor' } : {}) })).rejects.toThrow()
  })

  it('preserves owner conflicts and never turns network failures into unsupported capability', async () => {
    const f = fixture(), { member } = await f.read()
    for (const status of [409, 410, 422, 503]) {
      f.post.mockRejectedValueOnce(new ArkmePluginError('upstream', 'rejected', false, status))
      await expect(f.service.recordingSpeakerEvidenceQuery({ action: 'members', groupRefs: [member.itemRef] })).rejects.toMatchObject({ httpStatus: status })
    }
  })
})

describe('bounded evidence requests', () => {
  it.each([
    { action: 'consistency', groupRefs: [] },
    { action: 'consistency', groupRefs: ['a', 'b'], itemRefs: ['x'] },
    { action: 'compare', itemRefs: ['x'], referenceA: ['a'], referenceB: ['a'] },
    { action: 'members', groupRefs: ['a'], limit: 101 },
    { action: 'members', groupRefs: ['a'], cursor: 'unbound' },
    { action: 'members', groupRefs: ['a'], sort: 'invented' },
    { action: 'build', groupRefs: ['a'], itemRefs: ['b'] },
    { action: 'build', itemRefs: Array.from({ length: 101 }, (_, i) => String(i)) },
    { action: 'capabilities', itemRefs: ['a'] },
    { action: 'candidates', referenceA: ['a'], referenceB: ['b'] },
    { action: 'candidates', referenceA: ['a'], sort: 'time' },
  ])('rejects malformed %j before any HTTP request', async query => {
    expect(() => validateRecordingEvidenceQuery(query as RecordingEvidenceQuery)).toThrow()
    const f = fixture()
    await expect(f.service.recordingSpeakerEvidenceQuery(query as RecordingEvidenceQuery)).rejects.toThrow()
    expect(f.post).not.toHaveBeenCalled()
  })
})
