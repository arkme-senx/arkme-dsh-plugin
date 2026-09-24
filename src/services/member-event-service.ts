import { createHmac, timingSafeEqual } from 'node:crypto'
import type { ArkmeSessionCredentials } from '../keychain-store.js'
import type { ArkmeMemberEvent, ArkmeMemberEventPage, ArkmeMemberEventProfile, ArkmeMemberEventQuery, ArkmeOpenPrivateChatResult } from '../types.js'
import { ProfileService } from './profile-service.js'
import { SourceService } from './source-service.js'
import { ArkmePluginError, ServiceRuntime, objectValue, stringValue } from './service.js'

const CURSOR_PREFIX = 'arkme-member-event-cursor-v1'

export class MemberEventService {
  constructor(
    private readonly runtime: ServiceRuntime,
    private readonly source: SourceService,
    private readonly profile: ProfileService,
    private readonly openPrivate: (userId: number, options: { presentationDisplayName: string; expectedViewerUserId: number; signal?: AbortSignal }) => Promise<ArkmeOpenPrivateChatResult>,
  ) {}

  private async context(sourceRef: string) {
    const session = await this.runtime.requireSession()
    const source = await this.source.openSourceRef(sourceRef, session.userId)
    if (source.kind !== 'group_chat') throw new ArkmePluginError('member-events-source-invalid', '仅支持群聊成员动态', false)
    return { session, group: source.ownerRef }
  }

  private async post(session: ArkmeSessionCredentials, path: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>> {
    try {
      return await this.runtime.authenticatedChatPost<Record<string, unknown>>(path, body, session, signal, {
        lane: 'interactive-read', key: `member-events:${JSON.stringify(body)}`, failureCooldownMs: 2_000,
      })
    } catch (error) {
      if (error instanceof ArkmePluginError && ['arkme-code-2001', 'arkme-code-2002'].includes(error.code)) {
        throw new ArkmePluginError('member-events-unavailable', '当前无法查看该群的成员动态', false, 403, { cause: error })
      }
      throw error
    }
  }

  async list(sourceRef: string, query: ArkmeMemberEventQuery, signal?: AbortSignal): Promise<ArkmeMemberEventPage> {
    const { session, group } = await this.context(sourceRef)
    if (!Number.isSafeInteger(query.fromAtMillis) || query.fromAtMillis < 0
      || !Number.isSafeInteger(query.toAtMillis) || query.toAtMillis < query.fromAtMillis || query.toAtMillis <= 0) {
      throw new ArkmePluginError('member-events-window-invalid', '成员动态时间范围无效', false)
    }
    let cursor = ''
    if (query.cursor !== undefined) {
      const parts = query.cursor.split('.')
      const encoded = parts[1] ?? ''
      const signature = parts[2] ?? ''
      const expected = createHmac('sha256', await this.runtime.stateStore.uniqueCode()).update(encoded).digest('base64url')
      if (query.cursor.length > 4096 || parts.length !== 3 || parts[0] !== CURSOR_PREFIX || signature.length !== expected.length
        || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw this.invalidCursor()
      let value: Record<string, unknown>
      try { value = objectValue(JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))) }
      catch { throw this.invalidCursor() }
      if (value.user !== session.userId || value.group !== group || value.from !== query.fromAtMillis || value.to !== query.toAtMillis) throw this.invalidCursor()
      cursor = stringValue(value.cursor)
      if (cursor === '') throw this.invalidCursor()
    }
    const data = await this.post(session, '/api/v1/chats/members/events/query', {
      chat_session_uid: group, event_type: 'left', from_at: query.fromAtMillis, to_at: query.toAtMillis,
      limit: Math.min(100, Math.max(1, Math.trunc(query.limit ?? 50))), ...(cursor === '' ? {} : { cursor }),
    }, signal)
    if (!Array.isArray(data.items) || typeof data.has_more !== 'boolean') throw this.invalidResponse()
    const items = data.items.map(value => this.project(objectValue(value), group))
    if (data.has_more !== true) return { items, hasMore: false }
    const next = stringValue(data.next_cursor)
    if (next === '') throw this.invalidResponse()
    const encoded = Buffer.from(JSON.stringify({ user: session.userId, group, from: query.fromAtMillis, to: query.toAtMillis, cursor: next })).toString('base64url')
    const signature = createHmac('sha256', await this.runtime.stateStore.uniqueCode()).update(encoded).digest('base64url')
    return { items, hasMore: true, nextCursor: `${CURSOR_PREFIX}.${encoded}.${signature}` }
  }

  private project(data: Record<string, unknown>, group: string): ArkmeMemberEvent {
    if (data.chat_session_uid !== group || data.event_type !== 'left' || typeof data.event_id !== 'string' || data.event_id.trim() === ''
      || !Number.isSafeInteger(data.occurred_at) || Number(data.occurred_at) <= 0) throw this.invalidResponse()
    return { eventId: data.event_id, type: 'left', occurredAtMillis: Number(data.occurred_at), displayName: stringValue(data.display_name_snapshot).trim() || '群成员' }
  }

  private async detail(sourceRef: string, eventId: string, signal?: AbortSignal) {
    const { session, group } = await this.context(sourceRef)
    if (eventId.trim() === '' || eventId.length > 128) throw this.invalidResponse()
    const data = await this.post(session, '/api/v1/chats/members/events/detail', { chat_session_uid: group, event_id: eventId }, signal)
    const event = this.project(data, group)
    const userId = Number(data.member_user_id)
    if (event.eventId !== eventId || !Number.isSafeInteger(userId) || userId <= 0) throw this.invalidResponse()
    return { session, event, userId }
  }

  async memberProfile(sourceRef: string, eventId: string, signal?: AbortSignal): Promise<ArkmeMemberEventProfile> {
    const { session, event, userId } = await this.detail(sourceRef, eventId, signal)
    const profile = (await this.profile.publicProfileSummariesByUserIds([userId], session, signal).catch(error => {
      if (signal?.aborted === true) throw error
      return new Map()
    })).get(userId)
    return {
      displayName: profile?.displayName.trim() || event.displayName,
      memberName: event.displayName,
      ...(profile?.avatarUrl === undefined ? {} : { avatarRef: await this.profile.sealProfileImageRef(session.userId, userId) }),
    }
  }

  async openPrivateChat(sourceRef: string, eventId: string, signal?: AbortSignal): Promise<ArkmeOpenPrivateChatResult> {
    const { session, event, userId } = await this.detail(sourceRef, eventId, signal)
    return await this.openPrivate(userId, { presentationDisplayName: event.displayName, expectedViewerUserId: session.userId,
      ...(signal === undefined ? {} : { signal }) })
  }

  private invalidCursor() { return new ArkmePluginError('member-events-cursor-invalid', '成员动态分页已失效，请重新进入群聊', false) }
  private invalidResponse() { return new ArkmePluginError('member-events-contract-invalid', '成员动态响应无效', false, 502) }
}
