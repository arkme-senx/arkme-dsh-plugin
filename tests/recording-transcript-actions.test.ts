import { readCompleteRecordingTranscript } from '../src/recording-transcript-page.js'
import { describe, expect, it, vi } from 'vitest'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { createArkmeHostApi } from '../src/host-api.js'
import type { ArkmeService } from '../src/arkme-service.js'
import { RecordingService, type RecordingServiceDependencies } from '../src/services/recording-service.js'
import { OwnerRecordingForwardGateway } from '../src/services/recording-forward-gateway.js'
import type { ServiceRuntime } from '../src/services/service.js'
import type { RecordingForwardInput } from '../src/recording-forward-contract.js'

const date = new Date(2026, 8, 4).getTime()
const session = { userId: 42, accessToken: 'test-access', refreshToken: 'test-refresh' }
const source = () => ({
  session_ls: [{ id: '100000000000000000000001', start_at: date, end_at: date + 20_000, spk_ls: [{ num: 1, spk_id: 'speaker' }] }],
  child_ls: [{ id: '200000000000000000000001', session_id: '100000000000000000000001', start_at: 0, has_asr: true, doubao_asr_status: 3,
    asr: [{ s: 0, e: 4_000, n: 1, t: '系统第一段' }, { s: 5_000, e: 10_000, n: 1, t: '系统第二段' }],
    doubao_asr: [{ s: 500, e: 9_000, n: 1, t: '豆包独立分段', b: 1 }],
  }],
})
const input = (itemRefs: string[]): RecordingForwardInput => ({ itemRefs, targetSourceRef: 'target', requestId: 'a0000000-0000-0000-0000-000000000001', recordUid: 'a0000000-0000-0000-0000-000000000002', sendAtMillis: date })

function fixture() {
  const data = source()
  const forward = vi.fn(async () => ({ recordUid: 'sent' }))
  const media = { issueRecordingPlaybackMediaRef: vi.fn(async () => 'opaque-media') }
  const requireSession = vi.fn(async () => session)
  // These tests exercise sealed forwarding selectors, not backend speaker
  // inference. Supply the semantic owner facts directly for each source.
  const post = vi.fn(async (path: string, body: Record<string, unknown>) => {
    if (path.endsWith('/recordings/query')) return {
      items: data.session_ls.map(row => ({ recording_uid: row.id, status: 'available', start_at: row.start_at, end_at: row.end_at, duration_ms: row.end_at-row.start_at, owner_version: 1 })), has_more: false,
    }
    if (!path.endsWith('/transcript/query')) throw new Error(`unexpected route ${path}`)
    const owner = data.session_ls.find(row => row.id === body.recording_uid)!
    const selected = data.child_ls.filter(child => child.session_id === owner.id).flatMap(child => {
      const rows = body.source === 'primary' ? child.asr : child.doubao_asr
      return rows.map((row, index) => ({ child, row, index }))
    }).sort((a,b) => a.child.start_at+a.row.s-b.child.start_at-b.row.s)
    const offset = Number(body.page_cursor ?? 0)
    const page = selected.slice(offset, offset + Number(body.limit))
    return {
      recording_uid: owner.id, status: 'available', start_at: owner.start_at, revision: 'a'.repeat(64),
      coverage: { ready_count: 1, processing_count: 0, failed_count: 0, silent_count: 0, candidate_count: 0 },
      speakers: page.map(() => ({ reference: 'speaker:aaaaaaaaaaaaaaaa', kind: 'named', label: '本人' })),
      utterances: page.map(({ child, row, index }, position) => ({
        clip_locator: { child_id: child.id, source: body.source, ordinal: index }, start_offset_ms: child.start_at + row.s, end_offset_ms: child.start_at + row.e,
        speaker_index: position, text: row.t, utterance_index: offset + position, text_start_offset: 0, text_end_offset: Array.from(row.t).length, text_total_length: Array.from(row.t).length,
      })), has_more: offset + page.length < selected.length,
      ...(offset + page.length < selected.length ? { next_page_cursor: String(offset + page.length) } : {}),
    }
  })
  const runtime = { subscribeAccountScope: () => () => {}, config: { maxTextLength: 20000 }, requireSession, authenticatedAudioPost: post, stateStore: { uniqueCode: async () => 'test-key' } } as unknown as ServiceRuntime
  const service = new RecordingService(runtime, { media, forwardGateway: { forward, supportsRecordTargets: async () => true } } as unknown as RecordingServiceDependencies)
  return { data, forward, service, requireSession, post, media }

}

