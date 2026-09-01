import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import type { ArkmeSessionCredentials } from '../keychain-store.js'
import type {
  MessageActionCapabilityCodec,
  MessageActionGateway,
  MessageActionReference,
  MessageActionTarget,
} from '../message-action-contract.js'
import type { ArkmeMessageCopyLinkResult, ArkmeSourceSendResult } from '../types.js'
import { ArkmePluginError, objectValue, stringValue, type ServiceRuntime } from './service.js'
import type { ArkmeSourceRefPayload, SourceService } from './source-service.js'

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

export class LocalMessageActionCapabilityCodec implements MessageActionCapabilityCodec {
  constructor(private readonly uniqueCode: () => Promise<string>) {}

  async seal(prefix: string, payload: unknown): Promise<string> {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', await this.key(prefix), iv)
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()])
    return `${prefix}.${iv.toString('base64url')}.${encrypted.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}`
  }

  async open(prefix: string, value: string): Promise<Record<string, unknown>> {
    const parts = value.trim().split('.')
    if (parts.length !== 4 || parts[0] !== prefix) {
      throw new ArkmePluginError('message-action-ref-invalid', '消息操作引用无效', false, 400)
    }
    try {
      const decipher = createDecipheriv('aes-256-gcm', await this.key(prefix), Buffer.from(parts[1] ?? '', 'base64url'))
      decipher.setAuthTag(Buffer.from(parts[3] ?? '', 'base64url'))
      const encoded = Buffer.concat([
        decipher.update(Buffer.from(parts[2] ?? '', 'base64url')),
        decipher.final(),
      ]).toString('utf8')
      return objectValue(JSON.parse(encoded) as unknown)
    } catch (error) {
      throw new ArkmePluginError('message-action-ref-invalid', '消息操作引用无效', false, 400, { cause: error })
    }
  }

  private async key(prefix: string): Promise<Buffer> {
    return createHash('sha256').update(await this.uniqueCode()).update(`\0${prefix}`).digest()
  }
}

export class ArkmeMessageActionGateway implements MessageActionGateway {
  constructor(
    private readonly runtime: ServiceRuntime,
    private readonly source: SourceService,
    private readonly onForwarded?: (target: ArkmeSourceRefPayload, sequence?: number) => void | Promise<void>,
  ) {}

  async requireSession(): Promise<ArkmeSessionCredentials> { return await this.runtime.requireSession() }

  maxTextLength(): number { return this.runtime.config.maxTextLength }

  async openTarget(targetSourceRef: string, userId: number): Promise<MessageActionTarget> {
    const target = await this.source.openSourceRef(targetSourceRef, userId)
    if (!['private_chat', 'group_chat', 'send_to_self', 'default_category', 'topic'].includes(target.kind)) {
      throw new ArkmePluginError('message-actions-source-invalid', '当前目标暂不支持转发', false, 409)
    }
    return target as MessageActionTarget
  }

  async createCopyLink(
    references: readonly MessageActionReference[],
    session: ArkmeSessionCredentials,
    signal?: AbortSignal,
  ): Promise<ArkmeMessageCopyLinkResult> {
    const data = await this.runtime.authenticatedChatPost<Record<string, unknown>>(
      '/api/v1/chats/messages/copy-link/get-or-create',
      { sources: references.map(reference => this.copyLinkSource(reference)) },
      session,
      signal,
    )
    const sid = stringValue(data.sid).trim()
    const url = stringValue(data.url).trim()
    if (sid === '' || !/^https?:\/\//i.test(url)) {
      throw new ArkmePluginError('message-copy-link-response-invalid', '复制链接失败，请稍后重试', true, 502)
    }
    return { sid, url }
  }

  async forwardToChat(input: Parameters<MessageActionGateway['forwardToChat']>[0]): Promise<ArkmeSourceSendResult> {
    const data = await this.runtime.authenticatedChatPost<Record<string, unknown>>(
      '/api/v1/chats/records/forward', {
        chat_session_uid: input.target.ownerRef,
        client_request_id: input.requestId,
        source_items: input.references.map(reference => this.chatForwardSourceItem(reference)),
        ...(input.commentText === '' ? {} : { comment_text: input.commentText }),
        send_at: input.sendAtMillis,
      }, input.session, input.signal,
    )
    const sequence = Math.trunc(numberValue(data.seq ?? data.sequence))
    const forwardedRecordUid = stringValue(data.record_uid).trim()
    if (forwardedRecordUid === '') {
      throw new ArkmePluginError('message-actions-forward-outcome-unknown', '转发结果尚未确认，请使用原请求重试', false, 409)
    }
    try { await this.onForwarded?.(input.target as ArkmeSourceRefPayload, sequence > 0 ? sequence : undefined) } catch { /* delivery already succeeded */ }
    return {
      sourceRef: input.targetSourceRef,
      itemUid: forwardedRecordUid,
      status: Math.trunc(numberValue(data.audit_status ?? data.status)) || 1,
      ...(sequence > 0 ? { sequence } : {}),
      localState: 'synced',
    }
  }

