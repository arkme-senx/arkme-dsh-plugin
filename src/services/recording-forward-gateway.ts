import type { ArkmeSessionCredentials } from '../keychain-store.js'
import { RECORDING_FORWARD_MAX_SEGMENTS, type RecordingForwardGateway, type RecordingForwardInput, type RecordingForwardReceipt, type RecordingForwardSelection } from '../recording-forward-contract.js'
import type { SourceService } from './source-service.js'
import type { ChatService } from './chat-service.js'
import { ArkmePluginError, ServiceRuntime, objectValue, stringValue } from './service.js'

/** Deliver Audio selectors through each destination owner's native forward contract. */
export class OwnerRecordingForwardGateway implements RecordingForwardGateway {
  constructor(
    private readonly runtime: ServiceRuntime,
    private readonly source: Pick<SourceService, 'openSourceRef'>,
    private readonly realtime: { scheduleChatSessionProjection(sessionUid: string, sequence: number): void; invalidateRecordProjection(): Promise<void> },
    private readonly comments: Pick<ChatService, 'sendSourceText'>,
  ) {}

  async supportsRecordTargets(session: ArkmeSessionCredentials, signal?: AbortSignal): Promise<boolean> {
    const data = await this.runtime.authenticatedPost<Record<string, unknown>>('/api/v1/records/long-recording-forward/capability', {}, session, signal)
    return data.supported === true && Number(data.protocol_version) >= 1 && Number(data.max_segments) >= RECORDING_FORWARD_MAX_SEGMENTS
  }

  async forward(selection: RecordingForwardSelection, input: RecordingForwardInput, session: ArkmeSessionCredentials, signal?: AbortSignal): Promise<RecordingForwardReceipt> {
    const target = await this.source.openSourceRef(input.targetSourceRef, session.userId)
    const segments = selection.segments.map(item => ({ child_id: item.childId, asr_item_index: item.asrItemIndex, transcript_source: item.transcriptSource }))
    if (target.kind === 'private_chat' || target.kind === 'group_chat') {
      const data = await this.runtime.authenticatedChatPost<Record<string, unknown>>('/api/v1/chats/records/forward', {
        chat_session_uid: target.ownerRef,
        client_request_id: input.requestId,
        source_items: [{ source_type: 'long_recording_segments', source_identity_kind: 'audio_session', session_id: selection.sessionId, segment_selection: { kind: 'long_recording_segments', segments } }],
        send_at: input.sendAtMillis,
        ...(input.commentText?.trim() ? { comment_text: input.commentText.trim() } : {}),
      }, session, signal)
      const itemUid = stringValue(data.record_uid).trim()
      if (itemUid === '') throw new ArkmePluginError('recording-forward-unconfirmed', '服务端未确认转发结果，请重试确认', true, 502)
      const sequence = typeof data.seq === 'number' && Number.isSafeInteger(data.seq) && data.seq >= 0 ? data.seq : 0
      this.realtime.scheduleChatSessionProjection(target.ownerRef, sequence)
      return { recordUid: itemUid }
    }
    if (!['send_to_self', 'default_category', 'topic'].includes(target.kind)) throw new ArkmePluginError('recording-forward-target-invalid', '该目标不支持录音转发', false, 400)
    if (!await this.supportsRecordTargets(session, signal)) throw new ArkmePluginError('recording-forward-target-unavailable', '服务端暂不支持向自己或主题转发录音', true, 409)
    const topic = target.kind === 'topic'
    const data = await this.runtime.authenticatedPost<Record<string, unknown>>(topic ? '/api/v1/topics/records/long-recording-forward/create' : '/api/v1/records/long-recording-forward/create', {
      record_uid: input.recordUid,
      ...(topic ? { topic_uid: target.ownerRef } : {}),
      source: { identity_kind: 'audio_session', session_id: selection.sessionId, selection: { kind: 'long_recording_segments', segments } },
      send_at: input.sendAtMillis,
    }, session, signal)
    const core = objectValue(data.record_core)
    const itemUid = stringValue(core.record_uid).trim()
    if (itemUid !== input.recordUid) throw new ArkmePluginError('recording-forward-unconfirmed', '服务端未确认转发结果，请重试确认', true, 502)
    // A projection refresh failure must not turn a confirmed delivery into a failed send.
    void this.realtime.invalidateRecordProjection().catch(() => {})
    if (input.commentText?.trim()) {
      try {
        const comment = await this.comments.sendSourceText(input.targetSourceRef, input.commentText.trim(), {
          recordUid: input.commentRecordUid!, expectedUserId: session.userId, ...(signal === undefined ? {} : { signal }),
        })
        if (comment.localState === 'failed') throw new Error('comment-unconfirmed')
      } catch {
        return { recordUid: itemUid, warningText: '录音已转发，附言发送失败' }
      }
    }
    return { recordUid: itemUid }
  }
}
