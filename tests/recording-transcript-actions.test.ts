import { describe, expect, it, vi } from 'vitest'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { createArkmeHostApi } from '../src/host-api.js'
import type { ArkmeService } from '../src/arkme-service.js'
import { projectRecordingTranscripts, recordingDoubaoProgress } from '../src/recording-presentation.js'
import { RecordingService, type RecordingServiceDependencies } from '../src/services/recording-service.js'
import { OwnerRecordingForwardGateway } from '../src/services/recording-forward-gateway.js'
import type { ServiceRuntime } from '../src/services/service.js'
import type { RecordingForwardInput } from '../src/recording-forward-contract.js'
import { recordingComparisonPlaybackTarget } from '../src/client/recordings/recording-transcript-comparison.js'

const date = new Date(2026, 8, 4).getTime()
const session = { userId: 42, accessToken: 'test-access', refreshToken: 'test-refresh' }
const source = () => ({
  session_ls: [{ id: 'audio-session', start_at: date, end_at: date + 20_000, spk_ls: [{ num: 1, spk_id: 'speaker' }] }],
  child_ls: [{ id: 'audio-child', session_id: 'audio-session', start_at: 0, has_asr: true, doubao_asr_status: 3,
    asr: [{ s: 0, e: 4_000, n: 1, t: '系统第一段' }, { s: 5_000, e: 10_000, n: 1, t: '系统第二段' }],
    doubao_asr: [{ s: 500, e: 9_000, n: 1, t: '豆包独立分段', b: 1 }],
  }],
})
const input = (itemRefs: string[]): RecordingForwardInput => ({ itemRefs, targetSourceRef: 'target', requestId: 'a0000000-0000-0000-0000-000000000001', recordUid: 'a0000000-0000-0000-0000-000000000002', sendAtMillis: date })

function fixture() {
  const data = source()
  const forward = vi.fn(async () => ({ recordUid: 'sent' }))
  const requireSession = vi.fn(async () => session)
  const post = vi.fn(async (path: string) => path.endsWith('one-day-trans') ? data : { spk_ls: [{ id: 'speaker', nick_name: '本人' }] })
  const runtime = { config: { maxTextLength: 20000 }, requireSession, authenticatedAudioPost: post, stateStore: { uniqueCode: async () => 'test-key' } } as unknown as ServiceRuntime
  const service = new RecordingService(runtime, { forwardGateway: { forward, supportsRecordTargets: async () => true } } as unknown as RecordingServiceDependencies)
  return { data, forward, service, requireSession, post }
}

