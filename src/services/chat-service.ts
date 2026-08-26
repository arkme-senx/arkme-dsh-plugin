import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import type { ArkmeSessionCredentials } from '../keychain-store.js'
import type {
  ArkmeConversationMemberJoinEvent,
  ArkmeConversationMemberItem,
  ArkmeConversationMemberList,
  ArkmeConversationMemberRecordMode,
  ArkmeConversationMemberRecordPage,
  ArkmeDirectTextSendResult,
  ArkmeForwardRecordPreviewItem,
  ArkmeGroupAiPolishNotice,
  ArkmeGroupAiPolishSnapshot,
  ArkmeGroupMemberRole,
  ArkmeGroupMemberStatus,
  ArkmeHumanMentionInput,
  ArkmeLongArticleDetail,
  ArkmeLongArticleDraft,
  ArkmeMessageReadReceiptDetail,
  ArkmeMessageReadReceiptQueryItem,
  ArkmeMessageReadReceiptSummary,
  ArkmeMessageReadReceiptSummaryList,
  ArkmeMessageReportResult,
  ArkmeOfficialAuthorProfile,
  ArkmeOpenPrivateChatResult,
  ArkmeRichSendInput,
  ArkmeSourceItem,
  ArkmeSourceReadResult,
  ArkmeSourceSendResult,
  ArkmeTimelineCursor,
  ArkmeTimelineItem,
  ArkmeTimelinePage,
  ArkmeUploadedAsset,
} from '../types.js'
import { ARKME_MESSAGE_READ_RECEIPT_MAX_ITEMS } from '../types.js'
import { ArkoService } from './arko-service.js'
import { BotService } from './bot-service.js'
import { GroupAiPolishService } from './group-ai-polish-service.js'
import { MediaService, type ArkmeMediaDescriptor } from './media-service.js'
import { ProfileService } from './profile-service.js'
import { RecordService } from './record-service.js'
import { ArkmePluginError, ServiceRuntime, objectValue, stringValue } from './service.js'
import { SourceService, type ArkmeSourceRefPayload } from './source-service.js'

interface ArkmeMessageRefPayload {
  version: 1
  userId: number
  chatSessionUid: string
  relationUid: string
}

interface ArkmeChatMemberRefPayload {
  version: 1
  viewerUserId: number
  chatSessionUid: string
  targetUserId: number
}

interface OfficialAuthorPrivateChatCreateResult {
  rm_subject_id?: unknown
  already_exist?: unknown
}

// Mirrors the mobile contact-author backend contract used by /api/v1/private/create-chat-ref-asen.
const OFFICIAL_AUTHOR_USER_ID = 11
const OFFICIAL_AUTHOR_FALLBACK_DISPLAY_NAME = '即' + '我作者'

export interface ArkmeChatRealtimePort {
  emitChatClientEvent(event: Parameters<import('./chat-realtime-service.js').ChatRealtimeService['emitChatClientEvent']>[0]): void
  nextChatClientRevision(): number
  scheduleChatSessionProjection(chatSessionUid: string, latestSequence: number): void
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function booleanValue(value: unknown): boolean { return value === true }
function listValue(value: unknown): unknown[] { return Array.isArray(value) ? value : [] }

function chatMemberRole(value: unknown): ArkmeGroupMemberRole {
  if (value === 'owner' || value === 1) return 'owner'
  if (value === 'admin' || value === 2) return 'admin'
  if (value === 'member' || value === 'participant' || value === 3) return 'member'
  return 'unknown'
}

function chatMemberStatus(value: unknown): ArkmeGroupMemberStatus {
  if (value === 'active' || value === 1) return 'active'
  if (value === 'left' || value === 2) return 'left'
  if (value === 'removed' || value === 3) return 'removed'
  return 'unknown'
}

function integerLikeValue(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value.trim())
    if (Number.isFinite(parsed)) return Math.trunc(parsed)
  }
  return 0
}

function optionalString(value: unknown): string | undefined {
  const text = stringValue(value).trim()
  return text === '' ? undefined : text
}

function parsedObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string') return objectValue(value)
  const raw = value.trim()
  if (raw === '') return {}
  try { return objectValue(JSON.parse(raw)) }
  catch { return {} }
}

function firstInteger(source: Record<string, unknown>, keys: readonly string[]): number {
  for (const key of keys) {
    const value = integerLikeValue(source[key])
    if (value > 0) return value
  }
  return 0
}

function normalizedJoinDisplayName(value: unknown): string {
  const text = stringValue(value).replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim()
  return text.length <= 128 ? text : text.slice(0, 128).trimEnd()
}

function firstJoinDisplayName(source: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = normalizedJoinDisplayName(source[key])
    if (value !== '') return value
  }
  return ''
}

interface ChatMemberDisplayNames {
  displayName: string
  memberName: string
  secondaryName: string
}

function resolveChatMemberDisplayNames(input: {
  userId: number
  remarkCandidates?: readonly unknown[]
  memberNameCandidates?: readonly unknown[]
  userNameCandidates?: readonly unknown[]
}): ChatMemberDisplayNames {
  const isUsable = (value: string): boolean => value !== ''
    && value !== '成员'
    && value !== '群成员'
    && value !== `用户 ${String(input.userId)}`
  const firstUsable = (values: readonly unknown[]): string => values
    .map(normalizedJoinDisplayName)
    .find(isUsable) ?? ''
  const remarkName = firstUsable(input.remarkCandidates ?? [])
  const memberName = firstUsable(input.memberNameCandidates ?? [])
  const userName = firstUsable(input.userNameCandidates ?? [])
  const displayName = [remarkName, memberName, userName].find(isUsable) ?? '群成员'
  const secondaryName = [memberName, userName, remarkName]
    .find(value => isUsable(value) && value !== displayName) ?? ''
  return { displayName, memberName, secondaryName }
}

function normalizedJoinTimestamp(value: unknown): number {
  const raw = integerLikeValue(value)
  if (raw <= 0) return 0
  return raw < 100_000_000_000 ? raw * 1_000 : raw
}

function rawMemberDisplayName(item: Record<string, unknown>): string {
  return firstJoinDisplayName(item, ['remark', 'display_name_snapshot', 'displayNameSnapshot', 'display_name', 'displayName'])
}

interface ArkmeJoinEventProjectionOptions {
  viewerUserId: number
  memberRefForUserId(userId: number): Promise<string>
  eventIdForStableKey(stableKey: string): Promise<string>
}

interface MutableJoinEventGroup {
  action: ArkmeConversationMemberJoinEvent['action']
  occurredAtMillis: number
  inviterUserId: number
  inviterDisplayName: string
  inviteesByUserId: Map<number, string>
}

/** Converts allowlisted member join metadata into a Browser-safe projection. */
export async function projectArkmeConversationMemberJoinEvents(
  rawItems: readonly Record<string, unknown>[],
  options: ArkmeJoinEventProjectionOptions,
): Promise<ArkmeConversationMemberJoinEvent[]> {
  const membersByUserId = new Map<number, Record<string, unknown>>()
  for (const item of rawItems) {
    const userId = integerLikeValue(item.user_id ?? item.userId)
    if (userId > 0) membersByUserId.set(userId, item)
  }
  const groups = new Map<string, MutableJoinEventGroup>()
  for (const item of rawItems) {
    const inviteeUserId = integerLikeValue(item.user_id ?? item.userId)
    if (inviteeUserId <= 0) continue
    const extra = parsedObject(item.extra)
    if (Object.keys(extra).length === 0) continue
    const nestedInviter = ['inviter', 'invite_source', 'join_source']
      .map(key => parsedObject(extra[key])).find(value => Object.keys(value).length > 0) ?? {}
    const inviterUserId = firstInteger(extra, [
      'inviter_user_id', 'inviter_id', 'invite_from_user_id', 'creator_user_id', 'creator',
    ]) || firstInteger(nestedInviter, ['user_id', 'owner_id', 'sid', 'id', 'creator_user_id'])
    const inviterDisplayName = firstJoinDisplayName(extra, [
      'inviter_display_name', 'inviter_name', 'invite_from_display_name', 'creator_display_name', 'creator_name',
    ]) || firstJoinDisplayName(nestedInviter, ['display_name', 'nick_name', 'nickname', 'name'])
      || rawMemberDisplayName(membersByUserId.get(inviterUserId) ?? {})
    if (inviterUserId <= 0 && inviterDisplayName === '') continue
    const occurredAtMillis = normalizedJoinTimestamp(
      extra.join_batch_at ?? extra.join_tip_at ?? extra.join_event_at ?? item.join_at ?? item.joinAt,
    )
    if (occurredAtMillis <= 0) continue
    const inviteeDisplayName = firstJoinDisplayName(extra, [
      'invitee_display_name', 'joined_display_name', 'join_display_name',
    ]) || rawMemberDisplayName(item)
    if (inviteeDisplayName === '') continue
    const sourceType = firstJoinDisplayName(extra, [
      'join_source_type', 'join_action', 'source_type', 'action',
    ]).toLowerCase()
    const action: ArkmeConversationMemberJoinEvent['action'] = new Set([
      'direct_add', 'add_member', 'add_members', 'manual_add', 'added_by_member',
    ]).has(sourceType) ? 'direct_add' : 'invite'
    const inviterKey = inviterUserId > 0 ? `id:${String(inviterUserId)}` : `name:${inviterDisplayName}`
    const groupKey = `${String(occurredAtMillis)}|${action}|${inviterKey}`
    const group = groups.get(groupKey) ?? {
      action,
      occurredAtMillis,
      inviterUserId,
      inviterDisplayName,
      inviteesByUserId: new Map<number, string>(),
    }
    group.inviteesByUserId.set(inviteeUserId, inviteeDisplayName)
    groups.set(groupKey, group)
  }
  const projected: ArkmeConversationMemberJoinEvent[] = []
  for (const [groupKey, group] of groups) {
    const invitees = [...group.inviteesByUserId.entries()]
      .sort((left, right) => (left[1] < right[1] ? -1 : left[1] > right[1] ? 1 : left[0] - right[0]))
    if (invitees.length === 0) continue
    const stableKey = `${groupKey}|${invitees.map(([userId]) => userId).join(',')}`
    projected.push({
      eventId: await options.eventIdForStableKey(stableKey),
      action: group.action,
      occurredAtMillis: group.occurredAtMillis,
      inviter: {
        ...(group.inviterUserId > 0 && membersByUserId.has(group.inviterUserId)
          ? { memberRef: await options.memberRefForUserId(group.inviterUserId) }
          : {}),
        displayName: group.inviterDisplayName,
        isSelf: group.inviterUserId > 0 && group.inviterUserId === options.viewerUserId,
      },
      invitees: await Promise.all(invitees.map(async ([userId, displayName]) => ({
        memberRef: await options.memberRefForUserId(userId),
        displayName,
        isSelf: userId === options.viewerUserId,
      }))),
    })
  }
  projected.sort((left, right) => left.occurredAtMillis - right.occurredAtMillis
    || (left.inviter.displayName < right.inviter.displayName ? -1 : left.inviter.displayName > right.inviter.displayName ? 1 : 0)
    || left.eventId.localeCompare(right.eventId))
  return projected
}