describe('recording transcript owner boundaries', () => {
  it('delivers 150 real sealed selectors through the HTTP host without truncating the selection', async () => {
    const { service, data, forward } = fixture()
    data.session_ls[0]!.id = '0123456789abcdef01234567'
    data.child_ls[0]!.session_id = data.session_ls[0]!.id
    data.child_ls[0]!.id = 'abcdef0123456789abcdef01'
    data.child_ls[0]!.asr = Array.from({ length: 150 }, (_, n) => ({ s: n * 100, e: n * 100 + 100, n: 1, t: String(n) }))
    const view = await service.recordingComparison(date)
    expect(view.system.items).toHaveLength(100)
    view.system = await readCompleteRecordingTranscript(view.system, cursor => service.recordingTranscriptPage(date, { cursor }))
    expect(view.system.items).toHaveLength(150)
    expect(view.system.items[0]?.canBindSpeaker).toBe(true)
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
  it('keeps owner IDs sealed and forwards only current selectors in time order', async () => {
    const { service, forward } = fixture()
    const comparison = await service.recordingComparison(date)
    expect(JSON.stringify(comparison)).not.toContain('100000000000000000000001')
    const [first, second] = comparison.system.items
    expect(first?.sessionKey).toBe(comparison.doubao.items[0]?.sessionKey)
    await service.forwardRecording(input([second!.itemRef, first!.itemRef]))
    expect(forward).toHaveBeenCalledWith({ sessionId: '100000000000000000000001', segments: [
      { childId: '200000000000000000000001', asrItemIndex: 0, transcriptSource: 'system' },
      { childId: '200000000000000000000001', asrItemIndex: 1, transcriptSource: 'system' },
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
    data.session_ls.push({ ...data.session_ls[0]!, id: '100000000000000000000002', start_at: date + 30_000, end_at: date + 50_000 })
    data.child_ls.push({ ...data.child_ls[0]!, id: '200000000000000000000002', session_id: '100000000000000000000002' })
    const view = await service.recordingComparison(date)
    const refs = [view.system.items[0]!.itemRef, view.system.items.at(-1)!.itemRef]
    await expect(service.forwardRecording(input(refs))).rejects.toMatchObject({ code: 'recording-forward-selection-invalid' })
    await expect(service.forwardRecording(input(Array(151).fill(refs[0])))).rejects.toMatchObject({ code: 'recording-forward-selection-invalid' })
    expect(forward).not.toHaveBeenCalled()
  })

  it('keeps enhanced playback on its exact locator without depending on primary segmentation', async () => {
    const { service, data, media } = fixture()
    data.child_ls[0]!.asr = []
    const view = await service.recordingComparison(date)
    expect(view.system.items).toEqual([])
    const enhanced = view.doubao.items[0]!
    await expect(service.recordingPlayback(enhanced.itemRef)).resolves.toMatchObject({ playbackRef: 'opaque-media' })
    expect(media.issueRecordingPlaybackMediaRef).toHaveBeenCalledWith({ viewerUserId: 42,
      locator: { child_id: '200000000000000000000001', source: 'enhanced', ordinal: 0 },
    }, undefined)
  })})

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
  const selection = { sessionId: 'audio-source', segments: [{ childId: '200000000000000000000001', asrItemIndex: 2, transcriptSource: 'system' as const }] }
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
      source_items: [{ source_type: 'long_recording_segments', source_identity_kind: 'audio_session', session_id: 'audio-source', segment_selection: { kind: 'long_recording_segments', segments: [{ child_id: '200000000000000000000001', asr_item_index: 2, transcript_source: 'system' }] } }],
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