describe('recording transcript owner boundaries', () => {
  it('delivers 150 real sealed selectors through the HTTP host without truncating the selection', async () => {
    const { service, data, forward } = fixture()
    data.session_ls[0]!.id = '0123456789abcdef01234567'
    data.child_ls[0]!.session_id = data.session_ls[0]!.id
    data.child_ls[0]!.id = 'abcdef0123456789abcdef01'
    data.child_ls[0]!.asr = Array.from({ length: 150 }, (_, n) => ({ s: n * 100, e: n * 100 + 100, n: 1, t: String(n) }))
    const view = await service.recordingComparison(date)
    expect(view.system.items).toHaveLength(150)
    expect(view.system.items[0]?.sameSpeakerItemCount).toBe(150)
    const body = JSON.stringify({ operation: 'recordings.forward', params: input(view.system.items.map(item => item.itemRef)) })
    expect(Buffer.byteLength(body)).toBeLessThan(128 * 1024)
    const server = createServer(createArkmeHostApi({ forwardRecording: service.forwardRecording.bind(service) } as unknown as ArkmeService, { expectedPort: 3080, allowNonLoopback: false }))
    server.listen(0, '127.0.0.1'); await once(server, 'listening')
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('missing address')
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/arkme-self/api`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:3080' }, body })
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ ok: true, value: { recordUid: 'sent' } })
      expect(forward.mock.calls[0]?.[0].segments).toHaveLength(150)
    } finally { server.close(); await once(server, 'close') }
  })
  it.each(['system', 'doubao'] as const)('uses owner effective identity and explicit unassignment for %s', transcriptSource => {
    const data = source()
    const rows = [
      { s: 0, e: 1_000, n: 1, t: '已取消绑定', speaker_identity_source: 'system', q: 'stale' },
      { s: 1_000, e: 2_000, n: 1, t: '当前绑定', speaker_identity_source: 'item', effective_spk_id: 'current', q: 'stale' },
    ]
    Object.assign(data.child_ls[0]!, { [transcriptSource === 'system' ? 'asr' : 'doubao_asr']: rows })
    const items = projectRecordingTranscripts(data, [{ id: 'current', nick_name: '当前说话人' }, { id: 'stale', nick_name: '过期说话人' }], new Map(), { viewerUserId: 42, transcriptSource })
    expect(items[0]?.formalSpeakerId).toBe('')
    expect(items[1]?.speakerLabel).toBe('当前说话人')
    expect(items.some(item => item.speakerLabel === '过期说话人')).toBe(false)
  })

  it('projects independent sources, preserves paragraph indices, and keeps system-only background semantics', () => {
    const data = source()
    const system = projectRecordingTranscripts(data, [], new Map(), { viewerUserId: 42 })
    const doubao = projectRecordingTranscripts(data, [], new Map(), { viewerUserId: 42, transcriptSource: 'doubao' })
    expect(system.map(item => item.asrItemIndex)).toEqual([0, 1])
    expect(doubao).toHaveLength(1)
    expect(doubao[0]).toMatchObject({ transcriptSource: 'doubao', text: '豆包独立分段', isBackground: false, startAtMillis: date + 500, asrItemIndex: 0 })
    expect(doubao[0]?.itemId).not.toBe(system[0]?.itemId)
  })

  it.each([1, 2, 4, 5])('does not expose stale completed text while the owner reports status %s', status => {
    const data = source(); data.child_ls[0]!.doubao_asr_status = status
    expect(projectRecordingTranscripts(data, [], new Map(), { viewerUserId: 42, transcriptSource: 'doubao' })).toEqual([])
  })

  it('counts progress only inside existing sessions and the selected day', () => {
    const data = source()
    data.child_ls[0]!.doubao_asr_status = 1
    data.child_ls.push({ ...data.child_ls[0]!, id: 'orphan', session_id: 'unknown' }, { ...data.child_ls[0]!, id: 'outside', start_at: 50_000 })
    expect(recordingDoubaoProgress(data, { dayStartMillis: date, dayEndMillis: date + 86_400_000 })).toEqual({ processingCount: 1, candidateCount: 0, failedCount: 0, silentCount: 0 })
  })

  it('keeps owner IDs sealed and forwards only current selectors in time order', async () => {
    const { service, forward } = fixture()
    const comparison = await service.recordingComparison(date)
    expect(JSON.stringify(comparison)).not.toContain('audio-session')
    const [first, second] = comparison.system.items
    expect(first?.sessionKey).toBe(comparison.doubao.items[0]?.sessionKey)
    await service.forwardRecording(input([second!.itemRef, first!.itemRef]))
    expect(forward).toHaveBeenCalledWith({ sessionId: 'audio-session', segments: [
      { childId: 'audio-child', asrItemIndex: 0, transcriptSource: 'system' },
      { childId: 'audio-child', asrItemIndex: 1, transcriptSource: 'system' },
    ] }, expect.anything(), session, undefined)
    expect(JSON.stringify(forward.mock.calls[0]?.[0])).not.toContain('系统第一段')
  })

  it.each(['duplicate', 'mixed-source', 'account', 'tampered'] as const)('rejects %s selections before delivery', async kind => {
    const { service, data, forward, requireSession } = fixture()
    const view = await service.recordingComparison(date)
    const refs = [view.system.items[0]!.itemRef]
    if (kind === 'duplicate') refs.push(refs[0]!)
    if (kind === 'mixed-source') refs.push(view.doubao.items[0]!.itemRef)
    if (kind === 'account') requireSession.mockResolvedValue({ ...session, userId: 43 })
    if (kind === 'tampered') refs[0] = `${refs[0]}broken`
    await expect(service.forwardRecording(input(refs))).rejects.toThrow()
    expect(forward).not.toHaveBeenCalled()
  })

  it('lets the owner confirm a replay even when the Audio read is no longer available', async () => {
    const { service, post, forward } = fixture()
    const view = await service.recordingComparison(date)
    post.mockRejectedValue(new Error('Audio unavailable'))
    const command = input([view.system.items[0]!.itemRef])
    await expect(service.forwardRecording(command)).resolves.toMatchObject({ recordUid: 'sent' })
    forward.mockRejectedValueOnce(new Error('owner: source deleted') as never)
    await expect(service.forwardRecording(command)).rejects.toThrow('owner: source deleted')
  })

  it('rejects cross-session selections and the 150-segment limit before owner writes', async () => {
    const { service, data, forward } = fixture()
    data.session_ls.push({ ...data.session_ls[0]!, id: 'second-session', start_at: date + 30_000, end_at: date + 50_000 })
    data.child_ls.push({ ...data.child_ls[0]!, id: 'second-child', session_id: 'second-session' })
    const view = await service.recordingComparison(date)
    const refs = [view.system.items[0]!.itemRef, view.system.items.at(-1)!.itemRef]
    await expect(service.forwardRecording(input(refs))).rejects.toMatchObject({ code: 'recording-forward-selection-invalid' })
    await expect(service.forwardRecording(input(Array(151).fill(refs[0])))).rejects.toMatchObject({ code: 'recording-forward-selection-invalid' })
    expect(forward).not.toHaveBeenCalled()
  })

  it('maps comparison playback by time within the same audio session', async () => {
    const { service } = fixture(); const view = await service.recordingComparison(date)
    const doubao = view.doubao.items[0]!
    expect(recordingComparisonPlaybackTarget(doubao, view.system.items)).toBe(view.system.items[0])
    expect(recordingComparisonPlaybackTarget({ ...doubao, startAtMillis: date + 11_000 }, view.system.items)).toBe(view.system.items[1])
    expect(recordingComparisonPlaybackTarget({ ...doubao, startAtMillis: date + 50_000 }, view.system.items)).toBeUndefined()
    expect(recordingComparisonPlaybackTarget({ ...doubao, sessionKey: 'other-session' }, view.system.items)).toBeUndefined()
  })
})

it('rejects invalid comment identities and excessive text before any owner write', async () => {
  const { service, forward } = fixture()
  const view = await service.recordingComparison(date)
  const command = input(view.system.items.map(item => item.itemRef))
  for (const invalid of [{ commentText: '附言' }, { commentText: '附言', commentRecordUid: command.recordUid }, { commentText: 'x'.repeat(20001), commentRecordUid: 'a0000000-0000-0000-0000-000000000003' }]) {
    await expect(service.forwardRecording({ ...command, ...invalid })).rejects.toThrow('录音附言')
  }
  expect(forward).not.toHaveBeenCalled()
})

describe('recording destination owner contracts', () => {
  const selection = { sessionId: 'audio-source', segments: [{ childId: 'audio-child', asrItemIndex: 2, transcriptSource: 'system' as const }] }
  const command = input(['sealed-ref'])
  function gateway(kind: string) {
    const chat = vi.fn(async () => ({ record_uid: 'chat-record', seq: 3 }))
    const record = vi.fn(async (path: string) => path.endsWith('/capability') ? { supported: true, protocol_version: 1, max_segments: 150 } : { record_core: { record_uid: command.recordUid } })
    const realtime = { scheduleChatSessionProjection: vi.fn(), invalidateRecordProjection: vi.fn(async () => {}) }
    const comments = { sendSourceText: vi.fn(async () => ({ itemUid: 'comment', localState: 'synced' })) }
    const result = new OwnerRecordingForwardGateway({ authenticatedChatPost: chat, authenticatedPost: record } as unknown as ServiceRuntime,
      { openSourceRef: vi.fn(async () => ({ kind, ownerRef: 'target-owner' })) } as never, realtime, comments as never)
    return { result, chat, record, realtime, comments }
  }

  it('sends audio-session selectors to Chat without pretending they are record IDs', async () => {
    const { result, chat, record } = gateway('private_chat')
    await expect(result.forward(selection, command, session)).resolves.toEqual({ recordUid: 'chat-record' })
    expect(chat).toHaveBeenCalledWith('/api/v1/chats/records/forward', {
      chat_session_uid: 'target-owner', client_request_id: command.requestId, send_at: date,
      source_items: [{ source_type: 'long_recording_segments', source_identity_kind: 'audio_session', session_id: 'audio-source', segment_selection: { kind: 'long_recording_segments', segments: [{ child_id: 'audio-child', asr_item_index: 2, transcript_source: 'system' }] } }],
    }, session, undefined)
    expect(record).not.toHaveBeenCalled()
  })

  it.each(['send_to_self', 'topic'])('uses the gated Record materialization contract for %s', async kind => {
    const { result, chat, record, realtime } = gateway(kind)
    realtime.invalidateRecordProjection.mockRejectedValue(new Error('projection unavailable'))
    await expect(result.forward(selection, command, session)).resolves.toMatchObject({ recordUid: command.recordUid })
    expect(chat).not.toHaveBeenCalled()
    expect(record.mock.calls[1]?.[1]).toMatchObject({ record_uid: command.recordUid, source: { identity_kind: 'audio_session', session_id: 'audio-source' }, ...(kind === 'topic' ? { topic_uid: 'target-owner' } : {}) })
  })

  it('passes Chat comments through its native contract without a separate text send', async () => {
    const { result, chat, comments } = gateway('private_chat')
    await result.forward(selection, { ...command, commentText: ' 附言 ', commentRecordUid: 'a0000000-0000-0000-0000-000000000003' }, session)
    expect(chat.mock.calls[0]?.[1]).toMatchObject({ comment_text: '附言' })
    expect(comments.sendSourceText).not.toHaveBeenCalled()
  })

  it.each(['send_to_self', 'topic'])('keeps the %s card receipt when a separate comment fails and reuses its identity', async kind => {
    const { result, record, comments } = gateway(kind)
    const withComment = { ...command, commentText: '附言', commentRecordUid: 'a0000000-0000-0000-0000-000000000003' }
    comments.sendSourceText.mockRejectedValueOnce(new Error('timeout'))
    await expect(result.forward(selection, withComment, session)).resolves.toEqual({ recordUid: command.recordUid, warningText: '录音已转发，附言发送失败' })
    await result.forward(selection, withComment, session)
    expect(record.mock.calls[1]?.[1]).not.toHaveProperty('comment_text')
    expect(comments.sendSourceText.mock.calls[0]).toEqual(comments.sendSourceText.mock.calls[1])
    expect(comments.sendSourceText).toHaveBeenCalledWith(command.targetSourceRef, '附言', { recordUid: withComment.commentRecordUid, expectedUserId: session.userId })
  })

  it('does not report a failed text result as successful comment delivery', async () => {
    const { result, comments } = gateway('topic')
    comments.sendSourceText.mockResolvedValueOnce({ itemUid: '', localState: 'failed' })
    await expect(result.forward(selection, { ...command, commentText: '附言', commentRecordUid: 'a0000000-0000-0000-0000-000000000003' }, session)).resolves.toHaveProperty('warningText')
  })

  it('fails closed when Record capability or authoritative delivery confirmation is absent', async () => {
    const { result, record } = gateway('topic')
    record.mockResolvedValue({ supported: false } as never)
    await expect(result.forward(selection, command, session)).rejects.toMatchObject({ code: 'recording-forward-target-unavailable' })
    expect(record).toHaveBeenCalledTimes(1)
    const chatGateway = gateway('group_chat'); chatGateway.chat.mockResolvedValue({} as never)
    await expect(chatGateway.result.forward(selection, command, session)).rejects.toMatchObject({ code: 'recording-forward-unconfirmed' })
  })

  it('does not wait for projection invalidation to acknowledge a confirmed write', async () => {
    const { result, realtime } = gateway('topic')
    realtime.invalidateRecordProjection.mockReturnValue(new Promise(() => {}))
    await expect(result.forward(selection, command, session)).resolves.toEqual({ recordUid: command.recordUid })
  })

  it('requires the Record owner receipt rather than guessed alias fields', async () => {
    const { result, record } = gateway('topic')
    record.mockResolvedValueOnce({ supported: true, protocol_version: 1, max_segments: 150 }).mockResolvedValueOnce({ record: { uid: command.recordUid } } as never)
    await expect(result.forward(selection, command, session)).rejects.toMatchObject({ code: 'recording-forward-unconfirmed' })
  })
})