function isAgentAuthoredChatSend(options: { agentAuthored?: boolean }): boolean {
  return options.agentAuthored === true
}

function normalizedAgentDisplayName(displayName: string | undefined): string | undefined {
  const normalized = displayName?.replace(/[\u0000-\u001F\u007F]/g, ' ').trim()
  if (normalized === undefined || normalized === '') return undefined
  return normalized.length <= 64 ? normalized : normalized.slice(0, 64).trimEnd()
}

function agentSourceLabel(displayName: string): string {
  const normalized = normalizedAgentDisplayName(displayName) ?? 'Agent'
  return normalized + '代发'
}

function isAgentCreationSource(
  relation: Record<string, unknown>,
  record: Record<string, unknown>,
  payload: Record<string, unknown>,
): boolean {
  const relationMetadata = objectValue(relation.metadata)
  const recordMetadata = objectValue(record.metadata)
  return integerLikeValue(payload.creation_source ?? payload.creationSource) === 1
    || integerLikeValue(record.creation_source ?? record.creationSource) === 1
    || integerLikeValue(relation.creation_source ?? relation.creationSource) === 1
    || integerLikeValue(recordMetadata.creation_source ?? recordMetadata.creationSource) === 1
    || integerLikeValue(relationMetadata.creation_source ?? relationMetadata.creationSource) === 1
}

function agentDisplayNameFromTimeline(
  relation: Record<string, unknown>,
  record: Record<string, unknown>,
  payload: Record<string, unknown>,
): string {
  const relationMetadata = objectValue(relation.metadata)
  const recordMetadata = objectValue(record.metadata)
  const profile = objectValue(
    payload.agent_profile ?? payload.agentProfile ?? payload.agent
    ?? record.agent_profile ?? record.agentProfile ?? record.agent
    ?? recordMetadata.agent_profile ?? recordMetadata.agentProfile ?? recordMetadata.agent
    ?? relation.agent_profile ?? relation.agentProfile ?? relation.agent
    ?? relationMetadata.agent_profile ?? relationMetadata.agentProfile ?? relationMetadata.agent
  )
  return optionalString(payload.agent_display_name)
    ?? optionalString(payload.agentDisplayName)
    ?? optionalString(payload.agent_name)
    ?? optionalString(payload.agentName)
    ?? optionalString(record.agent_display_name)
    ?? optionalString(record.agentDisplayName)
    ?? optionalString(record.agent_name)
    ?? optionalString(record.agentName)
    ?? optionalString(recordMetadata.agent_display_name)
    ?? optionalString(recordMetadata.agentDisplayName)
    ?? optionalString(recordMetadata.agent_name)
    ?? optionalString(recordMetadata.agentName)
    ?? optionalString(relationMetadata.agent_display_name)
    ?? optionalString(relationMetadata.agentDisplayName)
    ?? optionalString(relationMetadata.agent_name)
    ?? optionalString(relationMetadata.agentName)
    ?? optionalString(profile.display_name)
    ?? optionalString(profile.displayName)
    ?? optionalString(profile.name)
    ?? 'Agent'
}

function timelineAgentSource(
  relation: Record<string, unknown>,
  record: Record<string, unknown>,
  payload: Record<string, unknown>,
): ArkmeTimelineItem['agentSource'] | undefined {
  if (!isAgentCreationSource(relation, record, payload)) return undefined
  const displayName = agentDisplayNameFromTimeline(relation, record, payload)
  return { kind: 'agent', displayName, label: agentSourceLabel(displayName) }
}

function encodeOpaqueJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

function decodeOpaqueJson(value: string): unknown {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown
}

export class ChatService {
  constructor(
    private readonly runtime: ServiceRuntime,
    private readonly source: SourceService,
    private readonly profile: ProfileService,
    private readonly media: MediaService,
    private readonly record: RecordService,
    private readonly bot: BotService,
    private readonly arko: ArkoService,
    private readonly aiPolish: GroupAiPolishService,
    private readonly realtime: ArkmeChatRealtimePort,
  ) {}

  async listSourceMembers(
    sourceRef: string,
    options: { activeOnly?: boolean; signal?: AbortSignal } = {},
  ): Promise<ArkmeConversationMemberList> {
    const session = await this.runtime.requireSession()
    const source = await this.source.openSourceRef(sourceRef, session.userId)
    if (source.kind !== 'group_chat' && source.kind !== 'private_chat') {
      throw new ArkmePluginError('chat-members-source-invalid', '仅支持查看群聊或私聊成员', false)
    }
    const activeOnly = options.activeOnly !== false
    const joinEventsEnabled = source.kind === 'group_chat' && this.runtime.config.chatMemberJoinEventsEnabled !== false
    const rawItems = await this.rawChatMembers(source.ownerRef, joinEventsEnabled ? false : activeOnly, session, options.signal)
    const visibleRawItems = activeOnly
      ? rawItems.filter(item => chatMemberStatus(item.status) === 'active')
      : rawItems
    const members = await this.projectChatMembers(source.ownerRef, visibleRawItems, session, options.signal)
    const signingKey = joinEventsEnabled ? await this.runtime.stateStore.uniqueCode() : ''
    const joinEvents = joinEventsEnabled
      ? await projectArkmeConversationMemberJoinEvents(rawItems, {
        viewerUserId: session.userId,
        memberRefForUserId: async userId => await this.sealChatMemberRef(session.userId, source.ownerRef, userId),
        eventIdForStableKey: async stableKey => `arkme-chat-join-v1.${createHmac('sha256', signingKey)
          .update(`${String(session.userId)}|${source.ownerRef}|${stableKey}`).digest('base64url')}`,
      })
      : undefined
    return {
      source: await this.source.sourceItem(source),
      items: members,
      total: members.length,
      activeCount: members.filter(item => item.status === 'active').length,
      ...(joinEvents === undefined ? {} : { joinEvents }),
    }
  }

  async sourceMemberRecords(
    sourceRef: string,
    memberRef: string,
    mode: ArkmeConversationMemberRecordMode,
    options: { limit?: number; beforeSequence?: number; signal?: AbortSignal } = {},
  ): Promise<ArkmeConversationMemberRecordPage> {
    const session = await this.runtime.requireSession()
    const source = await this.source.openSourceRef(sourceRef, session.userId)
    if (source.kind !== 'group_chat' && source.kind !== 'private_chat') {
      throw new ArkmePluginError('chat-members-source-invalid', '仅支持查看群聊或私聊成员快记', false)
    }
    if (mode !== 'owner' && mode !== 'mentioned') {
      throw new ArkmePluginError('chat-member-record-mode-invalid', '成员快记模式无效', false)
    }
    const reference = await this.openChatMemberRef(memberRef, session.userId, source.ownerRef)
    const rawMembers = await this.rawChatMembers(source.ownerRef, false, session, options.signal)
    const members = await this.projectChatMembers(source.ownerRef, rawMembers, session, options.signal)
    const member = members.find(item => item.memberRef === memberRef)
    if (member === undefined) {
      throw new ArkmePluginError('chat-member-ref-stale', '该成员已不属于当前会话，请刷新后重试', false, 409)
    }
    const limit = Math.min(50, Math.max(1, Math.trunc(options.limit ?? 30)))
    const data = await this.runtime.authenticatedChatPost<Record<string, unknown>>(
      '/api/v1/chats/members/records/page',
      {
        chat_session_uid: source.ownerRef,
        member_user_id: reference.targetUserId,
        mode: mode === 'owner' ? 'sent' : 'mentioned',
        before_seq: Math.max(0, Math.trunc(options.beforeSequence ?? 0)),
        limit,
      },
      session,
      options.signal,
      {
        lane: 'interactive-read',
        key: `member-records:${source.ownerRef}:${String(reference.targetUserId)}:${mode}:${String(Math.max(0, Math.trunc(options.beforeSequence ?? 0)))}`,
        failureCooldownMs: 2_000,
      },
    )
    const items = await this.projectChatTimelineItems(listValue(data.items), source, session, options.signal)
    const nextBeforeSequence = Math.max(0, Math.trunc(numberValue(data.next_before_seq)))
    return {
      source: await this.source.sourceItem(source),
      member,
      mode,
      items,
      hasMore: data.has_more === true,
      ...(nextBeforeSequence > 0 ? { nextCursor: { beforeSequence: nextBeforeSequence } } : {}),
    }
  }

