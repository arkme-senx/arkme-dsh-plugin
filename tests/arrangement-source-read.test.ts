import { describe, expect, it, vi } from 'vitest'
import { ArrangementService } from '../src/services/arrangement-service.js'
import { ArrangementSourceService } from '../src/services/arrangement-source-service.js'
import { ArkmePluginError } from '../src/services/service.js'

function fixture(kind = 'call') {
  const session = { userId: 11, refreshToken: 'session-a' }
  const source: Record<string, unknown> = { id: 'evidence-a', kind, role: 'initial',
    ...(kind === 'call' ? { room_id: 'room-a', start_ms: 1200 } : {}),
    ...(kind === 'audio_summary' ? { summary_id: 'summary-a', date_stamp: 1791734400000, tz_offset: 28800000 } : {}),
    ...(kind === 'agent' ? { agent_session_id: 'session-a', agent_message_id: 'message-a' } : {}), text: '识别所依据的原句' }
  const detail: Record<string, unknown> = { uid: 'arr-a', status: 1, source_type: 6, source_provenance: { version: 1, items: [{ ...source, text: '' }] } }
  const response: Record<string, unknown> = { state: 'ready', source, content: '原资料全文' }
  const host = {
    runtime: {
      requireSession: vi.fn(async () => session),
      authenticatedIntelligentPost: vi.fn(async (path: string) => path.endsWith('/detail') ? detail : response),
    },
    recovery: { cached: vi.fn(async (): Promise<Record<string, unknown> | undefined> => undefined) },
    openArrangementRef: vi.fn(() => ({ arrangementUid: 'arr-a' })),
  }
  const read = (signal?: AbortSignal) => ArrangementService.prototype.sourceEvidence.call(host as unknown as ArrangementService, 'opaque-ref', 'evidence-a', signal)
  return { host, source, detail, response, read }
}

describe('saved arrangement source owner protocol', () => {
  it('hydrates the selected call quote with a fresh authorized source read', async () => {
    const { read, host } = fixture()
    const signal = new AbortController().signal
    expect(await read(signal)).toMatchObject({ id: 'evidence-a', room_id: 'room-a', start_ms: 1200, text: '识别所依据的原句', persisted: true })
    expect(host.runtime.authenticatedIntelligentPost).toHaveBeenLastCalledWith('/api/v1/arrangements/source/read', { uid: 'arr-a', evidence_id: 'evidence-a' }, expect.objectContaining({ userId: 11 }), signal, { lane: 'interactive-read', bypassCache: true })
    expect(host.recovery.cached).not.toHaveBeenCalled()
  })
  it('uses the summary evidence quote rather than replacing it with the entire summary', async () => {
    expect(await fixture('audio_summary').read()).toMatchObject({ text: '识别所依据的原句', summary_id: 'summary-a' })
  })
  it('uses the freshly read user instruction for an agent source', async () => {
    expect(await fixture('agent').read()).toMatchObject({ text: '原资料全文' })
  })
  it.each([
    ['id', 'another-evidence'], ['kind', 'agent'], ['role', 'supplement'], ['room_id', 'different-room'],
    ['start_ms', 1201], ['record_uid', 'injected-destination'], ['occurred_at', 99], ['text', 42],
  ])('rejects changed or malformed source field %s', async (key, value) => {
    const { source, read } = fixture(); source[key] = value
    await expect(read()).rejects.toMatchObject({ code: 'arrangement-source-contract-invalid' })
  })
  it.each(['pending', 'unknown', undefined])('rejects unexpected protocol state %s', async state => {
    const { response, read } = fixture(); response.state = state
    await expect(read()).rejects.toMatchObject({ code: 'arrangement-source-contract-invalid' })
  })
  it('does not use local evidence when the owner denies access', async () => {
    const { response, read, host } = fixture(); response.state = 'unavailable'; response.reason = '原通话已删除或当前无权查看'
    await expect(read()).rejects.toMatchObject({ code: 'arrangement-source-unavailable', message: '原通话已删除或当前无权查看' })
    expect(host.recovery.cached).not.toHaveBeenCalled()
  })
  it('preserves a transport failure rather than labelling it no source', async () => {
    const { host, detail, read } = fixture()
    host.runtime.authenticatedIntelligentPost.mockResolvedValueOnce(detail).mockRejectedValueOnce(new Error('network failed'))
    await expect(read()).rejects.toThrow('network failed')
    expect(host.recovery.cached).not.toHaveBeenCalled()
  })
  it('never submits a local compatibility evidence ID to the cloud source reader', async () => {
    const { host, detail, source, read } = fixture(); delete detail.source_provenance
    host.recovery.cached.mockResolvedValue(source)
    expect(await read()).toMatchObject({ text: '识别所依据的原句', persisted: false })
    expect(host.runtime.authenticatedIntelligentPost).toHaveBeenCalledTimes(1)
  })
  it('rejects a stale evidence ID after cloud provenance replaces local recovery', async () => {
    const { host, detail, source, read } = fixture()
    detail.source_provenance = { version: 1, items: [{ ...source, id: 'new-cloud-evidence' }] }
    host.recovery.cached.mockResolvedValue(source)
    await expect(read()).rejects.toMatchObject({ code: 'arrangement-source-missing' })
    expect(host.recovery.cached).not.toHaveBeenCalled()
  })
  it.each([{ uid: 'different' }, { status: 4 }])('rejects changed arrangement ownership/status %j', async fields => {
    const { detail, read, host } = fixture(); Object.assign(detail, fields)
    await expect(read()).rejects.toMatchObject({ code: 'arrangement-source-mismatch' })
    expect(host.runtime.authenticatedIntelligentPost).toHaveBeenCalledTimes(1)
  })
  it('discards the quote if the account changes during the request', async () => {
    const { host, read } = fixture()
    host.runtime.requireSession.mockResolvedValueOnce({ userId: 11, refreshToken: 'session-a' }).mockResolvedValueOnce({ userId: 22, refreshToken: 'session-b' })
    await expect(read()).rejects.toMatchObject({ code: 'arrangement-source-account-changed' })
  })
  it('discards a cancelled source read even if the transport resolved', async () => {
    const { read } = fixture(); const controller = new AbortController(); controller.abort()
    await expect(read(controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })
  it('exposes only the quote and evidence identity to the client', async () => {
    const { read } = fixture()
    const host = { arrangement: { sourceEvidence: (_ref: string, _id: string, signal?: AbortSignal) => read(signal) } }
    expect(await ArrangementSourceService.prototype.arrangementSourceRead.call(host as unknown as ArrangementSourceService, 'opaque-ref', 'evidence-a'))
      .toEqual({ state: 'ready', evidenceId: 'evidence-a', text: '识别所依据的原句' })
  })
  it('keeps unavailable distinct from network or contract errors', async () => {
    const sourceEvidence = vi.fn().mockRejectedValue(new ArkmePluginError('arrangement-source-unavailable', '来源已删除', false, 404))
    const host = { arrangement: { sourceEvidence } } as unknown as ArrangementSourceService
    expect(await ArrangementSourceService.prototype.arrangementSourceRead.call(host, 'a', 'e')).toEqual({ evidenceId: 'e', state: 'unavailable', reason: '来源已删除' })
    sourceEvidence.mockRejectedValue(new Error('network failed'))
    await expect(ArrangementSourceService.prototype.arrangementSourceRead.call(host, 'a', 'e')).rejects.toThrow('network failed')
  })
})