  async forwardToRecord(input: Parameters<MessageActionGateway['forwardToRecord']>[0]): Promise<ArkmeSourceSendResult> {
    const contentPayload = this.recordForwardPayload(input.references, input.requestId, input.sendAtMillis)
    const title = input.references.length === 1 ? '转发快记' : `转发 ${String(input.references.length)} 条快记`
    const data = input.target.kind === 'topic'
      ? await this.runtime.authenticatedPost<Record<string, unknown>>(
        '/api/v1/topics/records/create', {
          topic_uid: input.target.ownerRef, record_uid: input.recordUid, template_kind: 1, title: '',
          text_content: title, content_payload: contentPayload, send_at: input.sendAtMillis,
        }, input.session, input.signal,
      )
      : await this.runtime.authenticatedPost<Record<string, unknown>>(
        '/api/v1/records/create', {
          record_uid: input.recordUid, template_kind: 1, title: '', text_content: title,
          content_payload: contentPayload, send_at: input.sendAtMillis,
        }, input.session, input.signal,
      )
    this.source.invalidateSourceListCache(input.session.userId, 'send_to_self')
    try { await this.onForwarded?.(input.target as ArkmeSourceRefPayload) } catch { /* delivery already succeeded */ }
    return {
      sourceRef: input.targetSourceRef,
      itemUid: stringValue(data.record_uid).trim() || input.recordUid,
      status: Math.trunc(numberValue(data.status)) || 1,
      localState: 'synced',
    }
  }

  async createRecordTargetComment(input: Parameters<MessageActionGateway['createRecordTargetComment']>[0]): Promise<void> {
    const body = {
      record_uid: input.recordUid, template_kind: 1, title: '', text_content: input.textContent, send_at: input.sendAtMillis,
    }
    if (input.target.kind === 'topic') {
      await this.runtime.authenticatedPost(
        '/api/v1/topics/records/create', { ...body, topic_uid: input.target.ownerRef }, input.session, input.signal,
      )
    } else {
      await this.runtime.authenticatedPost('/api/v1/records/create', body, input.session, input.signal)
    }
  }

  private copyLinkSource(reference: MessageActionReference): Record<string, unknown> {
    if (reference.ownerKind === 'agent') {
      if (reference.role === 'assistant') return {
        kind: 'agent_message', agent_session_id: reference.agentSessionId, agent_message_id: reference.agentMessageId,
      }
      return { kind: 'record', record_owner_user_id: reference.userId, record_uid: reference.entryRecordUid }
    }
    if (reference.ownerKind === 'bot_chat') return {
      kind: 'chat_relation', chat_session_uid: reference.chatSessionUid, relation_uid: reference.relationUid,
    }
    return { kind: 'record', record_owner_user_id: reference.userId, record_uid: reference.recordUid }
  }

  private chatForwardSourceItem(reference: MessageActionReference): Record<string, unknown> {
    if (reference.ownerKind === 'agent') return {
      source_type: 'agent', render_format: 'markdown', source_identity_kind: 'agent_message',
      source_identity_id: `${String(reference.agentSessionId)}:${reference.messageIdentity}`,
      snapshot_text: reference.textContent, source_sender_user_id: reference.senderUserId,
      ...(reference.entryRecordUid === undefined ? {} : { record_uid: reference.entryRecordUid }),
    }
    if (reference.ownerKind === 'bot_chat') return {
      source_type: 'chat_record', record_uid: reference.recordUid, source_chat_session_uid: reference.chatSessionUid,
      source_rel_uid: reference.relationUid, source_seq: reference.sequence,
    }
    return { source_type: 'record', record_uid: reference.recordUid }
  }

  private recordForwardPayload(
    references: readonly MessageActionReference[],
    requestId: string,
    sendAtMillis: number,
  ): Record<string, unknown> {
    const sourceRecordUids = references.flatMap(reference => reference.ownerKind === 'agent' ? [] : [reference.recordUid])
    return {
      payload_kind: 1,
      schema_version: 1,
      text_state: 1,
      forward_records: {
        render_kind: 'forward_records', schema_version: 1, forward_id: requestId,
        source_type: references[0]?.ownerKind === 'agent' ? 'agent' : 'quick_records',
        title: '转发快记', source_record_uids: sourceRecordUids, created_at: sendAtMillis,
        summary_lines: references.slice(0, 3).map(reference => `${reference.senderName}: ${reference.textContent.trim().slice(0, 500)}`),
        items: references.map((reference, index) => ({
          item_order: index,
          source_kind: reference.ownerKind === 'agent' ? 'agent_message' : reference.ownerKind === 'bot_chat' ? 'chat_relation' : 'record',
          source_type: reference.ownerKind === 'agent' ? 'agent' : reference.ownerKind === 'bot_chat' ? 'chat_record' : 'record',
          ...(reference.ownerKind === 'agent' ? {
            render_format: 'markdown', source_identity_kind: 'agent_message',
            source_identity_id: `${String(reference.agentSessionId)}:${reference.messageIdentity}`,
            ...(reference.entryRecordUid === undefined ? {} : { record_uid: reference.entryRecordUid }),
          } : { record_uid: reference.recordUid }),
          ...(reference.ownerKind === 'bot_chat' ? {
            source_rel_uid: reference.relationUid, source_chat_session_uid: reference.chatSessionUid, source_seq: reference.sequence,
          } : {}),
          ...(reference.ownerKind === 'agent' && reference.entryRecordUid !== undefined ? { owner_id: reference.userId } : {}),
          ...(reference.ownerKind === 'bot_subject' && reference.role === 'user' ? { owner_id: reference.userId } : {}),
          source_sender_user_id: reference.senderUserId,
          source_display_name: reference.senderName,
          owner_name: reference.senderName,
          send_at: reference.createdAtMillis,
          template_kind: 1,
          display_kind: 0,
          text: reference.textContent,
          text_preview: reference.textContent.trim().slice(0, 500),
        })),
      },
    }
  }
}