  async openPrivateChatFromMember(
    sourceRef: string,
    memberRef: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<ArkmeOpenPrivateChatResult> {
    const session = await this.runtime.requireSession()
    const source = await this.source.openSourceRef(sourceRef, session.userId)
    if (source.kind !== 'group_chat' && source.kind !== 'private_chat') {
      throw new ArkmePluginError('chat-members-source-invalid', '仅支持从聊天成员发起私聊', false)
    }
    const reference = await this.openChatMemberRef(memberRef, session.userId, source.ownerRef)
    if (reference.targetUserId === session.userId) {
      throw new ArkmePluginError('private-chat-self-invalid', '不能给自己发起私聊', false, 409)
    }
    const rawMembers = await this.rawChatMembers(source.ownerRef, true, session, options.signal)
    const rawMember = rawMembers.find(item => Math.trunc(numberValue(item.user_id)) === reference.targetUserId)
    if (rawMember === undefined) {
      throw new ArkmePluginError('chat-member-ref-stale', '该成员已不属于当前会话，请刷新后重试', false, 409)
    }
    const displayName = stringValue(rawMember.remark).trim()
      || stringValue(rawMember.display_name_snapshot).trim()
      || '群成员'
    return await this.openPrivateChatFromUser(reference.targetUserId, {
      displayName,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
  }

  async openPrivateChatFromUser(
    peerUserId: number,
    options: { displayName?: string; signal?: AbortSignal } = {},
  ): Promise<ArkmeOpenPrivateChatResult> {
    const session = await this.runtime.requireSession()
    if (!Number.isSafeInteger(peerUserId) || peerUserId <= 0) {
      throw new ArkmePluginError('private-chat-peer-invalid', '私聊用户参数无效', false)
    }
    if (peerUserId === session.userId) {
      throw new ArkmePluginError('private-chat-self-invalid', '不能给自己发起私聊', false, 409)
    }
    const profile = (await this.profile.publicProfileSummariesByUserIds([peerUserId], session, options.signal).catch(() => new Map())).get(peerUserId)
    const displayName = options.displayName?.trim() || profile?.displayName || '群成员'
    const ownerSnapshot = (await this.runtime.stateStore.cachedProfile(session.userId).catch(() => undefined))?.profile?.displayName
      ?? ''
    const data = await this.runtime.authenticatedChatPost<Record<string, unknown>>(
      '/api/v1/chats/create-private',
      {
        chat_session_uid: `chat_session_${randomUUID()}`,
        peer_user_id: peerUserId,
        title: displayName,
        create_at: Date.now(),
        owner_display_name_snapshot: ownerSnapshot,
        peer_display_name_snapshot: displayName,
        extra: { source: 'dsh_arkme_user_card', client: 'deepseek_harness' },
      },
      session,
      options.signal,
    )
    const chatSession = objectValue(data.session)
    const uid = stringValue(chatSession.chat_session_uid).trim()
    if (uid === '') {
      throw new ArkmePluginError('private-chat-contract-invalid', '私聊会话响应不完整', true, 502)
    }
    const unread = objectValue(data.unread_snapshot)
    const latestSequence = numberValue(unread.session_last_seq ?? chatSession.last_seq)
    const source: ArkmeSourceItem = {
      sourceRef: await this.source.sealSourceRef(session.userId, 'private_chat', uid, displayName),
      sourceKey: await this.source.chatDirectorySourceKey(session.userId, uid),
      peerUserId,
      kind: 'private_chat',
      displayName,
      ...(profile?.avatarUrl === undefined ? {} : { avatarRef: await this.profile.sealProfileImageRef(session.userId, peerUserId) }),
      activeAtMillis: numberValue(chatSession.last_active_at) || Date.now(),
      unreadCount: numberValue(unread.unread_count),
      ...(latestSequence > 0 ? { latestSequence } : {}),
    }
    this.source.setChatSourceByKey(`${String(session.userId)}:${uid}`, source)
    return { source }
  }

  async openOfficialAuthorPrivateChat(
    options: { signal?: AbortSignal } = {},
  ): Promise<ArkmeOpenPrivateChatResult> {
    const session = await this.runtime.requireSession()
    const created = await this.runtime.authenticatedSubjectPost<OfficialAuthorPrivateChatCreateResult>(
      '/api/v1/private/create-chat-ref-asen',
      {
        subject_uid: `dsh_official_author_${randomUUID().replace(/-/g, '')}`,
        network: 'dsh',
        client_name: 'DSH',
        locs: [],
      },
      session,
      options.signal,
    )
    const rmSubjectId = Math.trunc(numberValue(created.rm_subject_id))
    if (!Number.isSafeInteger(rmSubjectId) || rmSubjectId <= 0) {
      if (booleanValue(created.already_exist)) {
        throw new ArkmePluginError('private-chat-self-invalid', '不能给自己发起私聊', false, 409)
      }
      throw new ArkmePluginError('official-author-chat-contract-invalid', '联系作者私聊响应不完整', true, 502)
    }
    const partnerData = await this.runtime.authenticatedSubjectPost<Record<string, unknown>>(
      '/api/v1/private/get-partner-info-v2',
      { rm_subject_ids: [rmSubjectId] },
      session,
      options.signal,
    )
    const partner = listValue(partnerData.item_ls)
      .map(item => objectValue(item))
      .find(item => Math.trunc(numberValue(item.rm_subject_id)) === rmSubjectId)
    if (partner === undefined) {
      throw new ArkmePluginError('official-author-chat-contract-invalid', '联系作者私聊资料缺失，请稍后重试', true, 502)
    }
    const peerUserId = Math.trunc(numberValue(partner.user_id))
    if (!Number.isSafeInteger(peerUserId) || peerUserId <= 0) {
      throw new ArkmePluginError('official-author-chat-contract-invalid', '联系作者账号资料缺失，请稍后重试', true, 502)
    }
    const displayName = stringValue(partner.mark).trim()
      || stringValue(partner.nick_name).trim()
      || '作者'
    return await this.openPrivateChatFromUser(peerUserId, {
      displayName,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
  }

  async officialAuthorProfile(
    options: { signal?: AbortSignal } = {},
  ): Promise<ArkmeOfficialAuthorProfile> {
    const session = await this.runtime.requireSession()
    const profile = (await this.profile.publicProfileSummariesByUserIds(
      [OFFICIAL_AUTHOR_USER_ID],
      session,
      options.signal,
    )).get(OFFICIAL_AUTHOR_USER_ID)
    if (profile === undefined) {
      return { userId: OFFICIAL_AUTHOR_USER_ID, displayName: OFFICIAL_AUTHOR_FALLBACK_DISPLAY_NAME }
    }
    const displayName = profile.displayName.trim()
      || profile.accountName?.trim()
      || OFFICIAL_AUTHOR_FALLBACK_DISPLAY_NAME
    return {
      userId: OFFICIAL_AUTHOR_USER_ID,
      displayName,
      ...(profile.avatarUrl === undefined ? {} : {
        avatarRef: await this.profile.sealProfileImageRef(session.userId, OFFICIAL_AUTHOR_USER_ID),
      }),
    }
  }

  async readSource(
      sourceRef: string,
      options: { limit?: number; cursor?: ArkmeTimelineCursor; signal?: AbortSignal } = {},
    ): Promise<ArkmeTimelinePage> {
      const session = await this.runtime.requireSession()
      const source = await this.source.openSourceRef(sourceRef, session.userId)
      const limit = Math.min(100, Math.max(1, Math.trunc(options.limit ?? 30)))
      if (source.kind === 'send_to_self') {
        const data = await this.runtime.authenticatedPost<Record<string, unknown>>(
          '/api/v1/home/feed/query',
          {
            limit,
            source_kinds: [1, 2],
            ...(options.cursor?.sendAtMillis === undefined ? {} : { cursor_send_at: options.cursor.sendAtMillis }),
            ...(options.cursor?.itemUid === undefined ? {} : { cursor_record_uid: options.cursor.itemUid }),
          },
          session,
          options.signal,
        )
        const rawRecords = listValue(data.items)
        const media = await this.media.hydrateRecordMediaPage(rawRecords, session, options.signal)
        const items = rawRecords.map(raw => {
          const recordUid = this.record.recordUid(raw)
          const displayItems = media.displayItemsByRecordUid.get(recordUid)
          return this.record.recordTimelineItemFromRaw(raw, session.userId, {
            ...(displayItems === undefined ? {} : { displayItems }),
            mediaUnavailable: media.unavailableRecordUids.has(recordUid),
          })
        }).filter(item => item.itemUid !== '')
        const nextSendAt = numberValue(data.next_cursor_send_at)
        const nextUid = stringValue(data.next_cursor_record_uid).trim()
        return {
          source: await this.source.sourceItem(source),
          items,
          hasMore: data.has_more === true,
          ...(nextSendAt > 0 && nextUid !== '' ? {
            nextCursor: { sendAtMillis: nextSendAt, itemUid: nextUid },
          } : {}),
        }
      }
      if (source.kind === 'default_category') {
        const page = await this.record.list(limit, options.cursor?.sendAtMillis !== undefined && options.cursor.itemUid !== undefined
          ? { sendAtMillis: options.cursor.sendAtMillis, recordUid: options.cursor.itemUid }
          : undefined)
        return {
          source: await this.source.sourceItem(source),
          items: page.items.map(item => this.record.recordTimelineItem(item)),
          hasMore: page.hasMore,
          ...(page.nextCursor === undefined ? {} : {
            nextCursor: { sendAtMillis: page.nextCursor.sendAtMillis, itemUid: page.nextCursor.recordUid },
          }),
        }
      }
      if (source.kind === 'topic') {
        const data = await this.runtime.authenticatedPost<Record<string, unknown>>(
          '/api/v1/topics/display/detail',
          {
            topic_uid: source.ownerRef,
            limit,
            ...(options.cursor?.sendAtMillis === undefined ? {} : { cursor_send_at: options.cursor.sendAtMillis }),
            ...(options.cursor?.itemUid === undefined ? {} : { cursor_record_uid: options.cursor.itemUid }),
          },
          session,
          options.signal,
        )
        const rawRecords = listValue(data.records)
        const media = await this.media.hydrateRecordMediaPage(rawRecords, session, options.signal)
        const records = rawRecords.map(raw => {
          const recordUid = this.record.recordUid(raw)
          const displayItems = media.displayItemsByRecordUid.get(recordUid)
          return this.record.recordTimelineItemFromRaw(raw, session.userId, {
            ...(displayItems === undefined ? {} : { displayItems }),
            mediaUnavailable: media.unavailableRecordUids.has(recordUid),
          })
        })
        const nextSendAt = numberValue(data.next_cursor_send_at)
        const nextUid = stringValue(data.next_cursor_record_uid).trim()
        return {
          source: await this.source.sourceItem(source),
          items: records,
          hasMore: data.has_more === true,
          ...(nextSendAt > 0 && nextUid !== '' ? { nextCursor: { sendAtMillis: nextSendAt, itemUid: nextUid } } : {}),
        }
      }
      const aiPolishDecorations = source.kind === 'group_chat' && options.cursor === undefined
        ? Promise.allSettled([
          this.aiPolish.queryGroupAiPolishConfig(source.ownerRef, session, options.signal),
          this.aiPolish.queryGroupAiPolishNotices(source.ownerRef, session, options.signal),
        ])
        : undefined
      const data = await this.runtime.authenticatedChatPost<Record<string, unknown>>(
        '/api/v1/chat/timeline/page',
        {
          chat_session_uid: source.ownerRef,
          before_seq: Math.max(0, Math.trunc(options.cursor?.beforeSequence ?? 0)),
          limit,
        },
        session,
        options.signal,
        {
          lane: 'interactive-read',
          key: `timeline:${source.ownerRef}:${String(Math.max(0, Math.trunc(options.cursor?.beforeSequence ?? 0)))}:${String(limit)}`,
          failureCooldownMs: 2_000,
        },
      )
      const items = await this.projectChatTimelineItems(listValue(data.items), source, session, options.signal)
      const beforeSequence = numberValue(data.next_before_seq)
      let aiPolishSettings: ArkmeGroupAiPolishSnapshot | undefined
      let aiPolishNotices: ArkmeGroupAiPolishNotice[] | undefined
      if (aiPolishDecorations !== undefined) {
        const [settingsResult, noticesResult] = await aiPolishDecorations
        if (settingsResult.status === 'fulfilled') {
          aiPolishSettings = this.aiPolish.groupAiPolishSnapshot(sourceRef, source.displayName, settingsResult.value)
        }
        if (noticesResult.status === 'fulfilled') aiPolishNotices = noticesResult.value
      }
      return {
        source: await this.source.sourceItem(source),
        items,
        ...(aiPolishSettings === undefined ? {} : { aiPolishSettings }),
        ...(aiPolishNotices === undefined ? {} : { aiPolishNotices }),
        hasMore: data.has_more === true,
        ...(beforeSequence > 0 ? { nextCursor: { beforeSequence } } : {}),
      }
    }
  
  async reportMessage(
      messageRef: string,
      reportType: 1 | 2 | 3 | 4,
      options: { reason?: string; requestUid?: string; signal?: AbortSignal } = {},
    ): Promise<ArkmeMessageReportResult> {
      const session = await this.runtime.requireSession()
      const reference = await this.openMessageRef(messageRef, session.userId)
      const reason = options.reason?.trim() ?? ''
      if (![1, 2, 3, 4].includes(reportType) || (reportType === 4 && reason === '') || [...reason].length > 500) {
        throw new ArkmePluginError('message-report-invalid', '举报类型或补充说明无效', false)
      }
      const data = await this.runtime.authenticatedChatPost<Record<string, unknown>>(
        '/api/v1/chats/report',
        {
          chat_session_uid: reference.chatSessionUid,
          rel_uid: reference.relationUid,
          ...(options.requestUid?.trim() === '' || options.requestUid === undefined ? {} : { request_uid: options.requestUid.trim() }),
          report_type: reportType,
          ...(reason === '' ? {} : { reason }),
        },
        session,
        options.signal,
      )
      const report = objectValue(data.report)
      const reportUid = stringValue(report.report_uid).trim()
      if (reportUid === '') throw new ArkmePluginError('message-report-invalid-response', '举报服务返回无效', true, 502)
      return { messageRef, reportUid, status: numberValue(report.status) }
    }

  async messageReadReceiptSummaries(
    sourceRef: string,
    rawItems: readonly ArkmeMessageReadReceiptQueryItem[],
    options: { signal?: AbortSignal } = {},
  ): Promise<ArkmeMessageReadReceiptSummaryList> {
    const session = await this.runtime.requireSession()
    const source = await this.requireReadReceiptChatSource(sourceRef, session.userId)
    const items = this.requireReadReceiptItems(rawItems)
    const data = await this.runtime.authenticatedChatPost<Record<string, unknown>>(
      '/api/v1/chats/read-receipts/summary-list',
      {
        chat_session_uid: source.ownerRef,
        items: items.map(item => ({ record_uid: item.itemUid, seq: item.sequence })),
      },
      session,
      options.signal,
    )
    if (stringValue(data.chat_session_uid).trim() !== source.ownerRef) {
      throw new ArkmePluginError('message-read-receipt-invalid-response', '消息已读状态服务返回了不匹配的会话', true, 502)
    }
    const requestedKeys = new Set(items.map(item => this.readReceiptItemKey(item.itemUid, item.sequence)))
    const summaries = new Map<string, ArkmeMessageReadReceiptSummary>()
    for (const raw of listValue(data.items)) {
      const item = objectValue(raw)
      const itemUid = stringValue(item.record_uid).trim()
      const sequence = Math.trunc(numberValue(item.seq))
      const key = this.readReceiptItemKey(itemUid, sequence)
      const rowSessionUid = stringValue(item.chat_session_uid).trim()
      const readCount = Math.trunc(numberValue(item.read_count))
      const unreadCount = Math.trunc(numberValue(item.unread_count))
      const totalMemberCount = Math.trunc(numberValue(item.total_member_count))
      if (!requestedKeys.has(key) || summaries.has(key) || rowSessionUid !== source.ownerRef
        || typeof item.seq !== 'number' || !Number.isSafeInteger(item.seq)
        || typeof item.read_count !== 'number' || !Number.isSafeInteger(item.read_count)
        || typeof item.unread_count !== 'number' || !Number.isSafeInteger(item.unread_count)
        || typeof item.total_member_count !== 'number' || !Number.isSafeInteger(item.total_member_count)
        || readCount < 0 || unreadCount < 0 || totalMemberCount < 0
        || readCount + unreadCount !== totalMemberCount) {
        throw new ArkmePluginError('message-read-receipt-invalid-response', '消息已读状态服务返回无效', true, 502)
      }
      summaries.set(key, {
        itemUid,
        sequence,
        readCount,
        unreadCount,
        totalMemberCount,
        status: unreadCount === 0 ? 'read' : readCount === 0 ? 'unread' : 'partially_read',
      })
    }
    if (summaries.size !== items.length) {
      throw new ArkmePluginError('message-read-receipt-invalid-response', '消息已读状态服务返回不完整', true, 502)
    }
    return {
      sourceRef,
      conversationKind: source.kind,
      items: items.map(item => summaries.get(this.readReceiptItemKey(item.itemUid, item.sequence))!),
    }
  }

  async messageReadReceiptDetail(
    sourceRef: string,
    itemUid: string,
    sequence: number,
    options: { signal?: AbortSignal } = {},
  ): Promise<ArkmeMessageReadReceiptDetail> {
    const session = await this.runtime.requireSession()
    const source = await this.requireReadReceiptChatSource(sourceRef, session.userId)
    if (source.kind !== 'group_chat') {
      throw new ArkmePluginError('message-read-receipt-group-required', '成员已读详情只支持群聊消息；私聊请查询消息已读状态', false, 400)
    }
    const [message] = this.requireReadReceiptItems([{ itemUid, sequence }])
    const data = await this.runtime.authenticatedChatPost<Record<string, unknown>>(
      '/api/v1/chats/read-receipts/detail',
      { chat_session_uid: source.ownerRef, record_uid: message!.itemUid, seq: message!.sequence },
      session,
      options.signal,
    )
    if (stringValue(data.chat_session_uid).trim() !== source.ownerRef
      || stringValue(data.record_uid).trim() !== message!.itemUid
      || typeof data.seq !== 'number' || !Number.isSafeInteger(data.seq)
      || Math.trunc(numberValue(data.seq)) !== message!.sequence) {
      throw new ArkmePluginError('message-read-receipt-invalid-response', '成员已读详情服务返回了不匹配的消息', true, 502)
    }
    const rawMembers = listValue(data.items).map(objectValue)
    const seenUserIds = new Set<number>()
    const receiptMembers = rawMembers.map(item => {
      const userId = Math.trunc(numberValue(item.user_id))
      const readStatus = stringValue(item.read_status).trim()
      const readAtMillis = Math.trunc(numberValue(item.read_at))
      if (typeof item.user_id !== 'number' || !Number.isSafeInteger(item.user_id)
        || typeof item.read_at !== 'number' || !Number.isSafeInteger(item.read_at)
        || !Number.isSafeInteger(userId) || userId <= 0 || userId === session.userId || seenUserIds.has(userId)
        || (readStatus !== 'read' && readStatus !== 'unread') || readAtMillis < 0
        || (readStatus === 'unread' && readAtMillis !== 0)) {
        throw new ArkmePluginError('message-read-receipt-invalid-response', '成员已读详情服务返回无效', true, 502)
      }
      seenUserIds.add(userId)
      return {
        userId,
        readStatus: readStatus === 'read' ? 'read' as const : 'unread' as const,
        readAtMillis,
        remarkName: firstJoinDisplayName(item, [
          'remark', 'remark_name', 'remarkName', 'contact_remark', 'contactRemark',
          'member_remark', 'memberRemark',
        ]),
        memberName: firstJoinDisplayName(item, [
          'member_name', 'memberName', 'nickname', 'nick_name', 'nickName', 'name',
          'user_name', 'userName', 'display_name_snapshot', 'displayNameSnapshot',
        ]),
        userName: firstJoinDisplayName(item, ['display_name', 'displayName']),
      }
    })
    const userIds = receiptMembers.map(item => item.userId)
    const missingRemarkUserIds = receiptMembers
      .filter(item => item.remarkName === '')
      .map(item => item.userId)
    const [profiles, privateRemarks] = await Promise.all([
      this.profile.publicProfileSummariesByUserIds(
        userIds, session, options.signal,
      ).catch(() => new Map()),
      missingRemarkUserIds.length === 0
        ? Promise.resolve(new Map<number, string>())
        : this.source.privateRemarksByUserIds(
            missingRemarkUserIds,
            options.signal === undefined ? {} : { signal: options.signal },
          ).catch(() => new Map<number, string>()),
    ])
    const members = [] as ArkmeMessageReadReceiptDetail['items']
    for (const item of receiptMembers) {
      const profile = profiles.get(item.userId)
      const { displayName } = resolveChatMemberDisplayNames({
        userId: item.userId,
        remarkCandidates: [item.remarkName, privateRemarks.get(item.userId)],
        memberNameCandidates: [item.memberName],
        userNameCandidates: [item.userName, profile?.displayName],
      })
      members.push({
        memberRef: await this.sealChatMemberRef(session.userId, source.ownerRef, item.userId),
        displayName,
        ...(profile?.avatarUrl === undefined ? {} : {
          avatarRef: await this.profile.sealProfileImageRef(session.userId, item.userId),
        }),
        readStatus: item.readStatus,
        ...(item.readStatus === 'read' && item.readAtMillis > 0 ? { readAtMillis: item.readAtMillis } : {}),
      })
    }
    const readCount = members.filter(member => member.readStatus === 'read').length
    return {
      sourceRef,
      itemUid: message!.itemUid,
      sequence: message!.sequence,
      readCount,
      unreadCount: members.length - readCount,
      totalMemberCount: members.length,
      items: members,
    }
  }

  private async requireReadReceiptChatSource(sourceRef: string, userId: number): Promise<ArkmeSourceRefPayload & {
    kind: 'private_chat' | 'group_chat'
  }> {
    const source = await this.source.openSourceRef(sourceRef, userId)
    if (source.kind !== 'private_chat' && source.kind !== 'group_chat') {
      throw new ArkmePluginError('message-read-receipt-chat-required', '消息已读状态只支持私聊或群聊', false, 400)
    }
    return source as ArkmeSourceRefPayload & { kind: 'private_chat' | 'group_chat' }
  }

  private requireReadReceiptItems(rawItems: readonly ArkmeMessageReadReceiptQueryItem[]): ArkmeMessageReadReceiptQueryItem[] {
    if (rawItems.length < 1 || rawItems.length > ARKME_MESSAGE_READ_RECEIPT_MAX_ITEMS) {
      throw new ArkmePluginError(
        'message-read-receipt-items-invalid',
        `消息已读状态每次需要 1 至 ${String(ARKME_MESSAGE_READ_RECEIPT_MAX_ITEMS)} 条消息`,
        false,
        400,
      )
    }
    const seen = new Set<string>()
    return rawItems.map(raw => {
      const itemUid = raw.itemUid.trim()
      const sequence = Math.trunc(raw.sequence)
      const key = this.readReceiptItemKey(itemUid, sequence)
      if (itemUid === '' || itemUid.length > 256 || !Number.isSafeInteger(raw.sequence) || sequence <= 0 || seen.has(key)) {
        throw new ArkmePluginError('message-read-receipt-items-invalid', '消息已读状态参数无效或重复', false, 400)
      }
      seen.add(key)
      return { itemUid, sequence }
    })
  }

  private readReceiptItemKey(itemUid: string, sequence: number): string {
    return `${itemUid}\u0000${String(sequence)}`
  }
  
  async sendSourceText(
      sourceRef: string,
      textContent: string,
      options: {
        recordUid?: string
        relationUid?: string
        botRefs?: readonly string[]
        humanMentions?: readonly ArkmeHumanMentionInput[]
        signal?: AbortSignal
        agentAuthored?: boolean
      } = {},
    ): Promise<ArkmeSourceSendResult> {
      const session = await this.runtime.requireSession()
      const source = await this.source.openSourceRef(sourceRef, session.userId)
      const text = textContent.trim()
      if (text === '' || text.length > this.runtime.config.maxTextLength) {
        throw new ArkmePluginError('source-text-invalid', '发送内容为空或超过长度限制', false)
      }
      const recordUid = options.recordUid?.trim() || randomUUID()
      if (source.kind === 'send_to_self' || source.kind === 'default_category') {
        const result = await this.record.createTextForConversation(recordUid, text)
        if (result.localState !== 'failed') this.source.invalidateSourceListCache(session.userId, 'send_to_self')
        return {
          sourceRef,
          itemUid: result.recordUid,
          status: result.status,
          localState: result.localState,
          ...(result.error === undefined ? {} : { error: result.error }),
        }
      }
      if (source.kind === 'topic') {
        const result = await this.runtime.authenticatedPost<Record<string, unknown>>(
          '/api/v1/topics/records/create',
          { topic_uid: source.ownerRef, record_uid: recordUid, template_kind: 1, title: '', text_content: text, send_at: Date.now() },
          session,
        )
        this.source.invalidateSourceListCache(session.userId, 'send_to_self')
        return { sourceRef, itemUid: stringValue(result.record_uid).trim() || recordUid, status: numberValue(result.status), localState: 'synced' }
      }
      const relationUid = options.relationUid?.trim() || randomUUID()
      const agentAuthored = isAgentAuthoredChatSend(options)
      let sent: ArkmeSourceSendResult
      if (source.kind === 'group_chat') {
        if ((options.botRefs?.length ?? 0) > 0 && (options.humanMentions?.length ?? 0) > 0) {
          throw new ArkmePluginError('mention-kind-conflict', '单条消息暂不支持同时新增真人和 Bot mention', false)
        }
        if (options.botRefs !== undefined && options.botRefs.length > 0) {
          sent = await this.groupBotMentionSend(
            sourceRef, source, text, options.botRefs, recordUid, relationUid, session, options.signal, { agentAuthored },
          )
        } else if (options.humanMentions !== undefined && options.humanMentions.length > 0) {
          const contentPayload = await this.humanMentionContentPayload(
            source, textContent, text, options.humanMentions, session, options.signal,
          )
          sent = await this.sendChatSourceTextRaw(
            sourceRef, source.ownerRef, text, recordUid, relationUid, session, undefined, contentPayload,
            options.signal, { agentAuthored },
          )
        } else {
          sent = await this.aiPolish.sendGroupSourceTextWithAiPolish(
            sourceRef,
            source.ownerRef,
            text,
            recordUid,
            relationUid,
            session,
            {
              agentAuthored,
              ...(options.signal === undefined ? {} : { signal: options.signal }),
            },
          )
        }
      } else if ((options.botRefs?.length ?? 0) > 0 || (options.humanMentions?.length ?? 0) > 0) {
        throw new ArkmePluginError('mention-group-required', 'Mention 只能发送到群聊', false)
      } else {
        sent = await this.sendChatSourceTextRaw(
          sourceRef, source.ownerRef, text, recordUid, relationUid, session, undefined, undefined, options.signal, { agentAuthored },
        )
      }
      if (agentAuthored && sent.localState === 'synced') void this.arko.agentSourceDisplayName(session)
      return sent
    }
  
  private async humanMentionContentPayload(
    source: ArkmeSourceRefPayload,
    rawText: string,
    normalizedText: string,
    inputs: readonly ArkmeHumanMentionInput[],
    session: ArkmeSessionCredentials,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    if (inputs.length > 50) throw new ArkmePluginError('human-mention-invalid', '单条消息 mention 数量过多', false)
    const leadingTrim = rawText.length - rawText.trimStart().length
    const rawMembers = await this.rawChatMembers(source.ownerRef, true, session, signal)
    const membersByUserId = new Map(rawMembers.map(item => [Math.trunc(numberValue(item.user_id)), item]))
    const mentions: Array<{ user_id: number; display_name_snapshot: string; start_index: number; length: number }> = []
    for (const input of [...inputs].sort((left, right) => left.startIndex - right.startIndex)) {
      const memberRef = input.memberRef.trim()
      const startIndex = Math.trunc(input.startIndex) - leadingTrim
      const length = Math.trunc(input.length)
      if (memberRef === '' || startIndex < 0 || length < 2
        || startIndex + length > normalizedText.length) {
        throw new ArkmePluginError('human-mention-invalid', '真人 mention 引用或文本区间无效', false)
      }
      const reference = await this.openChatMemberRef(memberRef, session.userId, source.ownerRef)
      if (reference.targetUserId === session.userId) {
        throw new ArkmePluginError('human-mention-self-invalid', '不能 @ 自己', false)
      }
      const rawMember = membersByUserId.get(reference.targetUserId)
      if (rawMember === undefined) throw new ArkmePluginError('chat-member-ref-stale', '被 @ 成员已不在当前群聊', false, 409)
      const visible = normalizedText.slice(startIndex, startIndex + length)
      const displayName = visible.startsWith('@') ? visible.slice(1).trim() : ''
      const expectedNames = [stringValue(rawMember.remark).trim(), stringValue(rawMember.display_name_snapshot).trim()]
        .filter(value => value !== '')
      if (displayName === '' || !expectedNames.includes(displayName)) {
        throw new ArkmePluginError('human-mention-text-mismatch', '真人 mention 文本已变化，请重新选择成员', false, 409)
      }
      const previous = mentions.at(-1)
      if (previous !== undefined && previous.start_index + previous.length > startIndex) {
        throw new ArkmePluginError('human-mention-overlap', '真人 mention 文本区间重叠', false)
      }
      mentions.push({
        user_id: reference.targetUserId,
        display_name_snapshot: displayName,
        start_index: startIndex,
        length,
      })
    }
    const checksumInput = {
      text_content: normalizedText,
      human_mentions: mentions.map(mention => ({
        user_id: mention.user_id,
        start_index: mention.start_index,
        length: mention.length,
      })),
      bot_mentions: [],
    }
    return {
      payload_kind: 2,
      schema_version: 1,
      mention_metadata: {
        schema_version: 1,
        source_checksum: createHash('sha256').update(JSON.stringify(checksumInput)).digest('hex'),
        human_mentions: mentions,
      },
    }
  }

  async groupBotMentionSend(
      sourceRef: string,
      source: ArkmeSourceRefPayload,
      text: string,
      botRefs: readonly string[],
      recordUid: string,
      relationUid: string,
      session: ArkmeSessionCredentials,
      signal?: AbortSignal,
      options: { agentAuthored?: boolean } = {},
    ): Promise<ArkmeSourceSendResult> {
      const uniqueRefs = new Set(botRefs.map(ref => ref.trim()))
      if (uniqueRefs.has('') || uniqueRefs.size !== botRefs.length) {
        throw new ArkmePluginError('bot-mention-ref-invalid', 'Bot mention 引用为空或重复', false)
      }
      const references = await Promise.all([...uniqueRefs].map(async ref => ({
        ref,
        value: await this.bot.openBotRef(ref, session.userId),
      })))
      const requestedById = new Map(references.map(item => [item.value.botId, item.ref]))
      if (requestedById.size !== references.length) {
        throw new ArkmePluginError('bot-mention-ref-invalid', 'Bot mention 引用重复', false)
      }
      const groupData = await this.runtime.authenticatedBotPost<Record<string, unknown>>(
        '/api/v1/bot/group/list', { subject_uid: source.ownerRef }, session, signal,
      )
      const mentions: Array<{ bot_uid: string; display_name_snapshot: string; start_index: number; length: number }> = []
      let visibleText = ''
      for (const value of listValue(groupData.bots)) {
        const raw = objectValue(value)
        const botId = stringValue(raw.bot_id).trim()
        if (!requestedById.has(botId)) continue
        if (stringValue(raw.provider).trim() !== 'openclaw' || !booleanValue(raw.installed)) {
          throw new ArkmePluginError('bot-mention-not-installed', '所选 Bot 未安装到该群聊', false, 409)
        }
        const name = stringValue(raw.name).trim()
        if (name === '') throw new ArkmePluginError('bot-contract-invalid', 'Bot 响应不完整', true, 502)
        const display = `@${name}`
        const startIndex = visibleText.length
        visibleText += `${display} `
        mentions.push({
          bot_uid: botId,
          display_name_snapshot: name,
          start_index: startIndex,
          length: display.length,
        })
        requestedById.delete(botId)
      }
      if (requestedById.size > 0) {
        throw new ArkmePluginError('bot-mention-not-installed', '所选 Bot 未安装到该群聊', false, 409)
      }
      visibleText += text
      if (visibleText.length > this.runtime.config.maxTextLength) {
        throw new ArkmePluginError('source-text-invalid', '发送内容超过长度限制', false)
      }
      const checksumInput = {
        text_content: visibleText,
        human_mentions: [],
        bot_mentions: mentions.map(mention => ({
          bot_uid: mention.bot_uid,
          start_index: mention.start_index,
          length: mention.length,
        })),
      }
      const contentPayload = {
        payload_kind: 2,
        schema_version: 1,
        mention_metadata: {
          schema_version: 1,
          source_checksum: createHash('sha256').update(JSON.stringify(checksumInput)).digest('hex'),
          bot_mentions: mentions,
        },
      }
      return await this.sendChatSourceTextRaw(
        sourceRef, source.ownerRef, visibleText, recordUid, relationUid, session, undefined, contentPayload, signal, options,
      )
    }
  
  async sendChatSourceTextRaw(
      sourceRef: string,
      chatSessionUid: string,
      text: string,
      recordUid: string,
      relationUid: string,
      session: ArkmeSessionCredentials,
      initialAiPolish?: Record<string, unknown>,
      contentPayload?: Record<string, unknown>,
      signal?: AbortSignal,
      options: { agentAuthored?: boolean } = {},
    ): Promise<ArkmeSourceSendResult> {
      const result = await this.runtime.authenticatedChatPost<Record<string, unknown>>(
        '/api/v1/chats/records/send',
        {
          chat_session_uid: chatSessionUid,
          record_uid: recordUid,
          rel_uid: relationUid,
          template_kind: 1,
          text_content: text,
          ...(options.agentAuthored === true ? { creation_source: 1 } : {}),
          ...(initialAiPolish === undefined ? {} : { initial_ai_polish: initialAiPolish }),
          ...(contentPayload === undefined ? {} : { content_payload: contentPayload }),
          send_at: Date.now(),
        },
        session,
        signal,
      )
      const sequence = numberValue(result.seq)
      this.realtime.scheduleChatSessionProjection(chatSessionUid, sequence)
      return {
        sourceRef,
        itemUid: stringValue(result.record_uid).trim() || recordUid,
        status: numberValue(result.audit_status),
        sequence,
        localState: 'synced',
      }
    }
  
  private async sendGroupSourceTextWithAiPolish(
      sourceRef: string,
      chatSessionUid: string,
      originalText: string,
      recordUid: string,
      relationUid: string,
      session: ArkmeSessionCredentials,
      options: { agentAuthored?: boolean; signal?: AbortSignal } = {},
    ): Promise<ArkmeSourceSendResult> {
      return await this.aiPolish.sendGroupSourceTextWithAiPolish(
        sourceRef, chatSessionUid, originalText, recordUid, relationUid, session, options,
      )
    }
  
  async sendSourceRich(
      sourceRef: string,
      input: ArkmeRichSendInput,
      options: { recordUid?: string; relationUid?: string } = {},
    ): Promise<ArkmeSourceSendResult> {
      if (this.runtime.config.richMediaSendEnabled === false) {
        throw new ArkmePluginError('rich-content-disabled', '富内容发送已被插件配置关闭', false, 403)
      }
      const session = await this.runtime.requireSession()
      const source = await this.source.openSourceRef(sourceRef, session.userId)
      const title = input.title?.trim() ?? ''
      const textContent = input.textContent?.trim() ?? ''
      const assets = input.assets ?? []
      const displayKind = input.displayKind === 1 ? 1 : 0
      const longArticle = displayKind === 1
      const maxContentLength = longArticle ? 40000 : this.runtime.config.maxTextLength
      const thinkingDurationMillis = Math.max(0, Math.trunc(input.thinkingDurationMillis ?? 0))
      if (title.length > (longArticle ? 100 : 500) || textContent.length > maxContentLength || assets.length > 20
        || (textContent === '' && title === '' && assets.length === 0)) {
        throw new ArkmePluginError('rich-content-invalid', '富内容为空、过长或附件数量超限', false)
      }
      if (longArticle && (title === '' || textContent === '')) {
        throw new ArkmePluginError('long-article-invalid', '长文标题和正文不能为空', false)
      }
      for (const asset of assets) {
        if (!/^[A-Za-z0-9._:-]{8,256}$/.test(asset.fileAssetUid) || asset.size < 0
          || ![1, 2, 3, 4].includes(asset.fileKind)) {
          throw new ArkmePluginError('rich-asset-invalid', '附件资产参数无效', false)
        }
      }
      const recordUid = options.recordUid?.trim() || randomUUID()
      const relationUid = options.relationUid?.trim() || randomUUID()
      const templateKind = longArticle ? 1 : assets.length === 0 ? 1 : 2
      const mediaContentPayload = assets.length === 0 ? undefined : {
        payload_kind: 2,
        schema_version: 1,
        text_state: textContent === '' ? 3 : 1,
        media_refs: assets.map((asset, index) => ({
          file_asset_uid: asset.fileAssetUid,
          content_file_role: 1,
          render_role: 1,
          sort_order: index,
          file_name: asset.fileName,
        })),
      }
      let contentPayload: Record<string, unknown> | undefined = mediaContentPayload
      if ((input.humanMentions?.length ?? 0) > 0) {
        if (source.kind !== 'group_chat') {
          throw new ArkmePluginError('mention-group-required', 'Mention 只能发送到群聊', false)
        }
        if (longArticle) throw new ArkmePluginError('human-mention-rich-invalid', '长文暂不支持成员 mention', false)
        const mentionPayload = await this.humanMentionContentPayload(
          source, input.textContent ?? '', textContent, input.humanMentions!, session,
        )
        contentPayload = { ...(mediaContentPayload ?? {}), ...mentionPayload }
      }
      const commonBody = {
        record_uid: recordUid,
        template_kind: templateKind,
        display_kind: displayKind,
        title,
        text_content: textContent,
        ...(longArticle ? { record_duration_millis: thinkingDurationMillis } : {}),
        ...(contentPayload === undefined ? {} : { content_payload: contentPayload }),
        send_at: Date.now(),
      }
      if (source.kind === 'send_to_self' || source.kind === 'default_category') {
        const result = await this.runtime.authenticatedPost<Record<string, unknown>>('/api/v1/records/create', commonBody, session)
        this.source.invalidateSourceListCache(session.userId, 'send_to_self')
        return { sourceRef, itemUid: stringValue(result.record_uid).trim() || recordUid, status: numberValue(result.status), localState: 'synced' }
      }
      if (source.kind === 'topic') {
        const result = await this.runtime.authenticatedPost<Record<string, unknown>>(
          '/api/v1/topics/records/create', { topic_uid: source.ownerRef, ...commonBody }, session,
        )
        this.source.invalidateSourceListCache(session.userId, 'send_to_self')
        return { sourceRef, itemUid: stringValue(result.record_uid).trim() || recordUid, status: numberValue(result.status), localState: 'synced' }
      }
      const result = await this.runtime.authenticatedChatPost<Record<string, unknown>>(
        '/api/v1/chats/records/send',
        { chat_session_uid: source.ownerRef, rel_uid: relationUid, ...commonBody },
        session,
      )
      const sequence = numberValue(result.seq)
      this.realtime.scheduleChatSessionProjection(source.ownerRef, sequence)
      return {
        sourceRef,
        itemUid: stringValue(result.record_uid).trim() || recordUid,
        status: numberValue(result.audit_status ?? result.status),
        sequence,
        localState: 'synced',
      }
    }
  
  async longArticleDetail(sourceRef: string, itemUid: string, signal?: AbortSignal): Promise<ArkmeLongArticleDetail> {
      return await this.record.longArticleDetail(sourceRef, itemUid, signal)
    }
  
  async updateLongArticle(
      sourceRef: string,
      itemUid: string,
      input: { title: string; textContent: string; version: number; editDurationMillis: number },
    ): Promise<ArkmeLongArticleDetail> {
      return await this.record.updateLongArticle(sourceRef, itemUid, input)
    }
  
  async getLongArticleDraft(sourceRef: string, itemUid?: string): Promise<ArkmeLongArticleDraft | undefined> {
      return await this.record.getLongArticleDraft(sourceRef, itemUid)
    }
  
  async putLongArticleDraft(draft: ArkmeLongArticleDraft): Promise<void> {
      return await this.record.putLongArticleDraft(draft)
    }
  
  async removeLongArticleDraft(sourceRef: string, itemUid?: string): Promise<void> {
      return await this.record.removeLongArticleDraft(sourceRef, itemUid)
    }
  
  async uploadLocalFile(
      filePath: string,
      metadata: { size: number; sha256: string; mimeType: string; fileName: string; fileKind: 1 | 2 | 3 | 4 },
    ): Promise<ArkmeUploadedAsset> {
      return await this.media.uploadLocalFile(filePath, metadata)
    }
  
  async fetchMedia(
      mediaRef: string,
      range?: string,
    ): Promise<{ response: Response; descriptor: ArkmeMediaDescriptor }> {
      return await this.media.fetchMedia(mediaRef, range)
    }
  
  private currentUserAgentSourceFallback(
      userId: number,
      source: ArkmeTimelineItem['agentSource'] | undefined,
    ): ArkmeTimelineItem['agentSource'] | undefined {
      return this.arko.currentUserAgentSourceFallback(userId, source)
    }
  
  private async agentSourceDisplayName(session: ArkmeSessionCredentials): Promise<string> {
      return await this.arko.agentSourceDisplayName(session)
    }
  
  async sendDirectText(
      recipientArkmeId: string,
      textContent: string,
      options: {
        recordUid?: string
        relationUid?: string
        sendAtMillis?: number
        signal?: AbortSignal
      } = {},
    ): Promise<ArkmeDirectTextSendResult> {
      const session = await this.runtime.requireSession()
      const recipient = recipientArkmeId.trim()
      if (recipient === '') {
        throw new ArkmePluginError('direct-recipient-invalid', '接收方 Arkme ID 不能为空', false)
      }
      const text = textContent.trim()
      if (text === '' || text.length > this.runtime.config.maxTextLength) {
        throw new ArkmePluginError('direct-text-invalid', '发送内容为空或超过长度限制', false)
      }
      const recordUid = options.recordUid?.trim() || randomUUID()
      const relationUid = options.relationUid?.trim() || randomUUID()
      const sendAtMillis = options.sendAtMillis ?? Date.now()
      if (!Number.isSafeInteger(sendAtMillis) || sendAtMillis <= 0) {
        throw new ArkmePluginError('direct-send-at-invalid', '发送时间无效', false)
      }
      const result = await this.runtime.authenticatedChatPost<Record<string, unknown>>(
        '/api/v1/chats/agent/records/send',
        {
          recipient_jotmo_id: recipient,
          record_uid: recordUid,
          rel_uid: relationUid,
          text_content: text,
          creation_source: 1,
          send_at: sendAtMillis,
        },
        session,
        options.signal,
      )
      const chatSessionUid = stringValue(result.chat_session_uid).trim()
      const sequence = numberValue(result.seq)
      const targetKind = stringValue(result.target_kind).trim()
      if (chatSessionUid === '' || !Number.isSafeInteger(sequence) || sequence <= 0 || targetKind !== 'direct') {
        throw new ArkmePluginError('direct-send-response-invalid', 'Chat Agent 发送返回了无效响应', true, 502)
      }
      const responseRecordUid = stringValue(result.record_uid).trim() || recordUid
      const responseRelationUid = stringValue(result.rel_uid).trim() || relationUid
      void this.arko.agentSourceDisplayName(session)
      return {
        recipientArkmeId: recipient,
        chatSessionUid,
        recordUid: responseRecordUid,
        relationUid: responseRelationUid,
        sequence,
        targetKind: 'direct',
      }
    }
  
  async markSourceRead(
    sourceRef: string,
    readSequence: number,
    options: { signal?: AbortSignal } = {},
  ): Promise<ArkmeSourceReadResult> {
      const session = await this.runtime.requireSession()
      const source = await this.source.openSourceRef(sourceRef, session.userId)
      if (source.kind !== 'private_chat' && source.kind !== 'group_chat') {
        throw new ArkmePluginError('source-read-unsupported', '当前数据源不支持聊天已读', false)
      }
      if (!Number.isSafeInteger(readSequence) || readSequence <= 0) {
        throw new ArkmePluginError('source-read-sequence-invalid', '聊天已读游标无效', false)
      }
      const data = await this.runtime.authenticatedChatPost<Record<string, unknown>>(
        '/api/v1/chats/cursor/update',
        {
          chat_session_uid: source.ownerRef,
          read_seq: readSequence,
          read_at: Date.now(),
          client_ack_id: randomUUID(),
          reason: 'arkme_dsh_open_chat',
        },
        session,
        options.signal,
      )
      const responseSessionUid = stringValue(data.chat_session_uid).trim()
      const effectiveReadSequence = numberValue(data.effective_read_seq)
      const readAt = numberValue(data.read_at)
      const sessionLastSequence = numberValue(data.session_last_seq)
      const unreadCount = numberValue(data.unread_count)
      if (responseSessionUid !== source.ownerRef || !Number.isSafeInteger(effectiveReadSequence)
        || effectiveReadSequence < readSequence || readAt <= 0 || sessionLastSequence < effectiveReadSequence
        || !Number.isSafeInteger(unreadCount) || unreadCount < 0) {
        throw new ArkmePluginError('source-read-ack-invalid', '聊天已读响应不完整', true, 502)
      }
      const cacheKey = `${String(session.userId)}:${source.ownerRef}`
      const cached = this.source.cachedChatSourceByKey(cacheKey)
      if (cached !== undefined) this.source.setChatSourceByKey(cacheKey, { ...cached, unreadCount })
      this.realtime.emitChatClientEvent({
        type: 'read-ack',
        revision: this.realtime.nextChatClientRevision(),
        sourceRef,
        sourceKey: await this.source.chatDirectorySourceKey(session.userId, source.ownerRef),
        effectiveReadSequence,
        unreadCount,
      })
      this.realtime.scheduleChatSessionProjection(source.ownerRef, sessionLastSequence)
      return { sourceRef, effectiveReadSequence, unreadCount }
    }
  
  async chatSourceFromBundle(
      bundle: Record<string, unknown>,
      session: ArkmeSessionCredentials,
      cached: ArkmeSourceItem | undefined,
      timelineItems: ArkmeTimelineItem[],
    ): Promise<ArkmeSourceItem> {
      return await this.source.chatSourceFromBundle(bundle, session, cached, timelineItems)
    }
  
  async chatTimelineItems(
      data: Record<string, unknown>,
      session: ArkmeSessionCredentials,
      chatSessionUid: string,
    ): Promise<ArkmeTimelineItem[]> {
      const items: ArkmeTimelineItem[] = []
      for (const raw of listValue(data.items)) {
        const item = objectValue(raw)
        const relation = objectValue(item.relation)
        const record = objectValue(item.record)
        const payload = objectValue(record.payload)
        const uid = stringValue(relation.record_uid ?? payload.record_uid).trim()
        if (uid === '') continue
        const senderUserId = numberValue(relation.sender_user_id)
        const aiPolish = this.aiPolish.timelineAiPolish(record, payload)
        const sendAtMillis = numberValue(relation.attach_at ?? payload.send_at)
        const forwardRecords = await this.chatForwardRecordsPreview(item, session.userId, sendAtMillis)
        const rawAgentSource = timelineAgentSource(relation, record, payload)
        const agentSource = senderUserId === session.userId
          ? this.arko.currentUserAgentSourceFallback(session.userId, rawAgentSource)
          : rawAgentSource
        items.push({
          itemUid: uid,
          ...(senderUserId > 0 ? { memberRef: await this.sealChatMemberRef(session.userId, chatSessionUid, senderUserId) } : {}),
          senderName: stringValue(relation.display_name_snapshot).trim() || 'Arkme用户',
          ...(agentSource === undefined ? {} : { agentSource }),
          ...(senderUserId > 0 ? { avatarRef: await this.profile.sealProfileImageRef(session.userId, senderUserId) } : {}),
          isMe: senderUserId === session.userId,
          sendAtMillis,
          title: stringValue(payload.title),
          textContent: stringValue(payload.text_content),
          status: numberValue(record.status),
          sequence: numberValue(relation.seq),
          ...(numberValue(record.version ?? payload.version) > 0 ? { recordVersion: numberValue(record.version ?? payload.version) } : {}),
          ...(aiPolish === undefined ? {} : { aiPolish }),
          ...(forwardRecords === undefined ? {} : { forwardRecords }),
          displayKind: numberValue(payload.display_kind),
          contentBlocks: this.media.richContentBlocks(item, session.userId),
        })
      }
      return items
    }
  
  async chatForwardRecordsPreview(
      raw: unknown,
      viewerUserId: number,
      fallbackCreatedAtMillis: number,
    ): Promise<ArkmeTimelineItem['forwardRecords'] | undefined> {
      const contentPayload = this.media.recordContentPayload(raw)
      const nested = objectValue(contentPayload.forward_records ?? contentPayload.forwardRecords)
      const payload = Object.keys(nested).length > 0 ? nested : contentPayload
      if (stringValue(payload.render_kind ?? payload.renderKind).trim() !== 'forward_records') return undefined
  
      const projectedItems: ArkmeForwardRecordPreviewItem[] = []
      const appendItems = async (values: unknown[], depth: number): Promise<void> => {
        const sorted = values.map((value, index) => ({ value, index, order: numberValue(objectValue(value).item_order) }))
          .sort((left, right) => (left.order || left.index) - (right.order || right.index))
        for (const entry of sorted) {
          if (projectedItems.length >= 100) return
          const item = objectValue(entry.value)
          const nestedForward = objectValue(item.forward_records ?? item.forwardRecords)
          if (depth < 4
            && stringValue(nestedForward.render_kind ?? nestedForward.renderKind).trim() === 'forward_records') {
            await appendItems(listValue(nestedForward.items), depth + 1)
            continue
          }
          const senderUserId = numberValue(item.source_sender_user_id ?? item.sourceSenderUserId ?? item.owner_id ?? item.ownerId)
          const senderName = stringValue(
            item.owner_name ?? item.ownerName ?? item.source_display_name ?? item.sourceDisplayName,
          ).trim() || 'Arkme用户'
          const textContent = stringValue(item.text ?? item.text_preview ?? item.textPreview).trim()
          const title = stringValue(item.title).trim()
          const imageCount = Math.max(0, Math.trunc(numberValue(item.image_count ?? item.imageCount)))
          const voiceCount = Math.max(0, Math.trunc(numberValue(item.voice_count ?? item.voiceCount)))
          const fileCount = Math.max(0, Math.trunc(numberValue(item.file_count ?? item.fileCount)))
          const fileName = listValue(item.file_names ?? item.fileNames)
            .map(value => stringValue(value).trim()).find(value => value !== '')
          const contentLabel = imageCount > 0
            ? imageCount > 1 ? `[${String(imageCount)}张图片]` : '[图片]'
            : voiceCount > 0 ? '[语音]'
              : fileCount > 0 ? fileName === undefined ? '[文件]' : `[文件] ${fileName}`
                : stringValue(item.availability).trim() !== '' ? '原快记暂不可查看' : undefined
          projectedItems.push({
            senderName,
            ...(senderUserId > 0 ? { avatarRef: await this.profile.sealProfileImageRef(viewerUserId, senderUserId) } : {}),
            sendAtMillis: numberValue(item.send_at ?? item.sendAt),
            title,
            textContent,
            ...(contentLabel === undefined ? {} : { contentLabel }),
          })
        }
      }
      await appendItems(listValue(payload.items), 0)
  
      const summaryLines = listValue(payload.summary_lines ?? payload.summaryLines)
        .map(value => stringValue(value).trim()).filter(value => value !== '')
      const createdAtMillis = numberValue(payload.created_at ?? payload.createdAt) || fallbackCreatedAtMillis
      return {
        title: stringValue(payload.title).trim() || '转发快记',
        createdAtMillis,
        summaryLines,
        items: projectedItems,
      }
    }
  
  private async rawChatMembers(
    chatSessionUid: string,
    activeOnly: boolean,
    session: ArkmeSessionCredentials,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>[]> {
    const data = await this.runtime.authenticatedChatPost<Record<string, unknown>>(
      '/api/v1/chats/members/list',
      { chat_session_uid: chatSessionUid, active_only: activeOnly },
      session,
      signal,
    )
    return listValue(data.items).map(objectValue)
  }

  private async projectChatMembers(
    chatSessionUid: string,
    rawItems: Record<string, unknown>[],
    session: ArkmeSessionCredentials,
    signal?: AbortSignal,
  ): Promise<ArkmeConversationMemberItem[]> {
    const userIds = rawItems.map(item => Math.trunc(numberValue(item.user_id)))
      .filter(userId => Number.isSafeInteger(userId) && userId > 0)
    const profiles = await this.profile.publicProfileSummariesByUserIds(userIds, session, signal).catch(() => new Map())
    const members: ArkmeConversationMemberItem[] = []
    for (const item of rawItems) {
      const userId = Math.trunc(numberValue(item.user_id))
      if (!Number.isSafeInteger(userId) || userId <= 0) continue
      const profile = profiles.get(userId)
      const { displayName, memberName, secondaryName } = resolveChatMemberDisplayNames({
        userId,
        remarkCandidates: [item.remark],
        memberNameCandidates: [item.display_name_snapshot],
        userNameCandidates: [profile?.displayName],
      })
      const role = chatMemberRole(item.role)
      const status = chatMemberStatus(item.status)
      const extra = parsedObject(item.extra)
      members.push({
        memberRef: await this.sealChatMemberRef(session.userId, chatSessionUid, userId),
        displayName,
        ...(memberName === '' ? {} : { memberName }),
        ...(secondaryName === '' ? {} : { secondaryName }),
        ...(profile?.avatarUrl === undefined ? {} : { avatarRef: await this.profile.sealProfileImageRef(session.userId, userId) }),
        role,
        status,
        isSelf: userId === session.userId,
        isOwner: role === 'owner',
        joinedAtMillis: Math.max(0, Math.trunc(numberValue(item.join_at))),
        recordCount: Math.max(0, Math.trunc(numberValue(extra.record_count))),
        mentionCount: Math.max(0, Math.trunc(numberValue(extra.mention_count))),
      })
    }
    const roleRank = (role: ArkmeGroupMemberRole) => role === 'owner' ? 0 : role === 'admin' ? 1 : role === 'member' ? 2 : 3
    members.sort((left, right) => roleRank(left.role) - roleRank(right.role)
      || (right.status === 'active' ? 1 : 0) - (left.status === 'active' ? 1 : 0)
      || left.joinedAtMillis - right.joinedAtMillis
      || left.displayName.localeCompare(right.displayName))
    return members
  }

  private async projectChatTimelineItems(
    rawItems: unknown[],
    source: ArkmeSourceRefPayload,
    session: ArkmeSessionCredentials,
    signal?: AbortSignal,
  ): Promise<ArkmeTimelineItem[]> {
    const items: ArkmeTimelineItem[] = []
    const senderUserIdByIndex = new Map<number, number>()
    const signingKey = await this.runtime.stateStore.uniqueCode()
    for (const raw of rawItems) {
      const item = objectValue(raw)
      const relation = objectValue(item.relation)
      const record = objectValue(item.record)
      const payload = objectValue(record.payload)
      const recordStatus = numberValue(record.status)
      if (recordStatus !== 1) continue
      const uid = stringValue(relation.record_uid ?? payload.record_uid).trim()
      if (uid === '') continue
      const relationUid = stringValue(relation.rel_uid).trim()
      const senderUserId = Math.trunc(numberValue(relation.sender_user_id))
      const aiPolish = this.aiPolish.timelineAiPolish(record, payload)
      const sendAtMillis = numberValue(relation.attach_at ?? payload.send_at)
      const forwardRecords = await this.chatForwardRecordsPreview(item, session.userId, sendAtMillis)
      const rawAgentSource = timelineAgentSource(relation, record, payload)
      const agentSource = senderUserId === session.userId
        ? this.arko.currentUserAgentSourceFallback(session.userId, rawAgentSource)
        : rawAgentSource
      const itemIndex = items.push({
        itemUid: uid,
        ...(source.kind !== 'group_chat' || relationUid === '' || senderUserId === session.userId ? {} : {
          messageRef: this.sealMessageRef(session.userId, source.ownerRef, relationUid, signingKey),
        }),
        ...(senderUserId > 0 ? { memberRef: await this.sealChatMemberRef(session.userId, source.ownerRef, senderUserId) } : {}),
        senderName: stringValue(relation.display_name_snapshot).trim() || 'Arkme用户',
        ...(agentSource === undefined ? {} : { agentSource }),
        isMe: senderUserId === session.userId,
        sendAtMillis,
        title: stringValue(payload.title),
        textContent: stringValue(payload.text_content),
        status: recordStatus,
        sequence: numberValue(relation.seq),
        ...(numberValue(record.version ?? payload.version) > 0 ? { recordVersion: numberValue(record.version ?? payload.version) } : {}),
        ...(aiPolish === undefined ? {} : { aiPolish }),
        templateKind: numberValue(payload.template_kind),
        displayKind: numberValue(payload.display_kind),
        version: numberValue(payload.version ?? record.version),
        updateAtMillis: numberValue(payload.update_at ?? record.update_at),
        recordDurationMillis: numberValue(payload.record_duration_millis),
        editDurationMillis: numberValue(payload.edit_duration_millis),
        contentBlocks: this.media.richContentBlocks(item, session.userId),
        ...(forwardRecords === undefined ? {} : { forwardRecords }),
      }) - 1
      if (senderUserId > 0) senderUserIdByIndex.set(itemIndex, senderUserId)
    }
    try {
      const profiles = await this.profile.publicProfilesByUserIds([...new Set(senderUserIdByIndex.values())], session, signal)
      for (const [index, senderUserId] of senderUserIdByIndex) {
        if (!profiles.has(senderUserId) || items[index] === undefined) continue
        items[index].avatarRef = await this.profile.sealProfileImageRef(session.userId, senderUserId)
      }
    } catch {
      // Avatar decoration is optional; member references and record content remain usable.
    }
    return items
  }

  private async sealChatMemberRef(viewerUserId: number, chatSessionUid: string, targetUserId: number): Promise<string> {
    const encoded = encodeOpaqueJson({ version: 1, viewerUserId, chatSessionUid, targetUserId } satisfies ArkmeChatMemberRefPayload)
    const signature = createHmac('sha256', await this.runtime.stateStore.uniqueCode()).update(encoded).digest('base64url')
    return `arkme-chat-member-v1.${encoded}.${signature}`
  }

  private async openChatMemberRef(
    memberRef: string,
    expectedViewerUserId: number,
    expectedChatSessionUid: string,
  ): Promise<ArkmeChatMemberRefPayload> {
    const parts = memberRef.trim().split('.')
    if (parts.length !== 3 || parts[0] !== 'arkme-chat-member-v1') {
      throw new ArkmePluginError('chat-member-ref-invalid', '聊天成员引用无效', false)
    }
    const encoded = parts[1] ?? ''
    const supplied = Buffer.from(parts[2] ?? '', 'base64url')
    const expected = createHmac('sha256', await this.runtime.stateStore.uniqueCode()).update(encoded).digest()
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      throw new ArkmePluginError('chat-member-ref-invalid', '聊天成员引用无效', false)
    }
    let raw: Record<string, unknown>
    try { raw = objectValue(decodeOpaqueJson(encoded)) }
    catch (error) { throw new ArkmePluginError('chat-member-ref-invalid', '聊天成员引用无效', false, 400, { cause: error }) }
    const result: ArkmeChatMemberRefPayload = {
      version: 1,
      viewerUserId: Math.trunc(numberValue(raw.viewerUserId)),
      chatSessionUid: stringValue(raw.chatSessionUid).trim(),
      targetUserId: Math.trunc(numberValue(raw.targetUserId)),
    }
    if (raw.version !== 1 || result.viewerUserId !== expectedViewerUserId
      || result.chatSessionUid !== expectedChatSessionUid
      || !Number.isSafeInteger(result.targetUserId) || result.targetUserId <= 0) {
      throw new ArkmePluginError('chat-member-ref-invalid', '聊天成员引用与当前账号或会话不匹配', false, 403)
    }
    return result
  }

  sealMessageRef(userId: number, chatSessionUid: string, relationUid: string, signingKey: string): string {
      const payload = encodeOpaqueJson({ version: 1, userId, chatSessionUid, relationUid } satisfies ArkmeMessageRefPayload)
      const signature = createHmac('sha256', signingKey).update(payload).digest('base64url')
      return `arkme-message-v1.${payload}.${signature}`
    }
  
  async openMessageRef(messageRef: string, expectedUserId: number): Promise<ArkmeMessageRefPayload> {
      const parts = messageRef.trim().split('.')
      if (parts.length !== 3 || parts[0] !== 'arkme-message-v1') {
        throw new ArkmePluginError('message-ref-invalid', 'Arkme 消息引用无效', false)
      }
      const payload = parts[1] ?? ''
      const supplied = Buffer.from(parts[2] ?? '', 'base64url')
      const expected = createHmac('sha256', await this.runtime.stateStore.uniqueCode()).update(payload).digest()
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
        throw new ArkmePluginError('message-ref-invalid', 'Arkme 消息引用无效', false)
      }
      let parsed: Record<string, unknown>
      try {
        parsed = objectValue(decodeOpaqueJson(payload))
      } catch (error) {
        throw new ArkmePluginError('message-ref-invalid', 'Arkme 消息引用无效', false, 400, { cause: error })
      }
      const result: ArkmeMessageRefPayload = {
        version: 1,
        userId: numberValue(parsed.userId),
        chatSessionUid: stringValue(parsed.chatSessionUid).trim(),
        relationUid: stringValue(parsed.relationUid).trim(),
      }
      if (parsed.version !== 1 || result.userId !== expectedUserId || result.chatSessionUid === ''
        || result.relationUid === '') {
        throw new ArkmePluginError('message-ref-invalid', 'Arkme 消息引用与当前账号不匹配', false, 403)
      }
      return result
    }
}
